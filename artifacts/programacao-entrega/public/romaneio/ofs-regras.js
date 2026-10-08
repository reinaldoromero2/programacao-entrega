// Regras do lançamento de OFs (usadas pela tela do Romaneio, ofs-oracle.js, e pelo lançamento
// automático em segundo plano do app, electron/ofs-auto.js): como achar a ordem de separação de
// cada produto e o que gravar. Um lugar só, para a tela e o automático decidirem igual.
(function (raiz, fabrica) {
  var regras = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = regras;
  else raiz.ripackOfsRegras = regras;
})(this, function () {
  'use strict';

  function norm(s) { return String(s || '').trim().toUpperCase(); }
  function dataBr(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] : (iso || ''); }
  function diasEntre(a, b) {
    var x = Date.parse(a), y = Date.parse(b);
    if (isNaN(x) || isNaN(y)) return 99;
    return Math.abs(x - y) / 86400000;
  }
  // OFs do campo do romaneio: só os números (o campo às vezes tem texto, como "1ª ENTREGA DE OUTUBRO")
  function ofsDoTexto(t) {
    var achadas = String(t || '').match(/\b\d{5,7}\b/g) || [];
    return achadas.filter(function (o, i) { return achadas.indexOf(o) === i; });
  }
  // mesmo texto da planilha: "OF:253858  OF:253328  " (a coluna aceita 100 caracteres)
  function textoOfs(ofs) { return ofs.map(function (o) { return 'OF:' + o + '  '; }).join('').slice(0, 100); }
  function mesmoTexto(a, b) { return norm(a).replace(/\s+/g, ' ') === norm(b).replace(/\s+/g, ' '); }

  // ---- monta a conferência ----
  // clientes do romaneio -> [{ nome, itens: [{ rp, qtd, ofs }] }]
  function clientesDoRomaneio(d) {
    var lista = [];
    (d.clientes || []).forEach(function (c) {
      var itens = [];
      (c.itens || []).forEach(function (i) {
        if (!i || !i.rp) return;
        itens.push({ rp: String(i.rp).trim(), qtd: Number(i.qtd) || 0, ofs: ofsDoTexto(i.ofobs), ofobs: i.ofobs || '' });
      });
      if (itens.length) lista.push({ nome: c.nome || d.cliente || 'Cliente', itens: itens });
    });
    return lista;
  }

  // ---- escolha da ordem, produto por produto ----
  // O sistema pode separar os produtos do mesmo cliente em agrupamentos diferentes (ex.: 2019 BOSCH
  // CAMPINAS em 08/10: 2018-002/25 no 41885 e 2019-001/24 no 41886), então cada produto procura a
  // própria ordem. Só valem ordens do MESMO DIA do romaneio (a OS e o romaneio são feitos juntos; uma
  // de ontem com as mesmas OFs dava "já lançado" sem gravar na de hoje). Ordem das opções:
  //   1. a mesma quantidade do romaneio
  //   2. o agrupamento que também tem os outros produtos do cliente
  //   3. no par Matriz/Filial do mesmo dia, a Filial (no histórico de set–out/2026, 22 de 28 pares
  //      assim tinham a OF só na Filial e nenhum só na Matriz)
  function opcoesDoItem(item, cliente, linhas, dataRomaneio) {
    var grupos = {};
    linhas.forEach(function (l) {
      if (norm(l.codpro) !== norm(item.rp)) return;
      var k = l.empresa + '|' + l.agrupa;
      (grupos[k] = grupos[k] || { empresa: l.empresa, agrupa: l.agrupa, data: l.data, linhas: [] }).linhas.push(l);
    });
    var outrosRps = cliente.itens.filter(function (i) { return i !== item; }).map(function (i) { return norm(i.rp); });
    var lista = Object.keys(grupos).map(function (k) {
      var g = grupos[k];
      var soma = g.linhas.reduce(function (s, l) { return s + (Number(l.qtd) || 0); }, 0);
      g.qtd = soma;
      g.mesmaQtd = Math.abs(soma - item.qtd) < 0.001;
      g.distancia = Math.round(diasEntre(g.data, dataRomaneio));
      // quantos outros produtos do cliente estão no mesmo agrupamento
      g.junto = 0;
      outrosRps.forEach(function (rp) {
        if (linhas.some(function (l) { return l.empresa === g.empresa && l.agrupa === g.agrupa && norm(l.codpro) === rp; })) g.junto++;
      });
      return g;
    });
    lista = lista.filter(function (g) { return g.distancia === 0; });
    lista.sort(function (a, b) {
      return (a.distancia - b.distancia) || ((b.mesmaQtd ? 1 : 0) - (a.mesmaQtd ? 1 : 0)) || (b.junto - a.junto) ||
        ((a.empresa === 'filial' ? 0 : 1) - (b.empresa === 'filial' ? 0 : 1)) || (Number(b.agrupa) - Number(a.agrupa));
    });
    return lista;
  }

  // quais ordens do produto recebem a OF: uma ordem com a mesma quantidade do romaneio ou, se não
  // houver, um conjunto de ordens da mesma empresa que soma a quantidade (ex.: 2022-003/26 × 338 em
  // 08/10 = 41903 (26) + 41902 (156) + 41901 (156)). Só quando a combinação é única; com dúvida, null.
  // No par Matriz/Filial, a Filial. Sem nenhuma combinação, e com uma única ordem no dia, vale ela.
  function escolhasDoItem(item, lista) {
    if (!lista.length) return null;
    var porEmpresa = { filial: [], matriz: [] };
    lista.forEach(function (g) { (porEmpresa[g.empresa] = porEmpresa[g.empresa] || []).push(g); });
    var achadas = [];
    Object.keys(porEmpresa).forEach(function (emp) {
      var gs = porEmpresa[emp], n = gs.length;
      if (!n || n > 12) return;
      for (var mask = 1; mask < (1 << n); mask++) {
        var soma = 0, sel = [];
        for (var b = 0; b < n; b++) if (mask & (1 << b)) { soma += Number(gs[b].qtd) || 0; sel.push(gs[b]); }
        if (Math.abs(soma - item.qtd) < 0.001) achadas.push({ emp: emp, sel: sel });
      }
    });
    // entre combinações da mesma empresa empatadas, desempata o agrupamento que também tem os outros
    // produtos do cliente; sem desempate, é dúvida
    function daEmpresa(lista) {
      if (lista.length === 1) return lista[0].sel;
      var pontos = lista.map(function (a) { return a.sel.reduce(function (s, g) { return s + g.junto; }, 0); });
      var max = Math.max.apply(null, pontos);
      var melhores = lista.filter(function (a, i) { return pontos[i] === max; });
      return melhores.length === 1 ? melhores[0].sel : null;
    }
    function escolher(lista) {
      if (!lista.length) return undefined;
      var fil = lista.filter(function (a) { return a.emp === 'filial'; });
      if (fil.length) return daEmpresa(fil);
      return daEmpresa(lista.filter(function (a) { return a.emp === 'matriz'; }));
    }
    // primeiro uma ordem só com a mesma quantidade; depois as somas
    var r = escolher(achadas.filter(function (a) { return a.sel.length === 1; }));
    if (r !== undefined) return r;
    r = escolher(achadas);
    if (r !== undefined) return r;
    return lista.length === 1 ? [lista[0]] : null;
  }

  // plano de um cliente: para cada produto, as ordens do dia (opcoes) e as escolhidas ([] = alguém
  // precisa escolher)
  function planejar(cliente, linhas, dataRomaneio) {
    var itens = cliente.itens.map(function (item) {
      var opcoes = opcoesDoItem(item, cliente, linhas, dataRomaneio);
      return { item: item, opcoes: opcoes, escolhidas: escolhasDoItem(item, opcoes) || [] };
    });
    return { itens: itens, completo: itens.every(function (x) { return x.escolhidas.length > 0 || !x.item.ofs.length; }) };
  }

  // linhas de ordem para gravar. Com todas=true, traz as linhas de TODAS as ordens do dia de cada
  // produto (para a conferência mostrar tudo), cada uma com "escolhida" dizendo se o app a marcou.
  function linhasDoPlano(plano, todas) {
    var porLinha = {}, ordem = [];
    plano.itens.forEach(function (x) {
      var it = x.item;
      if (!it.ofs.length) return;
      (todas ? x.opcoes : x.escolhidas).forEach(function (g) {
        var marcada = x.escolhidas.indexOf(g) >= 0;
        g.linhas.forEach(function (l) {
          var k = [l.empresa, l.agrupa, l.codigo, l.codpro, l.pedido].join('|');
          if (!porLinha[k]) {
            porLinha[k] = { chave: k, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, pedido: l.pedido, data: l.data, qtd: l.qtd, antes: l.infadc || '', ofs: [], escolhida: false };
            ordem.push(k);
          }
          if (marcada) porLinha[k].escolhida = true;
          it.ofs.forEach(function (o) { if (porLinha[k].ofs.indexOf(o) < 0) porLinha[k].ofs.push(o); });
        });
      });
    });
    return ordem.map(function (k) {
      var r = porLinha[k];
      r.novo = textoOfs(r.ofs);
      r.situacao = !r.antes ? 'vazia' : mesmoTexto(r.antes, r.novo) ? 'igual' : 'outra';
      return r;
    });
  }

  return { norm, dataBr, diasEntre, ofsDoTexto, textoOfs, mesmoTexto, clientesDoRomaneio, planejar, linhasDoPlano };
});
