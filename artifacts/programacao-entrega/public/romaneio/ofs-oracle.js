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
    document.body.appendChild(modal);
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
          var rps = c.itens.map(function (i) { return norm(i.rp); });
          var lista = candidatos(c, (r.linhas || []).filter(function (l) { return rps.indexOf(norm(l.codpro)) >= 0; }), dataRomaneio);
          var auto = escolhaAutomatica(c, lista);
          return { cliente: c, lista: lista, escolhido: auto ? auto.empresa + '|' + auto.agrupa : '', marcar: {} };
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
      html += '<div class="foot-note" style="margin:0 0 6px;">' + cli.itens.map(function (i) {
        return esc(i.rp) + ' × ' + esc(i.qtd) + ' — ' + (i.ofs.length ? 'OF ' + esc(i.ofs.join(', ')) : '<span style="color:var(--critical)">sem número de OF no romaneio' + (i.ofobs ? ' ("' + esc(i.ofobs) + '")' : '') + '</span>');
      }).join('<br>') + '</div>';
      if (!c.lista.length) {
        html += '<div class="foot-note" style="color:var(--critical); margin:0;">Nenhuma ordem de separação encontrada com esses produtos nos últimos dias.</div>';
      } else {
        html += '<label class="foot-note" style="display:block; margin:6px 0 4px;">Agrupamento:</label>';
        html += '<select data-ci="' + ci + '" class="ofs-escolha" style="width:100%; padding:6px; border-radius:6px; border:1px solid var(--border); background:var(--surface, #fff); color:inherit;">';
        html += '<option value="">— escolha o agrupamento —</option>';
        c.lista.forEach(function (g) {
          var v = g.empresa + '|' + g.agrupa;
          html += '<option value="' + esc(v) + '"' + (v === c.escolhido ? ' selected' : '') + '>' +
            esc((g.empresa === 'matriz' ? 'Matriz' : 'Filial') + ' — agrupamento ' + g.agrupa + ' — ' + dataBr(g.data) +
              ' — ' + g.cobertos + ' de ' + cli.itens.length + ' produto(s) com a mesma quantidade') + '</option>';
        });
        html += '</select>';
        if (!c.escolhido && c.lista.length) {
          html += '<div class="foot-note" style="color:var(--warning, #b45309); margin:4px 0 0;">Mais de uma opção possível (ou nenhuma com tudo igual): escolha a certa.</div>';
        }
        var g = c.lista.filter(function (x) { return x.empresa + '|' + x.agrupa === c.escolhido; })[0];
        if (g) {
          var linhas = linhasParaGravar(cli, g);
          c.linhas = linhas;
          html += '<table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;">' +
            '<tr style="text-align:left; color:var(--text-secondary);"><th style="padding:3px;"></th><th style="padding:3px;">OS</th><th style="padding:3px;">Produto</th><th style="padding:3px;">Pedido</th><th style="padding:3px;">No sistema hoje</th><th style="padding:3px;">Vai gravar</th></tr>';
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
              '<td style="padding:3px;">' + esc(l.codigo) + '</td><td style="padding:3px;">' + esc(l.codpro) + '</td><td style="padding:3px;">' + esc(l.pedido) + '</td>' +
              '<td style="padding:3px;">' + hoje + '</td><td style="padding:3px; font-family:monospace;">' + esc(l.novo.trim()) + '</td></tr>';
          });
          html += '</table>';
          if (!linhas.length) html += '<div class="foot-note" style="margin:6px 0 0;">Nada a gravar neste agrupamento (produtos sem OF no romaneio).</div>';
        } else {
          c.linhas = [];
        }
      }
      html += '</div>';
    });
    corpo.innerHTML = html;
    corpo.querySelectorAll('.ofs-escolha').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var c = atual.clientes[Number(sel.getAttribute('data-ci'))];
        c.escolhido = sel.value;
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
      if (ok.length && atual.dbApi && atual.docId) {
        // fica registrado no romaneio (o botão fica verde)
        var registro = (atual.d.ofsLancadas && atual.d.ofsLancadas.linhas) || [];
        ok.forEach(function (l) {
          registro = registro.filter(function (x) { return x.chave !== l.chave; });
          registro.push({ chave: l.chave, empresa: l.empresa, agrupa: l.agrupa, codigo: l.codigo, codpro: l.codpro, texto: l.novo.trim() });
        });
        atual.dbApi.collection('romaneios').doc(atual.docId).update({
          ofsLancadas: { em: new Date().toISOString(), por: atual.nome || null, linhas: registro }
        }).catch(function () {});
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
  function botao(docId, d, dbApi, nome) {
    var b = document.createElement('button');
    b.type = 'button';
    var lancadas = d && d.ofsLancadas && d.ofsLancadas.linhas && d.ofsLancadas.linhas.length;
    b.className = 'add-btn ' + (lancadas ? 'btn-destaque-verde' : 'btn-destaque-branco');
    b.textContent = lancadas ? '✔ OFs no sistema' : '🧾 Lançar OFs';
    b.title = lancadas
      ? 'OFs já lançadas no sistema' + (d.ofsLancadas.por ? ' por ' + d.ofsLancadas.por : '') + ' — clique para conferir'
      : 'Gravar as OFs deste romaneio na ordem de separação do sistema (como a planilha Inclusor de OF)';
    b.addEventListener('click', function () { abrir(docId, d, dbApi, nome); });
    var mostrar = function () { b.hidden = !disponivel; };
    if (disponivel === null) { b.hidden = true; aoSaberDisponivel.push(mostrar); } else mostrar();
    return b;
  }

  // ---- direto na calculadora: botão ⇪ ao lado do OF/OBS de cada linha ----
  // Um clique grava a OF daquela linha na ordem de separação do produto (mesma quantidade, data
  // mais perto de hoje; no par Matriz/Filial, a Filial). Com dúvida, ou se a ordem já tiver outro
  // texto, mostra a escolha ali mesmo. Não grava sozinho ao digitar (OF pela metade iria junto).
  function prepararLinha(row) {
    var input = row && row.querySelector('.ofobs-input');
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
    caixa.parentNode.insertBefore(aviso, caixa.nextSibling);
    var mostrar = function () { btn.hidden = !disponivel; if (!disponivel) aviso.innerHTML = ''; };
    if (disponivel === null) { btn.hidden = true; aoSaberDisponivel.push(mostrar); } else mostrar();

    function dizer(html, cor) { aviso.innerHTML = html; aviso.style.color = cor || ''; }
    // mudou a OF depois de gravar: volta a oferecer o botão
    input.addEventListener('input', function () { if (aviso.getAttribute('data-gravado') !== input.value) dizer(''); });

    btn.addEventListener('click', function () {
      var rp = ((row.querySelector('.rp-input') || {}).value || '').trim();
      var qtd = parseFloat(String((row.querySelector('.qtd-input') || {}).value || '').replace(/\./g, '').replace(',', '.')) || 0;
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
        var lista = candidatos(cliente, linhas, new Date().toISOString().slice(0, 10));
        var auto = escolhaAutomatica(cliente, lista);
        if (auto) return conferirEGravar(auto);
        escolher(lista);
        function escolher(opcoes) {
          var sel = '<select style="max-width:100%; font-size:11px; padding:2px;">' + opcoes.map(function (g, i) {
            return '<option value="' + i + '">' + esc((g.empresa === 'matriz' ? 'Matriz' : 'Filial') + ' ' + g.agrupa + ' — ' + dataBr(g.data) +
              (g.cobertos ? ' — mesma qtd' : ' — qtd diferente')) + '</option>';
          }).join('') + '</select>';
          dizer('Mais de uma ordem possível — escolha: ' + sel + ' <button type="button" class="ofs-ok" style="font-size:11px;">Gravar</button>', 'var(--warning, #b45309)');
          aviso.querySelector('.ofs-ok').addEventListener('click', function () {
            conferirEGravar(opcoes[Number(aviso.querySelector('select').value)]);
          });
        }
        function conferirEGravar(g) {
          var paraGravar = linhasParaGravar(cliente, g);
          var iguais = paraGravar.filter(function (l) { return l.situacao === 'igual'; });
          var outras = paraGravar.filter(function (l) { return l.situacao === 'outra'; });
          var nome = (g.empresa === 'matriz' ? 'Matriz' : 'Filial') + ' ' + g.agrupa;
          if (iguais.length === paraGravar.length) {
            aviso.setAttribute('data-gravado', input.value);
            return dizer('✔ Já está no sistema (' + esc(nome) + ').', 'var(--good)');
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
              aviso.setAttribute('data-gravado', input.value);
              dizer('✔ Gravado no sistema (' + esc(nome) + '): ' + esc(ok.map(function (l) { return l.novo.trim(); }).join(' ')), 'var(--good)');
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

  // linhas da calculadora: as que já existem e as que forem criadas
  function vigiarCalculadora() {
    if (!document.body) return setTimeout(vigiarCalculadora, 200);
    var varrer = function () {
      document.querySelectorAll('.item-row').forEach(function (row) { if (row.querySelector('.ofobs-input')) prepararLinha(row); });
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
