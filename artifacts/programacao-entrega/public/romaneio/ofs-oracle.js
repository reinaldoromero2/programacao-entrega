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
  // a pergunta pode se perder se a página carregar antes do app estar ouvindo: sem resposta em
  // 8 s, pergunta de novo (antes ficava 150 s esperando e o botão e o lançamento sumiam de vez)
  function perguntarDisponivel() {
    var respondeu = false;
    var id = proximo++;
    pedidos[id] = function (r) {
      respondeu = true;
      disponivel = !!(r && r.ok);
      aoSaberDisponivel.forEach(function (f) { f(); });
      aoSaberDisponivel = [];
    };
    window.parent.postMessage({ ripack: 'ofs-oracle', id: id, entrada: { acao: 'disponivel' } }, '*');
    setTimeout(function () {
      if (respondeu) return;
      delete pedidos[id];
      perguntarDisponivel();
    }, 8000);
  }
  perguntarDisponivel();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var R = window.ripackOfsRegras;
  var dataBr = R.dataBr, diasEntre = R.diasEntre, ofsDoTexto = R.ofsDoTexto;
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
          '<button type="button" class="add-btn btn-destaque-verde ofs-gravar" disabled>Lançar todas</button>' +
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
      // tudo já está no sistema (lançado no Inclusor ou em outro PC): anota como resolvido neste PC,
      // e o "⚠ Lançar OFs" vermelho sai do card do romaneio e do card de pendentes
      var tudoLancado = !atual.erros.length && atual.clientes.every(function (c) {
        var ls = linhasDoPlano(c.plano);
        return c.plano.completo && ls.length && ls.every(function (l) { return l.situacao === 'igual'; });
      });
      var st = situacao[docId];
      if (tudoLancado && !(st && st.completo === true)) {
        oracle({ acao: 'registrar', id: docId, linhas: [], completo: true }).then(function (novo) {
          if (novo && typeof novo === 'object' && 'completo' in novo) { situacao[docId] = novo; atualizarBotoes(docId); desenharCardPendentes(); }
        });
      }
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
      c.plano.itens.forEach(function (x) {
        var i = x.item;
        html += '<div class="foot-note" style="margin:0 0 4px;"><b>' + esc(i.rp) + '</b> × ' + esc(i.qtd) + ' — ' +
          (i.ofs.length ? 'OF ' + esc(i.ofs.join(', ')) : '<span style="color:var(--critical)">sem número de OF no romaneio' + (i.ofobs ? ' ("' + esc(i.ofobs) + '")' : '') + '</span>');
        if (i.ofs.length && !x.opcoes.length) html += ' — <span style="color:var(--critical)">nenhuma OS deste produto no dia do romaneio</span>';
        else if (i.ofs.length && !x.escolhidas.length) html += ' — <span style="color:var(--warning, #b45309)">mais de uma combinação possível: marque as OS certas</span>';
        else if (x.escolhidas.length > 1) html += ' — <span style="color:var(--good)">' + x.escolhidas.length + ' OS somam ' + esc(i.qtd) + '</span>';
        html += '</div>';
      });
      // todas as OS do dia de cada produto, uma por linha; as escolhidas pelo app vêm marcadas
      var linhas = linhasDoPlano(c.plano, true);
      linhas.sort(function (a, b) {
        return a.codpro.localeCompare(b.codpro) || ((b.escolhida ? 1 : 0) - (a.escolhida ? 1 : 0)) || (Number(b.agrupa) - Number(a.agrupa));
      });
      c.linhas = linhas;
      if (linhas.length) {
        html += '<table style="width:100%; border-collapse:collapse; margin-top:6px; font-size:12px;">' +
          '<tr style="text-align:left; color:var(--text-secondary);"><th style="padding:3px;"></th><th style="padding:3px;">Agrup.</th><th style="padding:3px;">OS</th><th style="padding:3px;">Produto</th><th style="padding:3px; text-align:right;">Qtd</th><th style="padding:3px;">Pedido</th><th style="padding:3px;">No sistema hoje</th><th style="padding:3px;">Vai gravar</th></tr>';
        linhas.forEach(function (l) {
          var marcado = c.marcar[l.chave] !== undefined ? c.marcar[l.chave] : (l.escolhida && l.situacao === 'vazia');
          c.marcar[l.chave] = marcado;
          var hoje = l.situacao === 'vazia' ? '<i style="color:var(--text-secondary)">vazio</i>'
            : l.situacao === 'igual' ? '<span style="color:var(--good)">✔ já lançado</span>'
            : '<span style="color:var(--warning, #b45309)">' + esc(l.antes) + '</span>';
          html += '<tr style="border-top:1px solid var(--grid);' + (l.escolhida ? '' : ' opacity:0.7;') + '">' +
            '<td style="padding:3px;"><input type="checkbox" class="ofs-marca" data-ci="' + ci + '" data-chave="' + esc(l.chave) + '"' +
              (l.situacao === 'igual' ? ' disabled' : '') + (marcado && l.situacao !== 'igual' ? ' checked' : '') +
              ' title="' + (l.situacao === 'outra' ? 'Marque para substituir o que já está no sistema' : 'Gravar esta OS') + '"></td>' +
            '<td style="padding:3px;">' + esc((l.empresa === 'matriz' ? 'M ' : 'F ') + l.agrupa) + '</td>' +
            '<td style="padding:3px;">' + esc(l.codigo) + '</td><td style="padding:3px;">' + esc(l.codpro) + '</td>' +
            '<td style="padding:3px; text-align:right;">' + esc(l.qtd) + '</td><td style="padding:3px;">' + esc(l.pedido) + '</td>' +
            '<td style="padding:3px;">' + hoje + '</td><td style="padding:3px; font-family:monospace;">' + esc(l.novo.trim()) + '</td></tr>';
        });
        html += '</table>';
      }
      html += '</div>';
    });
    corpo.innerHTML = html;
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
    btn.textContent = n ? 'Lançar todas (' + n + ' OS)' : 'Lançar todas';
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
    // OFs já lançadas e nada a conferir: o botão sai do card do romaneio (o de "Mais opções" fica)
    b._ofsConcluido = !!(st && st.completo === true);
    b.hidden = !disponivel || (b._ofsConcluido && !b._ofsSempre);
    // no card (só aparece com OF pendente) é vermelho; em "Mais opções", branco pendente e verde lançado
    var noCard = !b._ofsSempre;
    b.className = 'add-btn ' + (noCard ? 'btn-destaque-vermelho' : lancadas && !faltaConferir ? 'btn-destaque-verde' : 'btn-destaque-branco');
    b.textContent = faltaConferir ? '⚠ Lançar OFs' : lancadas ? '✔ OFs no sistema' : '🧾 Lançar OFs';
    b.style.color = faltaConferir && !noCard ? 'var(--warning, #b45309)' : '';
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
      statusLido = true;
      Object.keys(botoesPorId).forEach(atualizarBotoes);
      desenharCardPendentes();
      aVer.splice(0).forEach(function (x) { lancarSeNovo(x.id, x.d); });
    });
  });
  // romaneio de hoje que este PC nunca tentou (feito no celular, em outro PC, ou com o app
  // fechado): lança agora em segundo plano, do mesmo jeito que ao criar
  var statusLido = false, aVer = [], jaPedido = {};
  function deHoje(d) {
    var hoje = new Date().toISOString().slice(0, 10);
    return String(d.data || '').slice(0, 10) === hoje || String(d.criadoEm || '').slice(0, 10) === hoje;
  }
  function lancarSeNovo(id, d) {
    if (!disponivel || jaPedido[id] || situacao[id] || !d || !d.clientes || !deHoje(d)) return;
    if (!statusLido) { aVer.push({ id: id, d: d }); return; }
    jaPedido[id] = true;
    oracle({ acao: 'auto', id: id, romaneio: { clientes: d.clientes, cliente: d.cliente, data: d.data, criadoEm: d.criadoEm } }).then(function (st) {
      if (st && typeof st === 'object' && !Array.isArray(st) && 'completo' in st) { situacao[id] = st; atualizarBotoes(id); desenharCardPendentes(); }
    });
  }
  // o app tenta de novo sozinho os pendentes (a cada 3 min): a cada 1 min a tela relê a situação
  // guardada neste PC (sem rede) e atualiza botões e card — o card some quando a OF é gravada
  var marcaSituacao = '';
  setInterval(function () {
    if (!disponivel) return;
    oracle({ acao: 'status' }).then(function (todos) {
      if (!todos || typeof todos !== 'object') return;
      var marca = JSON.stringify(todos);
      if (marca === marcaSituacao) return;
      marcaSituacao = marca;
      situacao = todos;
      Object.keys(botoesPorId).forEach(atualizarBotoes);
      desenharCardPendentes();
    });
  }, 60 * 1000);

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
          '<button type="button" class="add-btn ofs-pend-ignorar" data-id="' + esc(id) + '" title="Tira este romaneio daqui sem gravar nada. Não apaga nada do sistema: o que já está na OS (Inclusor) continua lá" style="flex:0 0 auto; margin-top:0; color:var(--critical); border-color:var(--critical);">Cancelar</button>' +
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

  // sempre=true: o botão de "Mais opções", que continua lá mesmo com as OFs já lançadas
  function botao(docId, d, dbApi, nome, sempre) {
    var b = document.createElement('button');
    b.type = 'button';
    b._ofsSempre = !!sempre;
    pintarBotao(b, situacao[docId]);
    (botoesPorId[docId] = botoesPorId[docId] || []).push(b);
    b.addEventListener('click', function () { abrir(docId, d, dbApi, nome); });
    var mostrar = function () { b.hidden = !disponivel || (b._ofsConcluido && !b._ofsSempre); lancarSeNovo(docId, d); };
    if (disponivel === null) { b.hidden = true; aoSaberDisponivel.push(mostrar); } else mostrar();
    return b;
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

  window.ripackOfs = { botao: botao };
})();
