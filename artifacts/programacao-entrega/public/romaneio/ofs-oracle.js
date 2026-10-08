// "Lançar OFs no sistema": grava as OFs de cada produto do romaneio na ordem de separação do
// sistema (F_ORDEMSEP.ORD_INFADC), o mesmo que as planilhas "Inclusor da OF na NOTA FISCAL".
// O Oracle só é alcançado do app instalado nos PCs do escritório: a página pede ao app (Electron)
// pelo postMessage { ripack: 'ofs-oracle' } e o app roda a consulta. No navegador, o botão não aparece.
// A busca casa cada cliente do romaneio com um agrupamento pelo código do produto e a quantidade,
// mostra tudo para conferir e só grava o que estiver marcado.
(function () {
  'use strict';
  if (window.parent === window) return;

  var pedidos = {}, proximo = 1;
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.ripack !== 'ofs-oracle-resultado' || !pedidos[m.id]) return;
    var p = pedidos[m.id];
    delete pedidos[m.id];
    p(m.resultado || { ok: false, erros: ['Sem resposta do app.'] });
  });
  function oracle(entrada) {
    return new Promise(function (resolve) {
      var id = proximo++;
      pedidos[id] = resolve;
      window.parent.postMessage({ ripack: 'ofs-oracle', id: id, entrada: entrada }, '*');
      setTimeout(function () {
        if (pedidos[id]) { delete pedidos[id]; resolve({ ok: false, erros: ['O sistema demorou demais para responder.'] }); }
      }, 150000);
    });
  }

  // o app responde se consegue falar com o Oracle (só o app instalado no PC)
  var disponivel = null;
  var aoSaberDisponivel = [];
  oracle({ acao: 'disponivel' }).then(function (r) {
    disponivel = !!(r && r.ok);
    aoSaberDisponivel.forEach(function (f) { f(); });
    aoSaberDisponivel = [];
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var R = window.ripackOfsRegras;
  var norm = R.norm, dataBr = R.dataBr, diasEntre = R.diasEntre, ofsDoTexto = R.ofsDoTexto, textoOfs = R.textoOfs;
  var clientesDoRomaneio = R.clientesDoRomaneio, planejar = R.planejar, linhasDoPlano = R.linhasDoPlano;

  // ---- janela ----
  var modal = null;
  function janela() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'rom-modal-overlay';
    modal.style.zIndex = '210';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="rom-modal-card" style="max-width:760px; width:min(760px, 96vw);">' +
        '<div class="rom-modal-head"><h3>Lançar OFs no sistema</h3></div>' +
        '<div class="ofs-corpo" style="padding:14px 18px; display:flex; flex-direction:column; gap:12px; max-height:70vh; overflow:auto;"></div>' +
        '<div style="padding:10px 18px 16px; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">' +
          '<span class="ofs-status foot-note" style="margin-right:auto; align-self:center;"></span>' +
          '<button type="button" class="add-btn btn-destaque-branco ofs-fechar">Fechar</button>' +
          '<button type="button" class="add-btn btn-destaque-verde ofs-gravar" disabled>Gravar no sistema</button>' +
        '</div>' +
      '</div>';
    // dentro do .app-root: é lá que o tema "vidro" dá o fundo fosco às janelas (fora dele fica transparente)
    (document.querySelector('.app-root') || document.body).appendChild(modal);
    modal.querySelector('.ofs-fechar').addEventListener('click', function () { modal.hidden = true; });
    modal.addEventListener('click', function (ev) { if (ev.target === modal) modal.hidden = true; });
    return modal;
  }
  function status(texto, cor) {
    var el = janela().querySelector('.ofs-status');
    el.textContent = texto || '';
    el.style.color = cor || '';
  }

  var atual = null; // { docId, d, clientes: [{ cliente, lista, escolhido }], dbApi, nome }

  // aviso: mensagem para mostrar depois de buscar de novo (ex.: resultado da gravação)
  function abrir(docId, d, dbApi, nome, aviso) {
    var m = janela();
    m.hidden = false;
    var corpo = m.querySelector('.ofs-corpo');
    var gravarBtn = m.querySelector('.ofs-gravar');
    gravarBtn.disabled = true;
    var clientes = clientesDoRomaneio(d);
    if (!clientes.length) {
      corpo.innerHTML = '<p class="foot-note">Este romaneio não tem produtos para lançar.</p>';
      status('');
      return;
    }
    corpo.innerHTML = '<p class="foot-note">Procurando as ordens de separação na Matriz e na Filial…</p>';
    status('');
    var codpros = [];
    clientes.forEach(function (c) { c.itens.forEach(function (i) { if (codpros.indexOf(i.rp) < 0) codpros.push(i.rp); }); });
    var dataRomaneio = d.data || (d.criadoEm || '').slice(0, 10);
    var dias = Math.max(20, Math.ceil(diasEntre(dataRomaneio, new Date().toISOString().slice(0, 10))) + 10);
    oracle({ acao: 'buscar', codpros: codpros, agrupas: [], dias: dias }).then(function (r) {
      if (!r || !r.linhas) r = { linhas: [], erros: (r && r.erros) || ['Sem resposta do sistema.'] };
      atual = {
        docId: docId, d: d, dbApi: dbApi, nome: nome, dataRomaneio: dataRomaneio, erros: r.erros || [],
        clientes: clientes.map(function (c) {
          return { cliente: c, plano: planejar(c, r.linhas || [], dataRomaneio), marcar: {} };
        })
      };
      desenhar();
      if (aviso) status(aviso.texto, aviso.cor);
    });
  }

  function desenhar() {
    var m = janela(), corpo = m.querySelector('.ofs-corpo'), gravarBtn = m.querySelector('.ofs-gravar');
    var html = '';
    if (atual.erros.length) {
      html += '<p class="foot-note" style="color:var(--critical); margin:0;">' + atual.erros.map(esc).join('<br>') + '</p>';
    }
    atual.clientes.forEach(function (c, ci) {
      var cli = c.cliente;
      html += '<div style="border:1px solid var(--border); border-radius:8px; padding:10px 12px;">';
      html += '<div style="font-weight:700; margin-bottom:6px;">' + esc(cli.nome) + '</div>';
      var rotulo = function (g) {
        return (g.empresa === 'matriz' ? 'Matriz' : 'Filial') + ' — agrupamento ' + g.agrupa + ' — ' + dataBr(g.data) +
          ' — ' + g.qtd + ' pç' + (g.mesmaQtd ? ' (mesma qtd)' : ' (qtd diferente)');
      };
      c.plano.itens.forEach(function (x, ii) {
        var i = x.item;
        html += '<div style="margin:6px 0 8px;">';
        html += '<div class="foot-note" style="margin:0 0 4px;"><b>' + esc(i.rp) + '</b> × ' + esc(i.qtd) + ' — ' +
          (i.ofs.length ? 'OF ' + esc(i.ofs.join(', ')) : '<span style="color:var(--critical)">sem número de OF no romaneio' + (i.ofobs ? ' ("' + esc(i.ofobs) + '")' : '') + '</span>') + '</div>';
        if (!x.opcoes.length) {
          html += '<div class="foot-note" style="color:var(--critical); margin:0;">Nenhuma ordem de separação deste produto nos últimos dias.</div>';
        } else if (i.ofs.length) {
          html += '<select data-ci="' + ci + '" data-ii="' + ii + '" class="ofs-escolha" style="width:100%; padding:6px; border-radius:6px; border:1px solid var(--border); background:var(--surface, #fff); color:inherit;">';
          html += '<option value="">— escolha a ordem —</option>';
          x.opcoes.forEach(function (g, gi) {
            html += '<option value="' + gi + '"' + (g === x.escolhida ? ' selected' : '') + '>' + esc(rotulo(g)) + '</option>';
          });
          html += '</select>';
          if (!x.escolhida) html += '<div class="foot-note" style="color:var(--warning, #b45309); margin:4px 0 0;">Mais de uma ordem possível (ou nenhuma do dia do romaneio): escolha a certa.</div>';
        }
        html += '</div>';
      });
      var linhas = linhasDoPlano(c.plano);
      c.linhas = linhas;
      if (linhas.length) {
        html += '<table style="width:100%; border-collapse:collapse; margin-top:4px; font-size:12px;">' +
          '<tr style="text-align:left; color:var(--text-secondary);"><th style="padding:3px;"></th><th style="padding:3px;">Agrup.</th><th style="padding:3px;">OS</th><th style="padding:3px;">Produto</th><th style="padding:3px;">Pedido</th><th style="padding:3px;">No sistema hoje</th><th style="padding:3px;">Vai gravar</th></tr>';
        linhas.forEach(function (l) {
          var marcado = c.marcar[l.chave] !== undefined ? c.marcar[l.chave] : l.situacao === 'vazia';
          c.marcar[l.chave] = marcado;
          var hoje = l.situacao === 'vazia' ? '<i style="color:var(--text-secondary)">vazio</i>'
            : l.situacao === 'igual' ? '<span style="color:var(--good)">✔ já lançado</span>'
            : '<span style="color:var(--warning, #b45309)">' + esc(l.antes) + '</span>';
          html += '<tr style="border-top:1px solid var(--grid);">' +
            '<td style="padding:3px;"><input type="checkbox" class="ofs-marca" data-ci="' + ci + '" data-chave="' + esc(l.chave) + '"' +
              (l.situacao === 'igual' ? ' disabled' : '') + (marcado && l.situacao !== 'igual' ? ' checked' : '') +
              ' title="' + (l.situacao === 'outra' ? 'Marque para substituir o que já está no sistema' : 'Gravar esta linha') + '"></td>' +
            '<td style="padding:3px;">' + esc((l.empresa === 'matriz' ? 'M ' : 'F ') + l.agrupa) + '</td>' +
            '<td style="padding:3px;">' + esc(l.codigo) + '</td><td style="padding:3px;">' + esc(l.codpro) + '</td><td style="padding:3px;">' + esc(l.pedido) + '</td>' +
            '<td style="padding:3px;">' + hoje + '</td><td style="padding:3px; font-family:monospace;">' + esc(l.novo.trim()) + '</td></tr>';
        });
        html += '</table>';
      }
      html += '</div>';
    });
    corpo.innerHTML = html;
    corpo.querySelectorAll('.ofs-escolha').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var c = atual.clientes[Number(sel.getAttribute('data-ci'))];
        var x = c.plano.itens[Number(sel.getAttribute('data-ii'))];
        x.escolhida = sel.value === '' ? null : x.opcoes[Number(sel.value)];
        c.marcar = {};
        desenhar();
      });
    });
    corpo.querySelectorAll('.ofs-marca').forEach(function (cb) {
      cb.addEventListener('change', function () {
        atual.clientes[Number(cb.getAttribute('data-ci'))].marcar[cb.getAttribute('data-chave')] = cb.checked;
        contar();
      });
    });
    contar();
    gravarBtn.onclick = gravar;
  }

  function aGravar() {
    var lista = [];
    atual.clientes.forEach(function (c) {
      (c.linhas || []).forEach(function (l) { if (l.situacao !== 'igual' && c.marcar[l.chave]) lista.push(l); });
    });
    return lista;
  }
  function contar() {
    var n = aGravar().length, btn = janela().querySelector('.ofs-gravar');
    btn.disabled = n === 0;
    btn.textContent = n ? 'Gravar ' + n + ' linha' + (n > 1 ? 's' : '') + ' no sistema' : 'Gravar no sistema';
    var substitui = aGravar().filter(function (l) { return l.situacao === 'outra'; }).length;
    status(substitui ? substitui + ' linha(s) vão substituir o que já está no sistema.' : '', substitui ? 'var(--warning, #b45309)' : '');
  }

  function gravar() {
    var lista = aGravar();
    if (!lista.length) return;
    var btn = janela().querySelector('.ofs-gravar');
    btn.disabled = true;
    status('Gravando no sistema…');
    oracle({ acao: 'gravar', linhas: lista.map(function (l) {
      return { chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, pedido: l.pedido, antes: l.antes, novo: l.novo };
    }) }).then(function (r) {
      var res = {};
      ((r && r.resultados) || []).forEach(function (x) { res[x.chave] = x; });
      var ok = lista.filter(function (l) { return res[l.chave] && res[l.chave].gravadas > 0; });
      var mudou = lista.filter(function (l) { return res[l.chave] && !res[l.chave].erro && !(res[l.chave].gravadas > 0); });
      var falhou = lista.filter(function (l) { return !res[l.chave] || res[l.chave].erro; });
      var partes = [];
      if (ok.length) partes.push(ok.length + ' gravada(s)');
      if (mudou.length) partes.push(mudou.length + ' não gravada(s): mudaram no sistema depois da busca — abra de novo para conferir');
      if (falhou.length) partes.push(falhou.length + ' com erro: ' + ((falhou[0] && res[falhou[0].chave] && res[falhou[0].chave].erro) || ((r && r.erros) || []).join('; ') || 'sem resposta'));
      status(partes.join(' · '), falhou.length || mudou.length ? 'var(--critical)' : 'var(--good)');
      if (ok.length && atual.docId) {
        // fica registrado neste PC (o botão fica verde) — nada vai para o romaneio/servidor
        var docId = atual.docId;
        oracle({ acao: 'registrar', id: docId, linhas: ok, completo: !falhou.length && !mudou.length }).then(function (st) {
          if (st) { situacao[docId] = st; atualizarBotoes(docId); desenharCardPendentes(); }
        });
      }
      // mostra o estado novo do sistema
      if (ok.length || mudou.length) {
        var aviso = { texto: partes.join(' · '), cor: falhou.length || mudou.length ? 'var(--critical)' : 'var(--good)' };
        setTimeout(function () { abrir(atual.docId, Object.assign({}, atual.d), atual.dbApi, atual.nome, aviso); }, 600);
      } else {
        btn.disabled = false;
      }
    });
  }

  // botão para a linha de um romaneio na lista (aparece só no app do PC)
  // o que já foi lançado (e o que ficou para conferir) fica num arquivo deste PC, guardado pelo app
  var situacao = {};
  var botoesPorId = {};
  function pintarBotao(b, st) {
    var lancadas = st && st.linhas && st.linhas.length;
    // o automático (electron/ofs-auto.js) conferiu e não conseguiu decidir tudo sozinho
    var faltaConferir = st && st.completo === false;
    b.className = 'add-btn ' + (lancadas && !faltaConferir ? 'btn-destaque-verde' : 'btn-destaque-branco');
    b.textContent = faltaConferir ? '⚠ Lançar OFs' : lancadas ? '✔ OFs no sistema' : '🧾 Lançar OFs';
    b.style.color = faltaConferir ? 'var(--warning, #b45309)' : '';
    b.title = faltaConferir
      ? 'O lançamento automático não conseguiu decidir tudo sozinho (mais de uma ordem possível, OS ainda não emitida ou ordem com outro texto) — clique para conferir'
      : lancadas
      ? 'OFs lançadas no sistema por este PC — clique para conferir'
      : 'Gravar as OFs deste romaneio na ordem de separação do sistema (como a planilha Inclusor de OF)';
  }
  function atualizarBotoes(docId) {
    (botoesPorId[docId] || []).forEach(function (b) { if (b.isConnected) pintarBotao(b, situacao[docId]); });
    botoesPorId[docId] = (botoesPorId[docId] || []).filter(function (b) { return b.isConnected; });
  }
  aoSaberDisponivel.push(function () {
    if (!disponivel) return;
    oracle({ acao: 'status' }).then(function (todos) {
      situacao = todos && typeof todos === 'object' ? todos : {};
      Object.keys(botoesPorId).forEach(atualizarBotoes);
      desenharCardPendentes();
    });
  });

  // ---- card "OFs para conferir": logo abaixo de CARREGAMENTOS, só quando houver pendência ----
  // Pendência = romaneio que o lançamento automático não conseguiu resolver sozinho (mais de uma
  // ordem possível, OS ainda não emitida ou ordem com outro texto). Sem pendência, o card some.
  var cardPend = null;
  var PEND_DIAS = 7;
  function estiloCard() {
    if (document.getElementById('ofs-card-estilo')) return;
    var st = document.createElement('style');
    st.id = 'ofs-card-estilo';
    st.textContent =
      '.card.card-cristal-laranja{ background:linear-gradient(160deg, rgba(245,158,11,0.24), rgba(245,158,11,0.07) 55%, rgba(245,158,11,0.13));' +
      ' border:1px solid rgba(251,191,36,0.55); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);' +
      ' box-shadow:0 6px 28px rgba(217,119,6,0.20), inset 0 1px 0 rgba(255,255,255,0.08); }' +
      '.card.card-cristal-laranja h2{ color:#d97706; font-size:20px; }' +
      '.ofs-pend-linha{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 0; border-bottom:1px solid var(--grid); }' +
      '.ofs-pend-linha:last-child{ border-bottom:none; }';
    document.head.appendChild(st);
  }
  function desenharCardPendentes() {
    var limite = Date.now() - PEND_DIAS * 86400000;
    var ids = Object.keys(situacao).filter(function (id) {
      var st = situacao[id];
      return st && st.completo === false && st.romaneio && Date.parse(st.em || '') >= limite;
    }).sort(function (a, b) { return String(situacao[b].em).localeCompare(String(situacao[a].em)); });
    var ancora = document.getElementById('pend-list');
    var cardCarreg = ancora && ancora.closest('.card');
    if (!ids.length || !cardCarreg || !disponivel) {
      if (cardPend) { cardPend.remove(); cardPend = null; }
      return;
    }
    estiloCard();
    if (!cardPend) {
      cardPend = document.createElement('div');
      cardPend.className = 'card card-cristal-laranja';
      cardPend.id = 'ofs-pend-card';
    }
    if (cardPend.previousElementSibling !== cardCarreg) cardCarreg.parentNode.insertBefore(cardPend, cardCarreg.nextSibling);
    cardPend.innerHTML = '<h2>OFs PARA CONFERIR</h2>' +
      '<p class="foot-note" style="margin:6px 0 6px;">O lançamento automático não conseguiu decidir sozinho onde gravar a OF destes romaneios ' +
      '(mais de uma ordem possível, OS ainda não emitida ou ordem com outro texto). Confira e grave — ou escolha não lançar.</p>' +
      ids.map(function (id) {
        var r = situacao[id].romaneio;
        var nomes = (r.clientes || []).map(function (c) { return c.nome; }).join(' + ') || r.cliente || 'Romaneio';
        var ofs = [];
        (r.clientes || []).forEach(function (c) { (c.itens || []).forEach(function (i) { ofsDoTexto(i.ofobs).forEach(function (o) { ofs.push(o); }); }); });
        return '<div class="ofs-pend-linha">' +
          '<div style="flex:1 1 220px; min-width:0;"><b>' + esc(nomes) + '</b>' +
            '<div class="foot-note" style="margin:2px 0 0;">' + esc(dataBr(r.data || r.criadoEm)) + (ofs.length ? ' · OF ' + esc(ofs.join(', ')) : '') + '</div></div>' +
          '<button type="button" class="add-btn btn-destaque-branco ofs-pend-abrir" data-id="' + esc(id) + '" style="flex:0 0 auto; margin-top:0;">⚠ Conferir e lançar</button>' +
          '<button type="button" class="add-btn ofs-pend-ignorar" data-id="' + esc(id) + '" title="Não gravar nada no sistema para este romaneio e tirá-lo daqui" style="flex:0 0 auto; margin-top:0; color:var(--critical); border-color:var(--critical);">Não lançar</button>' +
        '</div>';
      }).join('');
    cardPend.querySelectorAll('.ofs-pend-abrir').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        abrir(id, situacao[id].romaneio, null, null);
      });
    });
    cardPend.querySelectorAll('.ofs-pend-ignorar').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        oracle({ acao: 'registrar', id: id, linhas: [], completo: true }).then(function (st) {
          if (st) { situacao[id] = st; atualizarBotoes(id); desenharCardPendentes(); }
        });
      });
    });
  }
  // a lista de CARREGAMENTOS é redesenhada pela página: mantém o card logo abaixo dela
  // (e desenha assim que a lista existir: a página é grande e o status pode chegar antes dela)
  setInterval(function () {
    if (!cardPend) { if (disponivel) desenharCardPendentes(); return; }
    var ancora = document.getElementById('pend-list'), cardCarreg = ancora && ancora.closest('.card');
    if (cardCarreg && cardPend.previousElementSibling !== cardCarreg) cardCarreg.parentNode.insertBefore(cardPend, cardCarreg.nextSibling);
  }, 3000);

  function botao(docId, d, dbApi, nome) {
    var b = document.createElement('button');
    b.type = 'button';
    pintarBotao(b, situacao[docId]);
    (botoesPorId[docId] = botoesPorId[docId] || []).push(b);
    b.addEventListener('click', function () { abrir(docId, d, dbApi, nome); });
    var mostrar = function () { b.hidden = !disponivel; };
    if (disponivel === null) { b.hidden = true; aoSaberDisponivel.push(mostrar); } else mostrar();
    return b;
  }

  // ---- direto na calculadora: botão ⇪ ao lado do OF/OBS de cada linha ----
  // Um clique grava a OF daquela linha na ordem de separação do produto (mesma quantidade, data
  // mais perto de hoje; no par Matriz/Filial, a Filial). Com dúvida, ou se a ordem já tiver outro
  // texto, mostra a escolha ali mesmo. Não grava sozinho ao digitar (OF pela metade iria junto).
  // as duas telas com OF por linha: o formulário "Gerar romaneio" e a Carga Fácil
  var TIPOS = [
    { linha: '.item-row', of: '.ofobs-input', rp: '.rp-input', qtd: '.qtd-input' },
    { linha: '.cf-item-row', of: '.cf-item-of', rp: '.cf-item-fardo', qtd: '.cf-item-qtd', avisoAntes: '.cf-item-total' }
  ];
  // na Carga Fácil o RP vem como "0143-002/26 — 38 pçs/fardo": fica só o código
  function lerRp(row, tipo) { return String(((row.querySelector(tipo.rp) || {}).value) || '').split(' — ')[0].split(' (')[0].trim(); }
  function lerQtd(row, tipo) { return parseFloat(String(((row.querySelector(tipo.qtd) || {}).value) || '').replace(/\./g, '').replace(',', '.')) || 0; }
  // a Carga Fácil redesenha as linhas a cada mudança: lembra o que já foi gravado
  var lembrados = {};
  function chaveLembrar(rp, of) { return norm(rp) + '|' + String(of || '').trim(); }

  function prepararLinha(row, tipo) {
    var input = row && row.querySelector(tipo.of);
    if (!input || input.getAttribute('data-ofs')) return;
    input.setAttribute('data-ofs', '1');
    var caixa = document.createElement('div');
    caixa.style.cssText = 'display:flex; gap:4px; align-items:center;';
    input.parentNode.insertBefore(caixa, input);
    caixa.appendChild(input);
    input.style.flex = '1 1 auto';
    input.style.minWidth = '0';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⇪';
    btn.title = 'Gravar esta OF no sistema (ordem de separação)';
    btn.style.cssText = 'flex:0 0 auto; height:34px; min-width:34px; border-radius:6px; border:1px solid var(--accent-blue, #2563eb); background:none; color:var(--accent-blue, #2563eb); cursor:pointer; font-size:16px; line-height:1;';
    caixa.appendChild(btn);
    var aviso = document.createElement('div');
    aviso.style.cssText = 'font-size:11px; margin-top:3px; line-height:1.35;';
    var antesDe = tipo.avisoAntes && row.querySelector(tipo.avisoAntes);
    if (antesDe) antesDe.parentNode.insertBefore(aviso, antesDe); else caixa.parentNode.insertBefore(aviso, caixa.nextSibling);
    input._ofsAviso = aviso;
    input._ofsTipo = tipo;
    var mostrar = function () { btn.hidden = !disponivel; if (!disponivel) aviso.innerHTML = ''; };
    if (disponivel === null) { btn.hidden = true; aoSaberDisponivel.push(mostrar); } else mostrar();

    function dizer(html, cor) { aviso.innerHTML = html; aviso.style.color = cor || ''; }
    function marcarGravado(html) {
      aviso.setAttribute('data-gravado', input.value);
      lembrados[chaveLembrar(lerRp(row, tipo), input.value)] = html;
      dizer(html, 'var(--good)');
    }
    var lembrado = lembrados[chaveLembrar(lerRp(row, tipo), input.value)];
    if (lembrado && input.value.trim()) marcarGravado(lembrado);
    // mudou a OF depois de gravar: volta a oferecer o botão
    input.addEventListener('input', function () { if (aviso.getAttribute('data-gravado') !== input.value) dizer(''); });

    btn.addEventListener('click', function () {
      var rp = lerRp(row, tipo);
      var qtd = lerQtd(row, tipo);
      var ofs = ofsDoTexto(input.value);
      if (!rp) return dizer('Preencha o RP do produto.', 'var(--critical)');
      if (!ofs.length) return dizer('Digite o número da OF.', 'var(--critical)');
      btn.disabled = true;
      dizer('Procurando a ordem de separação…', 'var(--text-secondary, #666)');
      oracle({ acao: 'buscar', codpros: [rp], agrupas: [], dias: 10 }).then(function (r) {
        btn.disabled = false;
        var linhas = ((r && r.linhas) || []).filter(function (l) { return norm(l.codpro) === norm(rp); });
        if (!linhas.length) {
          var erro = r && r.erros && r.erros.length ? ' (' + esc(r.erros.join('; ')) + ')' : '';
          return dizer('Nenhuma ordem de separação deste produto nos últimos 10 dias' + erro + '. Se a ordem ainda não foi emitida, tente depois — ou use "🧾 Lançar OFs" no romaneio.', 'var(--critical)');
        }
        var cliente = { nome: '', itens: [{ rp: rp, qtd: qtd, ofs: ofs }] };
        var plano = planejar(cliente, linhas, new Date().toISOString().slice(0, 10));
        var x = plano.itens[0];
        if (x.escolhida) return conferirEGravar(x.escolhida);
        escolher(x.opcoes);
        function escolher(opcoes) {
          var sel = '<select style="max-width:100%; font-size:11px; padding:2px;">' + opcoes.map(function (g, i) {
            return '<option value="' + i + '">' + esc((g.empresa === 'matriz' ? 'Matriz' : 'Filial') + ' ' + g.agrupa + ' — ' + dataBr(g.data) +
              ' — ' + g.qtd + ' pç' + (g.mesmaQtd ? ' (mesma qtd)' : ' (qtd diferente)')) + '</option>';
          }).join('') + '</select>';
          dizer('Mais de uma ordem possível — escolha: ' + sel + ' <button type="button" class="ofs-ok" style="font-size:11px;">Gravar</button>', 'var(--warning, #b45309)');
          aviso.querySelector('.ofs-ok').addEventListener('click', function () {
            conferirEGravar(opcoes[Number(aviso.querySelector('select').value)]);
          });
        }
        function conferirEGravar(g) {
          x.escolhida = g;
          var paraGravar = linhasDoPlano(plano);
          var iguais = paraGravar.filter(function (l) { return l.situacao === 'igual'; });
          var outras = paraGravar.filter(function (l) { return l.situacao === 'outra'; });
          var nome = (g.empresa === 'matriz' ? 'Matriz' : 'Filial') + ' ' + g.agrupa;
          if (iguais.length === paraGravar.length) {
            return marcarGravado('✔ Já está no sistema (' + esc(nome) + ').');
          }
          if (outras.length) {
            dizer('A ordem ' + esc(nome) + ' já tem "' + esc(outras[0].antes) + '". ' +
              '<button type="button" class="ofs-sub" style="font-size:11px;">Substituir</button> ' +
              '<button type="button" class="ofs-junta" style="font-size:11px;">Juntar as duas</button> ' +
              '<button type="button" class="ofs-nao" style="font-size:11px;">Cancelar</button>', 'var(--warning, #b45309)');
            aviso.querySelector('.ofs-sub').addEventListener('click', function () { enviar(paraGravar, nome); });
            aviso.querySelector('.ofs-junta').addEventListener('click', function () {
              paraGravar.forEach(function (l) {
                if (l.situacao !== 'outra') return;
                var todas = ofsDoTexto(l.antes);
                l.ofs.forEach(function (o) { if (todas.indexOf(o) < 0) todas.push(o); });
                l.novo = textoOfs(todas);
              });
              enviar(paraGravar, nome);
            });
            aviso.querySelector('.ofs-nao').addEventListener('click', function () { dizer(''); });
            return;
          }
          enviar(paraGravar, nome);
        }
        function enviar(lista, nome) {
          lista = lista.filter(function (l) { return l.situacao !== 'igual'; });
          btn.disabled = true;
          dizer('Gravando no sistema…', 'var(--text-secondary, #666)');
          oracle({ acao: 'gravar', linhas: lista.map(function (l) {
            return { chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, pedido: l.pedido, antes: l.antes, novo: l.novo };
          }) }).then(function (res) {
            btn.disabled = false;
            var porChave = {};
            ((res && res.resultados) || []).forEach(function (x) { porChave[x.chave] = x; });
            var ok = lista.filter(function (l) { return porChave[l.chave] && porChave[l.chave].gravadas > 0; });
            var erro = lista.map(function (l) { return porChave[l.chave] && porChave[l.chave].erro; }).filter(Boolean)[0] || ((res && res.erros) || [])[0];
            if (ok.length === lista.length) {
              marcarGravado('✔ Gravado no sistema (' + esc(nome) + '): ' + esc(ok.map(function (l) { return l.novo.trim(); }).join(' ')));
            } else if (erro) {
              dizer('Não gravou: ' + esc(erro), 'var(--critical)');
            } else {
              dizer('Não gravou: a ordem mudou no sistema agora há pouco. Clique em ⇪ de novo para conferir.', 'var(--critical)');
            }
          });
        }
      });
    });
  }

  // ---- romaneio criado (ou editado mudando produtos/OFs): o app lança as OFs sozinho ----
  // (electron/ofs-auto.js). Vai direto para o app neste PC, que fala só com o Oracle: não usa o
  // servidor nem o Neon.
  window.addEventListener('ripack-gravou', function (ev) {
    var g = ev.detail || {};
    if (g.col !== 'romaneios' || !g.doc || !disponivel) return;
    if (g.op !== 'set' && !(g.op === 'update' && g.campos && g.campos.clientes)) return;
    var d = g.doc;
    oracle({ acao: 'auto', id: g.id, romaneio: { clientes: d.clientes, cliente: d.cliente, data: d.data, criadoEm: d.criadoEm } }).then(function (st) {
      if (st && typeof st === 'object' && !Array.isArray(st) && 'completo' in st) { situacao[g.id] = st; atualizarBotoes(g.id); desenharCardPendentes(); }
    });
  });

  // linhas da calculadora: as que já existem e as que forem criadas
  function vigiarCalculadora() {
    if (!document.body) return setTimeout(vigiarCalculadora, 200);
    var varrer = function () {
      TIPOS.forEach(function (tipo) {
        document.querySelectorAll(tipo.linha).forEach(function (row) { if (row.querySelector(tipo.of)) prepararLinha(row, tipo); });
      });
    };
    varrer();
    var agendado = null;
    new MutationObserver(function () {
      if (agendado) return;
      agendado = setTimeout(function () { agendado = null; varrer(); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }
  vigiarCalculadora();

  window.ripackOfs = { botao: botao };
})();
