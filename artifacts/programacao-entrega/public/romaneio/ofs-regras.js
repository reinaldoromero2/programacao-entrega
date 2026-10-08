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

  // agrupamentos possíveis para um cliente, do melhor para o pior:
  // mais produtos do cliente com a mesma quantidade, depois a data mais perto do romaneio
  function candidatos(cliente, linhas, dataRomaneio) {
    var grupos = {};
    linhas.forEach(function (l) {
      var k = l.empresa + '|' + l.agrupa;
      (grupos[k] = grupos[k] || { empresa: l.empresa, agrupa: l.agrupa, data: l.data, linhas: [] }).linhas.push(l);
    });
    var lista = Object.keys(grupos).map(function (k) {
      var g = grupos[k], cobertos = 0, algum = 0;
      cliente.itens.forEach(function (it) {
        var doProduto = g.linhas.filter(function (l) { return norm(l.codpro) === norm(it.rp); });
        if (!doProduto.length) return;
        algum++;
        var soma = doProduto.reduce(function (s, l) { return s + (Number(l.qtd) || 0); }, 0);
        if (Math.abs(soma - it.qtd) < 0.001) cobertos++;
      });
      g.cobertos = cobertos;
      g.algum = algum;
      g.distancia = diasEntre(g.data, dataRomaneio);
      return g;
    }).filter(function (g) { return g.algum > 0; });
    // mesmo produto e quantidade no mesmo dia na Matriz e na Filial: a OF vai na da Filial
    // (no histórico de set–out/2026, 22 de 28 pares assim tinham a OF só na Filial e nenhum só na Matriz)
    lista.sort(function (a, b) {
      return (b.cobertos - a.cobertos) || (a.distancia - b.distancia) ||
        ((a.empresa === 'filial' ? 0 : 1) - (b.empresa === 'filial' ? 0 : 1)) || (Number(b.agrupa) - Number(a.agrupa));
    });
    return lista;
  }

  // escolhe sozinho só quando não há dúvida: cobre todos os produtos, data até 3 dias do
  // romaneio e nenhum outro agrupamento da mesma empresa empata (o par Matriz/Filial já se
  // resolve pela Filial, na ordem acima)
  function escolhaAutomatica(cliente, lista) {
    var top = lista[0];
    if (!top || top.cobertos < cliente.itens.length || top.distancia > 3) return null;
    var empata = function (g) { return g && g.cobertos === top.cobertos && Math.abs(g.distancia - top.distancia) < 1; };
    var duvida = lista.slice(1).some(function (g) { return empata(g) && g.empresa === top.empresa; });
    return duvida ? null : top;
  }

  // linhas a gravar quando o cliente usa o agrupamento g
  function linhasParaGravar(cliente, g) {
    var porLinha = {};
    cliente.itens.forEach(function (it) {
      if (!it.ofs.length) return;
      g.linhas.forEach(function (l) {
        if (norm(l.codpro) !== norm(it.rp)) return;
        var k = [l.empresa, l.agrupa, l.codigo, l.codpro, l.pedido].join('|');
        var r = porLinha[k] = porLinha[k] || { chave: k, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, pedido: l.pedido, antes: l.infadc || '', ofs: [] };
        it.ofs.forEach(function (o) { if (r.ofs.indexOf(o) < 0) r.ofs.push(o); });
      });
    });
    return Object.keys(porLinha).map(function (k) {
      var r = porLinha[k];
      r.novo = textoOfs(r.ofs);
      r.situacao = !r.antes ? 'vazia' : mesmoTexto(r.antes, r.novo) ? 'igual' : 'outra';
      return r;
    });
  }

  return { norm, dataBr, diasEntre, ofsDoTexto, textoOfs, mesmoTexto, clientesDoRomaneio, candidatos, escolhaAutomatica, linhasParaGravar };
});
