// Substitui o runtime do artefato do claude.ai (window.claude.use) para o Romaneio rodar no app.
// - claude.use('db'): o mesmo jeito do Firestore que a página usa (collection/doc/where "=="/
//   orderBy/limit/get/add/set/update/delete/onSnapshot), gravando no servidor do app
//   (/api/romaneio). Mudanças de outros aparelhos chegam por long-poll em /api/romaneio/changes.
// - claude.use('downloads'): save({ filename, data: Blob }) vira um download comum.
(function () {
  'use strict';

  var API_PADRAO = 'https://programa-odeentrega.onrender.com';
  var api = API_PADRAO;
  try {
    // para teste: ?api=http://127.0.0.1:8787 (fica guardado neste aparelho; ?api=padrao volta)
    var pedido = new URLSearchParams(location.search).get('api');
    if (pedido === 'padrao') localStorage.removeItem('ripack_romaneio_api');
    else if (pedido) localStorage.setItem('ripack_romaneio_api', pedido);
    api = localStorage.getItem('ripack_romaneio_api') || API_PADRAO;
  } catch (e) {}
  // raiz da API do app, também usada pela página (ex.: "Inserir programação" -> /api/entregas)
  window.__ripackApiBase = api.replace(/\/+$/, '');
  var BASE = window.__ripackApiBase + '/api/romaneio';

  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function copia(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function erroHttp(status, corpo) {
    var e = new Error((corpo && corpo.error) || ('HTTP ' + status));
    e.status = status;
    e.code = status === 404 ? 'not-found' : status >= 500 ? 'unavailable' : 'invalid-argument';
    return e;
  }

  function http(method, caminho, corpo) {
    return fetch(BASE + caminho, {
      method: method,
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw erroHttp(r.status, j);
        return j;
      });
    });
  }

  // espera crescente entre tentativas (2 s, 4 s, 8 s… até 1 min). No 429 ("pedidos demais", o
  // Cloudflare na frente do Render bloqueando a rede) espera no mínimo 20 s, para não piorar.
  function esperaDaTentativa(tentativa, erro) {
    var ms = Math.min(2000 * Math.pow(2, Math.max(0, tentativa - 1)), 60000);
    if (erro && erro.status === 429) ms = Math.max(ms, 20000);
    return ms * (0.8 + Math.random() * 0.4); // espalha os aparelhos para não tentarem juntos
  }

  // ---- imagens guardadas à parte ----
  // O servidor tira assinatura e desenho da carga de dentro dos documentos e manda só
  // "ripack-arquivo:<hash>" (?arq=1). Cada imagem é baixada uma vez e fica no cache do navegador
  // para sempre (o conteúdo de um hash nunca muda); a página continua recebendo o "data:..." de antes.
  var MARCA_ARQUIVO = /^ripack-arquivo:([0-9a-f]{64})$/;
  var arquivos = {};
  function lerArquivo(hash) {
    if (!arquivos[hash]) {
      arquivos[hash] = fetch(BASE + '/arquivos/' + hash).then(function (r) {
        if (r.status === 404) return 'ripack-arquivo:' + hash; // não deve acontecer: fica a marca
        if (!r.ok) throw erroHttp(r.status, null);
        return r.text();
      });
      arquivos[hash].catch(function () { delete arquivos[hash]; });
    }
    return arquivos[hash];
  }
  function juntarMarcas(v, hashes) {
    if (typeof v === 'string') { var m = MARCA_ARQUIVO.exec(v); if (m) hashes[m[1]] = true; return; }
    if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { juntarMarcas(v[k], hashes); });
  }
  function trocarMarcas(v, conteudo) {
    if (typeof v === 'string') { var m = MARCA_ARQUIVO.exec(v); return m ? conteudo[m[1]] : v; }
    if (Array.isArray(v)) return v.map(function (x) { return trocarMarcas(x, conteudo); });
    if (v && typeof v === 'object') {
      var saida = {};
      Object.keys(v).forEach(function (k) { saida[k] = trocarMarcas(v[k], conteudo); });
      return saida;
    }
    return v;
  }
  // devolve a resposta (um doc ou {docs}) com as imagens no lugar das marcas
  function hidratar(r) {
    if (!r) return r;
    var docs = r.docs || [r], hashes = {};
    docs.forEach(function (d) { juntarMarcas(d.data, hashes); });
    var lista = Object.keys(hashes);
    if (!lista.length) return r;
    return Promise.all(lista.map(lerArquivo)).then(function (textos) {
      var conteudo = {};
      lista.forEach(function (h, i) { conteudo[h] = textos[i]; });
      docs.forEach(function (d) { d.data = trocarMarcas(d.data, conteudo); });
      return r;
    });
  }

  // leitura: insiste enquanto o servidor estiver dormindo/fora (Render grátis demora ~1 min a acordar)
  function lerComInsistencia(caminho) {
    var tentativa = 0;
    caminho += (caminho.indexOf('?') >= 0 ? '&' : '?') + 'arq=1';
    function vai() {
      return http('GET', caminho).then(hidratar).catch(function (e) {
        if (e.status && e.status < 500 && e.status !== 429) throw e;
        tentativa++;
        return esperar(esperaDaTentativa(tentativa, e)).then(vai);
      });
    }
    return vai();
  }

  // ---- snapshots no formato que a página lê ----
  function docSnap(id, data, existe) {
    return {
      id: id,
      exists: !!existe,
      data: function () { return existe ? copia(data) : undefined; }
    };
  }
  function querySnap(docs) {
    var lista = docs.map(function (d) { return docSnap(d.id, d.data, true); });
    return {
      docs: lista,
      empty: lista.length === 0,
      size: lista.length,
      forEach: function (fn) { lista.forEach(fn); }
    };
  }

  // ---- ouvintes (onSnapshot) e acompanhamento de mudanças ----
  // Quando um documento muda, a tela busca SÓ ele (uma vez, para todos os ouvintes) e cada lista
  // se ajusta ali mesmo, com o mesmo filtro/ordem/limite do servidor. Baixar a lista inteira a
  // cada mudança (romaneios com assinatura e desenho = vários MB) derrubava o servidor grátis.
  var ouvintes = [];   // { col, docId?, rodar(), aplicar(mudados) }
  var MAX_INCREMENTAL = 25;

  var lendoDoc = {};
  function lerDoc(col, id) {
    var chave = col + '|' + id;
    if (lendoDoc[chave]) return lendoDoc[chave];
    var p = lerComInsistencia('/docs/' + encodeURIComponent(col) + '/' + encodeURIComponent(id)).then(function (r) {
      return { id: id, data: r.data };
    }, function (e) {
      if (e.status === 404) return { id: id, data: null };
      throw e;
    });
    lendoDoc[chave] = p;
    p.then(function () { delete lendoDoc[chave]; }, function () { delete lendoDoc[chave]; });
    return p;
  }

  // ids: os que mudaram; apagados: ids que já se sabe que sumiram (não precisa buscar)
  function avisarColecao(col, ids, apagados) {
    var alvo = ouvintes.filter(function (o) {
      return o.col === col && (!o.docId || !ids || ids.indexOf(o.docId) >= 0);
    });
    if (!alvo.length) return;
    if (!ids || ids.length > MAX_INCREMENTAL) { alvo.forEach(function (o) { o.rodar(); }); return; }
    apagados = apagados || [];
    Promise.all(ids.map(function (id) {
      return apagados.indexOf(id) >= 0 ? { id: id, data: null } : lerDoc(col, id);
    })).then(function (mudados) {
      alvo.forEach(function (o) { o.aplicar(mudados); });
    }, function () {
      alvo.forEach(function (o) { o.rodar(); });
    });
  }

  // regras do servidor (/api/romaneio/docs) repetidas aqui para ajustar a lista sem buscar tudo
  function textoOrdem(v) { return v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v); }
  function comparar(q) {
    var campo = q._ordem.campo, desc = q._ordem.dir === 'desc';
    return function (a, b) {
      var x = textoOrdem(a.data[campo]), y = textoOrdem(b.data[campo]);
      if (x !== y) {
        if (x === null) return desc ? 1 : -1;     // asc: nulos primeiro; desc: nulos por último
        if (y === null) return desc ? -1 : 1;
        if (x < y) return desc ? 1 : -1;
        if (x > y) return desc ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    };
  }
  function entraNaBusca(q, data) {
    if (!data) return false;
    if (q._filtro && (!(q._filtro.campo in data) || JSON.stringify(data[q._filtro.campo]) !== JSON.stringify(q._filtro.valor))) return false;
    if (q._ordem && !(q._ordem.campo in data)) return false;
    return true;
  }
  // devolve a lista ajustada, ou null quando só buscando de novo dá para garantir o resultado
  function ajustarLista(q, lista, mudados) {
    var nova = lista.slice(), noLimite = q._limite && lista.length >= q._limite;
    for (var i = 0; i < mudados.length; i++) {
      var d = mudados[i], pos = -1;
      for (var j = 0; j < nova.length; j++) { if (nova[j].id === d.id) { pos = j; break; } }
      var entra = entraNaBusca(q, d.data);
      if (pos >= 0) {
        // saiu de uma lista cheia, ou mudou de posição nela: o próximo de fora pode ter que entrar
        if (noLimite && (!entra || (q._ordem && textoOrdem(nova[pos].data[q._ordem.campo]) !== textoOrdem(d.data[q._ordem.campo])))) return null;
        if (entra) nova[pos] = { id: d.id, data: d.data }; else nova.splice(pos, 1);
      } else if (entra) {
        nova.push({ id: d.id, data: d.data });
      }
    }
    if (q._ordem) nova.sort(comparar(q));
    if (q._limite && nova.length > q._limite) nova = nova.slice(0, q._limite);
    return nova;
  }

  var cursor = null, acompanhando = false, falhasSeguidas = 0;
  function acompanhar() {
    if (acompanhando) return;
    acompanhando = true;
    (function laco() {
      var caminho = cursor === null ? '/changes' : '/changes?since=' + cursor;
      http('GET', caminho).then(function (r) {
        falhasSeguidas = 0;
        var porColecao = {}, apagados = {};
        (r.changes || []).forEach(function (c) {
          (porColecao[c.collection] = porColecao[c.collection] || []).push(c.id);
          if (c.deleted) (apagados[c.collection] = apagados[c.collection] || []).push(c.id);
        });
        cursor = r.seq;
        Object.keys(porColecao).forEach(function (col) { avisarColecao(col, porColecao[col], apagados[col]); });
        laco();
      }, function (e) {
        falhasSeguidas++;
        esperar(esperaDaTentativa(falhasSeguidas, e)).then(laco);
      });
    })();
  }

  // q: a Query (para ajustar a lista sem buscar tudo); null para ouvinte de um documento só
  function ouvir(col, docId, buscar, cb, errCb, q) {
    var ativo = true, ultimo = null, rodando = false, deNovo = false, atual = null;
    function entregar(raw, snap) {
      var marca = JSON.stringify(raw);
      if (ativo && marca !== ultimo) {
        ultimo = marca;
        try { cb(snap); } catch (e) { setTimeout(function () { throw e; }); }
      }
    }
    var o = {
      col: col,
      docId: docId,
      aplicar: function (mudados) {
        if (!ativo) return;
        // ainda carregando, ou no meio de uma busca completa: busca de novo depois
        if (rodando || (q && atual === null)) return o.rodar();
        if (docId) {
          var d = mudados.filter(function (m) { return m.id === docId; })[0];
          if (!d) return;
          return entregar(d.data, docSnap(docId, d.data, !!d.data));
        }
        var nova = ajustarLista(q, atual, mudados);
        if (!nova) return o.rodar();
        atual = nova;
        entregar(nova, querySnap(nova));
      },
      rodar: function () {
        if (!ativo) return;
        if (rodando) { deNovo = true; return; }
        rodando = true;
        buscar().then(function (resultado) {
          if (q) atual = resultado.raw;
          entregar(resultado.raw, resultado.snap);
        }, function (e) {
          if (ativo && errCb) { try { errCb(e); } catch (x) {} }
        }).then(function () {
          rodando = false;
          if (deNovo) { deNovo = false; o.rodar(); }
        });
      }
    };
    ouvintes.push(o);
    acompanhar();
    setTimeout(o.rodar, 0);
    return function () {
      ativo = false;
      var i = ouvintes.indexOf(o);
      if (i >= 0) ouvintes.splice(i, 1);
    };
  }

  // ---- referências ----
  function DocRef(col, id) { this.col = col; this.id = id; }
  DocRef.prototype._caminho = function () {
    return '/docs/' + encodeURIComponent(this.col) + '/' + encodeURIComponent(this.id);
  };
  DocRef.prototype._ler = function () {
    var self = this;
    return lerComInsistencia(self._caminho()).then(function (r) {
      return { snap: docSnap(self.id, r.data, true), raw: r.data };
    }, function (e) {
      if (e.status === 404) return { snap: docSnap(self.id, undefined, false), raw: null };
      throw e;
    });
  };
  DocRef.prototype.get = function () { return this._ler().then(function (r) { return r.snap; }); };
  DocRef.prototype.set = function (data) {
    var self = this;
    return http('PUT', self._caminho(), { data: data }).then(function () { avisarColecao(self.col, [self.id]); });
  };
  DocRef.prototype.update = function (data) {
    var self = this;
    return http('PATCH', self._caminho(), { data: data }).then(function () { avisarColecao(self.col, [self.id]); });
  };
  DocRef.prototype['delete'] = function () {
    var self = this;
    return http('DELETE', self._caminho()).then(function () { avisarColecao(self.col, [self.id], [self.id]); });
  };
  DocRef.prototype.onSnapshot = function (cb, errCb) {
    var self = this;
    return ouvir(self.col, self.id, function () { return self._ler(); }, cb, errCb);
  };

  function Query(col, filtro, ordem, limite) {
    this.col = col; this._filtro = filtro || null; this._ordem = ordem || null; this._limite = limite || null;
  }
  Query.prototype.where = function (campo, op, valor) {
    if (op !== '==') throw new Error('Romaneio: só o filtro "==" é suportado (pedido: ' + op + ')');
    return new Query(this.col, { campo: campo, valor: valor }, this._ordem, this._limite);
  };
  Query.prototype.orderBy = function (campo, dir) {
    return new Query(this.col, this._filtro, { campo: campo, dir: dir === 'desc' ? 'desc' : 'asc' }, this._limite);
  };
  Query.prototype.limit = function (n) { return new Query(this.col, this._filtro, this._ordem, n); };
  Query.prototype._caminho = function () {
    var p = [];
    if (this._filtro) p.push('where=' + encodeURIComponent(this._filtro.campo), 'eq=' + encodeURIComponent(JSON.stringify(this._filtro.valor)));
    if (this._ordem) p.push('orderBy=' + encodeURIComponent(this._ordem.campo), 'dir=' + this._ordem.dir);
    if (this._limite) p.push('limit=' + this._limite);
    return '/docs/' + encodeURIComponent(this.col) + (p.length ? '?' + p.join('&') : '');
  };
  Query.prototype._ler = function () {
    return lerComInsistencia(this._caminho()).then(function (r) {
      var docs = (r && r.docs) || [];
      return { snap: querySnap(docs), raw: docs };
    });
  };
  Query.prototype.get = function () { return this._ler().then(function (r) { return r.snap; }); };
  Query.prototype.onSnapshot = function (cb, errCb) {
    var self = this;
    return ouvir(self.col, null, function () { return self._ler(); }, cb, errCb, self);
  };

  function Collection(nome) { Query.call(this, nome); }
  Collection.prototype = Object.create(Query.prototype);
  Collection.prototype.doc = function (id) {
    if (!id) throw new Error('Romaneio: doc() precisa de id');
    return new DocRef(this.col, String(id));
  };
  Collection.prototype.add = function (data) {
    var col = this.col;
    return http('POST', '/docs/' + encodeURIComponent(col), { data: data }).then(function (r) {
      avisarColecao(col, [r.id]);
      return new DocRef(col, r.id);
    });
  };

  var db = { collection: function (nome) { return new Collection(nome); } };

  // ---- downloads ----
  var downloads = {
    save: function (opts) {
      try {
        var url = URL.createObjectURL(opts.data);
        var a = document.createElement('a');
        a.href = url;
        a.download = opts.filename || 'arquivo';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        return Promise.resolve({ status: 'saved' });
      } catch (e) {
        var err = new Error('Não foi possível salvar o arquivo');
        err.code = 'unavailable';
        return Promise.reject(err);
      }
    }
  };

  // ---- ponte com o app (quando o Romaneio roda num iframe da Programação de Entrega) ----
  // O app usa a mesma página para duas telas: o Romaneio e a grade da Programação (#prog-modal).
  // { ripack: 'programacao', abrir: true|false } abre/fecha a grade; o "Sair" da grade, quando
  // aberta pelo app, avisa { ripack: 'programacao-fechou' } para o app voltar à tela inicial.
  if (window.parent !== window) {
    var modoProgramacao = false;
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.ripack !== 'programacao') return;
      modoProgramacao = !!m.abrir;
      var abrir = function () {
        var modal = document.getElementById('prog-modal');
        if (!modal) return setTimeout(abrir, 200);
        if (m.abrir && modal.hidden) { var b = document.getElementById('prog-abrir-btn'); if (b) b.click(); }
        if (!m.abrir && !modal.hidden) modal.hidden = true;
        // botão direito no cliente da Programação: a grade abre filtrada por ele
        if (m.abrir && m.filtroCliente) window.dispatchEvent(new CustomEvent('ripack-filtro-cliente', { detail: m.filtroCliente }));
      };
      abrir();
    });
    document.addEventListener('click', function (ev) {
      var alvo = ev.target && ev.target.closest && ev.target.closest('#prog-close');
      if (alvo && modoProgramacao) {
        modoProgramacao = false;
        window.parent.postMessage({ ripack: 'programacao-fechou' }, '*');
      }
    }, true);
    // a grade fechou por outro caminho (ex.: "Mandar para a calculadora de carga" leva ao
    // romaneio): o app passa a tratar como tela do Romaneio, com a seta › para as outras telas
    (function vigiarGrade() {
      var modal = document.getElementById('prog-modal');
      if (!modal) return setTimeout(vigiarGrade, 300);
      new MutationObserver(function () {
        if (modal.hidden && modoProgramacao) {
          modoProgramacao = false;
          window.parent.postMessage({ ripack: 'grade-virou-romaneio' }, '*');
        }
      }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
    })();
  }

  // ---- copiar imagem (romaneio, TATU, Nathan, carga) dentro do app ----
  // No iframe do app o Chromium costuma recusar navigator.clipboard.write com imagem. Se recusar,
  // a página pede ao app (Electron), que põe a imagem na área de transferência direto.
  if (window.parent !== window && navigator.clipboard && navigator.clipboard.write) {
    var escreverOriginal = navigator.clipboard.write.bind(navigator.clipboard);
    var pedidosCopia = {}, proximoPedido = 1;
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (!m || m.ripack !== 'copiar-imagem-resultado' || !pedidosCopia[m.id]) return;
      var p = pedidosCopia[m.id]; delete pedidosCopia[m.id];
      if (m.ok) p.resolve(); else p.reject(new Error(m.erro || 'O app não conseguiu copiar'));
    });
    var copiarPeloApp = function (itens) {
      var item = itens && itens[0];
      var tipo = item && item.types.filter(function (t) { return /^image\//.test(t); })[0];
      if (!tipo) return Promise.reject(new Error('sem imagem'));
      return item.getType(tipo).then(function (blob) {
        return new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error); };
          r.readAsDataURL(blob);
        });
      }).then(function (dataUrl) {
        return new Promise(function (resolve, reject) {
          var id = proximoPedido++;
          pedidosCopia[id] = { resolve: resolve, reject: reject };
          window.parent.postMessage({ ripack: 'copiar-imagem', id: id, dataUrl: dataUrl }, '*');
          // fora do app (navegador) ninguém responde
          setTimeout(function () { if (pedidosCopia[id]) { delete pedidosCopia[id]; reject(new Error('sem resposta do app')); } }, 4000);
        });
      });
    };
    navigator.clipboard.write = function (itens) {
      return escreverOriginal(itens).catch(function (erro) {
        return copiarPeloApp(itens).catch(function () { throw erro; });
      });
    };
  }

  // ---- zoom próprio: um para o Romaneio, outro para a grade da Programação (RQ C 008) ----
  // A página é a mesma; quando a grade (#prog-modal) abre ou fecha, troca para o zoom dela.
  // Ctrl + / Ctrl - / Ctrl 0 e Ctrl + roda do mouse aqui dentro; no app, os atalhos de
  // teclado chegam do app como { ripack: 'zoom', acao: '+' | '-' | '0' }.
  (function () {
    var MIN = 0.5, MAX = 1.5, PASSO = 0.1;
    var CHAVES = { romaneio: 'ripack_zoom_romaneio', grade: 'ripack_zoom_rqc008' };
    function tela() {
      var m = document.getElementById('prog-modal');
      return m && !m.hidden ? 'grade' : 'romaneio';
    }
    function lido(t) {
      try { var z = parseFloat(localStorage.getItem(CHAVES[t])); return isFinite(z) ? z : 1; } catch (e) { return 1; }
    }
    function aplicar() { document.documentElement.style.zoom = String(lido(tela())); }
    function mudar(acao) {
      var t = tela(), z = acao === '0' ? 1 : lido(t) + (acao === '+' ? PASSO : -PASSO);
      z = Math.min(MAX, Math.max(MIN, Math.round(z * 10) / 10));
      try { localStorage.setItem(CHAVES[t], String(z)); } catch (e) {}
      aplicar();
      avisar(Math.round(z * 100) + '%');
    }
    var aviso = null, timer = null;
    function avisar(texto) {
      if (!document.body) return;
      if (!aviso) {
        aviso = document.createElement('div');
        aviso.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;padding:6px 14px;border-radius:999px;background:rgba(20,20,19,.85);color:#fff;font:600 13px system-ui,sans-serif;pointer-events:none;';
        document.body.appendChild(aviso);
      }
      aviso.textContent = 'Zoom ' + texto;
      aviso.style.display = 'block';
      clearTimeout(timer);
      timer = setTimeout(function () { aviso.style.display = 'none'; }, 1200);
    }
    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (m && m.ripack === 'zoom' && (m.acao === '+' || m.acao === '-' || m.acao === '0')) mudar(m.acao);
    });
    window.addEventListener('keydown', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      var acao = ev.key === '+' || ev.key === '=' || ev.code === 'NumpadAdd' ? '+' : ev.key === '-' || ev.key === '_' || ev.code === 'NumpadSubtract' ? '-' : ev.key === '0' || ev.code === 'Numpad0' ? '0' : '';
      if (!acao) return;
      ev.preventDefault();
      mudar(acao);
    }, true);
    window.addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      mudar(ev.deltaY < 0 ? '+' : '-');
    }, { passive: false, capture: true });
    // a grade abre e fecha mudando o atributo hidden: troca o zoom junto
    function vigiarGrade() {
      var m = document.getElementById('prog-modal');
      if (!m) return setTimeout(vigiarGrade, 300);
      new MutationObserver(aplicar).observe(m, { attributes: true, attributeFilter: ['hidden'] });
      aplicar();
    }
    aplicar();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigiarGrade);
    else vigiarGrade();
  })();

  window.claude = {
    use: function (nome) {
      if (nome === 'db') return Promise.resolve(db);
      if (nome === 'downloads') return Promise.resolve(downloads);
      return Promise.reject(new Error('Recurso não disponível: ' + nome));
    }
  };
})();
