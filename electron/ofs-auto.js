// Lançamento automático das OFs no sistema (Oracle), em segundo plano, sem ninguém clicar.
// Roda quando um romaneio é criado (ou editado mudando produtos/OFs): a página do Romaneio manda
// os produtos e OFs para cá e o app procura a ordem de separação de cada cliente e grava.
// Só grava quando não há dúvida (as mesmas regras da tela, em ofs-regras.js) e o campo está vazio;
// nunca escreve por cima de outro texto. O que ficar com dúvida aparece como "⚠ Lançar OFs".
// Não usa o servidor do app nem o Neon: fala só com o Oracle (rede interna) e guarda o resultado
// num arquivo deste PC (ofs-status.json, na pasta de dados do app).
const fs = require('fs');
const path = require('path');

function carregarRegras() {
  const caminhos = [
    path.join(__dirname, '..', 'dist', 'romaneio', 'ofs-regras.js'),
    path.join(__dirname, '..', 'artifacts', 'programacao-entrega', 'public', 'romaneio', 'ofs-regras.js'),
  ];
  for (const c of caminhos) {
    try {
      const m = { exports: {} };
      new Function('module', 'exports', fs.readFileSync(c, 'utf8')).call({}, m, m.exports);
      if (m.exports && m.exports.candidatos) return m.exports;
    } catch { /* tenta o próximo */ }
  }
  return null;
}

// muda quando os produtos/OFs do romaneio mudam: aí ele é lançado de novo
function assinaturaDosItens(d) {
  return JSON.stringify((d.clientes || []).map((c) => (c.itens || []).map((i) => [i.rp, i.qtd, i.ofobs])));
}

// simular: só registra o que faria (para teste), sem gravar no sistema
function criarOfsAuto({ rodarOfsOracle, pastaDados, simular = false }) {
  const R = carregarRegras();
  const logArq = path.join(pastaDados, 'ofs-auto.log');
  const statusArq = path.join(pastaDados, 'ofs-status.json');
  const log = (msg) => {
    try {
      if (fs.existsSync(logArq) && fs.statSync(logArq).size > 300 * 1024) fs.renameSync(logArq, logArq + '.old');
      fs.appendFileSync(logArq, `${new Date().toISOString()} ${msg}\n`);
    } catch { /* sem log */ }
  };
  let situacao = {};
  try { situacao = JSON.parse(fs.readFileSync(statusArq, 'utf8')) || {}; } catch { situacao = {}; }
  const salvar = () => {
    // guarda só os últimos 60 dias
    const limite = Date.now() - 60 * 86400000;
    for (const id of Object.keys(situacao)) if (Date.parse(situacao[id].em || '') < limite) delete situacao[id];
    try { fs.writeFileSync(statusArq, JSON.stringify(situacao)); } catch (e) { log('não salvou o status: ' + e.message); }
  };
  const juntarLinhas = (id, linhas) => {
    let registro = (situacao[id] && situacao[id].linhas) || [];
    for (const l of linhas) {
      registro = registro.filter((x) => x.chave !== l.chave);
      registro.push({ chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, texto: String(l.novo || l.texto || '').trim() });
    }
    return registro;
  };

  const fila = [];
  let rodando = false;

  async function lancarAgora(id, d) {
    if (!R) { log('regras (ofs-regras.js) não encontradas'); return null; }
    const clientes = R.clientesDoRomaneio(d)
      .map((c) => ({ nome: c.nome, itens: c.itens.filter((i) => i.ofs.length) }))
      .filter((c) => c.itens.length);
    if (!clientes.length) return situacao[id] || null;
    const assinatura = assinaturaDosItens(d);
    if (situacao[id] && situacao[id].chave === assinatura && situacao[id].completo) return situacao[id];

    const codpros = [...new Set(clientes.flatMap((c) => c.itens.map((i) => i.rp)))];
    const busca = await rodarOfsOracle({ acao: 'buscar', codpros, agrupas: [], dias: 10 });
    const linhas = (busca && busca.linhas) || [];
    if (busca && busca.erros && busca.erros.length) log(`romaneio ${id}: busca: ${busca.erros.join(' | ')}`);

    const dataRomaneio = d.data || String(d.criadoEm || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const paraGravar = [];
    let completo = true;
    for (const c of clientes) {
      const rps = c.itens.map((i) => R.norm(i.rp));
      const g = R.escolhaAutomatica(c, R.candidatos(c, linhas.filter((l) => rps.includes(R.norm(l.codpro))), dataRomaneio));
      if (!g) { completo = false; continue; } // dúvida ou OS ainda não emitida
      for (const l of R.linhasParaGravar(c, g)) {
        if (l.situacao === 'vazia') paraGravar.push(l);
        else if (l.situacao === 'outra') completo = false; // já tem outro texto: só pela tela, com alguém olhando
      }
    }

    let gravadas = [];
    if (paraGravar.length && simular) {
      gravadas = paraGravar;
      for (const l of paraGravar) log(`SIMULAÇÃO romaneio ${id}: gravaria ${l.empresa} ${l.agrupa} ${l.codpro} ${l.novo.trim()}`);
    } else if (paraGravar.length) {
      const r = await rodarOfsOracle({
        acao: 'gravar',
        linhas: paraGravar.map((l) => ({ chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, pedido: l.pedido, antes: l.antes, novo: l.novo })),
      });
      const resultado = {};
      for (const x of (r && r.resultados) || []) resultado[x.chave] = x;
      if (r && r.erros && r.erros.length) log(`romaneio ${id}: gravação: ${r.erros.join(' | ')}`);
      gravadas = paraGravar.filter((l) => resultado[l.chave] && resultado[l.chave].gravadas > 0);
      if (gravadas.length) log(`romaneio ${id}: gravou ${gravadas.map((l) => `${l.empresa} ${l.agrupa} ${l.codpro} ${l.novo.trim()}`).join('; ')}`);
    }
    if (gravadas.length < paraGravar.length) completo = false;
    if (simular) log(`SIMULAÇÃO romaneio ${id}: ${completo ? 'resolvido' : 'fica para o "⚠ Lançar OFs"'}`);

    // resumo do romaneio guardado junto (só neste PC): o card "OFs para conferir" mostra e abre a conferência
    const resumo = { cliente: d.cliente || '', data: d.data || '', criadoEm: d.criadoEm || '', clientes: (d.clientes || []).map((c) => ({ nome: c.nome, itens: (c.itens || []).map((i) => ({ rp: i.rp, qtd: i.qtd, ofobs: i.ofobs })) })) };
    situacao[id] = { em: new Date().toISOString(), chave: assinatura, completo, linhas: juntarLinhas(id, gravadas), romaneio: resumo };
    if (!simular) salvar();
    return situacao[id];
  }

  // um romaneio por vez (o Oracle é consultado pelo PowerShell, um processo de cada vez)
  function lancar(id, d) {
    return new Promise((resolve) => {
      fila.push({ id, d, resolve });
      (async function proximo() {
        if (rodando) return;
        const item = fila.shift();
        if (!item) return;
        rodando = true;
        try { item.resolve(await lancarAgora(item.id, item.d)); }
        catch (e) { log(`romaneio ${item.id}: erro: ${e && e.message ? e.message : e}`); item.resolve(situacao[item.id] || null); }
        finally { rodando = false; proximo(); }
      })();
    });
  }

  // lançamento feito pela tela ("🧾 Lançar OFs"): só registra o resultado neste PC
  function registrar(id, linhas, completo) {
    const antes = situacao[id] || {};
    situacao[id] = { em: new Date().toISOString(), chave: antes.chave || '', completo: !!completo, linhas: juntarLinhas(id, linhas || []), romaneio: antes.romaneio };
    salvar();
    return situacao[id];
  }

  return { lancar, registrar, status: () => situacao };
}

module.exports = { criarOfsAuto };
