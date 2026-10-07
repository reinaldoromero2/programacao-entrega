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

  // leitura: insiste enquanto o servidor estiver dormindo/fora (Render grátis demora ~1 min a acordar)
  function lerComInsistencia(caminho) {
    var tentativa = 0;
    function vai() {
      return http('GET', caminho).catch(function (e) {
        if (e.status && e.status < 500) throw e;
        tentativa++;
        return esperar(Math.min(2000 * tentativa, 15000)).then(vai);
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
  var ouvintes = [];   // { col, docId?, rodar() }

  function avisarColecao(col, ids) {
    ouvintes.slice().forEach(function (o) {
      if (o.col !== col) return;
      if (o.docId && ids && ids.indexOf(o.docId) < 0) return;
      o.rodar();
    });
  }

  var cursor = null, acompanhando = false;
  function acompanhar() {
    if (acompanhando) return;
    acompanhando = true;
    (function laco() {
      var caminho = cursor === null ? '/changes' : '/changes?since=' + cursor;
      http('GET', caminho).then(function (r) {
        var porColecao = {};
        (r.changes || []).forEach(function (c) { (porColecao[c.collection] = porColecao[c.collection] || []).push(c.id); });
        cursor = r.seq;
        Object.keys(porColecao).forEach(function (col) { avisarColecao(col, porColecao[col]); });
        laco();
      }, function () {
        esperar(3000).then(laco);
      });
    })();
  }

  function ouvir(col, docId, buscar, cb, errCb) {
    var ativo = true, ultimo = null, rodando = false, deNovo = false;
    var o = {
      col: col,
      docId: docId,
      rodar: function () {
        if (!ativo) return;
        if (rodando) { deNovo = true; return; }
        rodando = true;
        buscar().then(function (resultado) {
          var marca = JSON.stringify(resultado.raw);
          if (ativo && marca !== ultimo) {
            ultimo = marca;
            try { cb(resultado.snap); } catch (e) { setTimeout(function () { throw e; }); }
          }
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
    return http('DELETE', self._caminho()).then(function () { avisarColecao(self.col, [self.id]); });
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
    return ouvir(self.col, null, function () { return self._ler(); }, cb, errCb);
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
