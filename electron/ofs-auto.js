// Lançamento automático das OFs no sistema (Oracle), em segundo plano, sem ninguém clicar.
// De tempos em tempos (e logo depois de enviar um romaneio), olha os romaneios dos últimos dias que
// têm OF e ainda não foram lançados, procura a ordem de separação de cada cliente e grava.
// Só grava quando não há dúvida (as mesmas regras da tela, em ofs-regras.js) e o campo está vazio;
// nunca escreve por cima de outro texto. O que ficar com dúvida aparece no "🧾 Lançar OFs".
// Vários PCs fazendo isso ao mesmo tempo não duplica: a gravação só passa se a ordem ainda estiver
// como estava na busca.
const fs = require('fs');
const path = require('path');

const API = 'https://programa-odeentrega.onrender.com/api/romaneio';
const INTERVALO_MS = 5 * 60 * 1000;
const PRIMEIRA_VEZ_MS = 60 * 1000;
const DIAS = 3;

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

// muda quando os produtos/OFs do romaneio mudam: aí ele é conferido de novo
function assinaturaDosItens(d) {
  return JSON.stringify((d.clientes || []).map((c) => (c.itens || []).map((i) => [i.rp, i.qtd, i.ofobs])));
}

// simular: só registra o que faria (para teste), sem gravar no sistema nem no romaneio
function iniciarOfsAuto({ rodarOfsOracle, planilha, pastaLog, simular = false, semTimers = false }) {
  const R = carregarRegras();
  const logArq = path.join(pastaLog, 'ofs-auto.log');
  const log = (msg) => {
    try {
      if (fs.existsSync(logArq) && fs.statSync(logArq).size > 300 * 1024) fs.renameSync(logArq, logArq + '.old');
      fs.appendFileSync(logArq, `${new Date().toISOString()} ${msg}\n`);
    } catch { /* sem log */ }
  };
  if (!R) { log('regras (ofs-regras.js) não encontradas — lançamento automático desligado'); return { agora() {} }; }

  let rodando = false;
  let timer = null;

  async function ciclo() {
    if (rodando) return;
    rodando = true;
    try {
      if (!fs.existsSync(planilha)) return; // PC sem o L:: não tem como falar com o Oracle
      const resp = await fetch(`${API}/docs/romaneios?arq=1&orderBy=criadoEm&dir=desc&limit=60`);
      if (!resp.ok) return;
      const docs = ((await resp.json()).docs || []);
      const limite = Date.now() - DIAS * 86400000;
      const trabalho = [];
      for (const doc of docs) {
        const d = doc.data || {};
        if (Date.parse(d.criadoEm || '') < limite) continue;
        const clientes = R.clientesDoRomaneio(d)
          .map((c) => ({ nome: c.nome, itens: c.itens.filter((i) => i.ofs.length) }))
          .filter((c) => c.itens.length);
        if (!clientes.length) continue;
        const assinatura = assinaturaDosItens(d);
        if (d.ofsAuto && d.ofsAuto.chave === assinatura && d.ofsAuto.completo) continue;
        trabalho.push({ id: doc.id, d, clientes, assinatura });
      }
      if (!trabalho.length) return;

      const codpros = [...new Set(trabalho.flatMap((t) => t.clientes.flatMap((c) => c.itens.map((i) => i.rp))))];
      const busca = await rodarOfsOracle({ acao: 'buscar', codpros, agrupas: [], dias: 10 });
      const linhas = (busca && busca.linhas) || [];
      if (busca && busca.erros && busca.erros.length) log('busca: ' + busca.erros.join(' | '));
      if (!linhas.length && busca && busca.erros && busca.erros.length) return;

      const paraGravar = [];
      for (const t of trabalho) {
        const dataRomaneio = t.d.data || String(t.d.criadoEm || '').slice(0, 10);
        t.linhas = [];
        t.completo = true;
        for (const c of t.clientes) {
          const rps = c.itens.map((i) => R.norm(i.rp));
          const lista = R.candidatos(c, linhas.filter((l) => rps.includes(R.norm(l.codpro))), dataRomaneio);
          const g = R.escolhaAutomatica(c, lista);
          if (!g) { t.completo = false; continue; } // dúvida ou OS ainda não emitida: tenta no próximo ciclo
          for (const l of R.linhasParaGravar(c, g)) {
            if (l.situacao === 'vazia') { t.linhas.push(l); paraGravar.push(l); }
            else if (l.situacao === 'outra') t.completo = false; // já tem outro texto: só pela tela, com alguém olhando
          }
        }
      }

      const resultado = {};
      if (simular) {
        for (const l of paraGravar) { resultado[l.chave] = { chave: l.chave, gravadas: 1 }; log('SIMULAÇÃO gravaria: ' + l.empresa + ' ' + l.agrupa + ' ' + l.codpro + ' ' + l.novo.trim()); }
        for (const t of trabalho) log('SIMULAÇÃO romaneio ' + t.id + ' (' + t.clientes.map((c) => c.nome).join(' + ') + '): ' + (t.completo ? 'resolvido' : 'fica para o Lançar OFs (dúvida, OS não emitida ou já tem outro texto)'));
      } else if (paraGravar.length) {
        const r = await rodarOfsOracle({
          acao: 'gravar',
          linhas: paraGravar.map((l) => ({ chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, pedido: l.pedido, antes: l.antes, novo: l.novo })),
        });
        for (const x of (r && r.resultados) || []) resultado[x.chave] = x;
        if (r && r.erros && r.erros.length) log('gravação: ' + r.erros.join(' | '));
      }

      for (const t of trabalho) {
        const gravadas = t.linhas.filter((l) => resultado[l.chave] && resultado[l.chave].gravadas > 0);
        if (gravadas.length < t.linhas.length) t.completo = false;
        const antes = t.d.ofsAuto || {};
        if (!gravadas.length && antes.chave === t.assinatura && antes.completo === t.completo) continue;
        const dados = { ofsAuto: { em: new Date().toISOString(), chave: t.assinatura, completo: t.completo } };
        if (gravadas.length) {
          let registro = (t.d.ofsLancadas && t.d.ofsLancadas.linhas) || [];
          for (const l of gravadas) {
            registro = registro.filter((x) => x.chave !== l.chave);
            registro.push({ chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, texto: l.novo.trim() });
          }
          dados.ofsLancadas = { em: new Date().toISOString(), por: 'automático', linhas: registro };
          log(`romaneio ${t.id}: gravou ${gravadas.map((l) => `${l.empresa} ${l.agrupa} ${l.codpro} ${l.novo.trim()}`).join('; ')}`);
        }
        if (simular) continue;
        await fetch(`${API}/docs/romaneios/${encodeURIComponent(t.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dados }),
        }).catch(() => {});
      }
    } catch (e) {
      log('erro: ' + (e && e.message ? e.message : String(e)));
    } finally {
      rodando = false;
    }
  }

  if (!semTimers) {
    setTimeout(ciclo, PRIMEIRA_VEZ_MS);
    setInterval(ciclo, INTERVALO_MS);
  }
  return {
    ciclo,
    // romaneio acabou de ser enviado: confere daqui a pouco (dá tempo dele chegar ao servidor)
    agora() {
      clearTimeout(timer);
      timer = setTimeout(ciclo, 15 * 1000);
    },
  };
}

module.exports = { iniciarOfsAuto };
