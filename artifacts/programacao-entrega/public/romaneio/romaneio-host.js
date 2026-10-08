// Substitui o runtime do artefato do claude.ai (window.claude.use) para o Romaneio rodar no app.
// - claude.use('db'): o mesmo jeito do Firestore que a página usa (collection/doc/where "=="/
//   orderBy/limit/get/add/set/update/delete/onSnapshot). Funciona sem internet: lê e grava numa
//   cópia local (IndexedDB) e uma fila sobe as gravações para o servidor do app (/api/romaneio).
//   Mudanças de outros aparelhos chegam por long-poll em /api/romaneio/changes.
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

  // pedido ao servidor com tempo máximo: servidor travado conta como fora do ar
  function http(method, caminho, corpo, tempoMs) {
    var controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controle ? setTimeout(function () { controle.abort(); }, tempoMs || 20000) : null;
    return fetch(BASE + caminho, {
      method: method,
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store',
      signal: controle ? controle.signal : undefined
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw erroHttp(r.status, j);
        return j;
      });
    }).then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }

  // "não adianta tentar de novo": pedido recusado pelo servidor (não é queda nem sobrecarga)
  function recusadoDeVez(e) { return !!(e && e.status && e.status < 500 && e.status !== 429 && e.status !== 408); }

  // espera crescente entre tentativas (2 s, 4 s, 8 s… até 1 min). No 429 ("pedidos demais", o
  // Cloudflare na frente do Render bloqueando a rede) espera no mínimo 20 s, para não piorar.
  function esperaDaTentativa(tentativa, erro) {
    var ms = Math.min(2000 * Math.pow(2, Math.max(0, tentativa - 1)), 60000);
    if (erro && erro.status === 429) ms = Math.max(ms, 20000);
    return ms * (0.8 + Math.random() * 0.4); // espalha os aparelhos para não tentarem juntos
  }

  // ---- cópia local (funciona sem internet e com o servidor fora) ----
  // Cada aparelho guarda no IndexedDB os documentos que já viu, a fila do que gravou e as imagens.
  // As telas sempre mostram a cópia local; o servidor só atualiza essa cópia. Gravar muda a cópia
  // na hora e entra na fila, que sobe sozinha, em ordem, quando o servidor responde.
  var IDB_NOME = 'ripack-romaneio-offline';
  var idbP = null;
  function idb() {
    if (!idbP) {
      idbP = new Promise(function (resolve) {
        try {
          var req = indexedDB.open(IDB_NOME, 1);
          req.onupgradeneeded = function () {
            var d = req.result;
            if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'k' });
            if (!d.objectStoreNames.contains('fila')) d.createObjectStore('fila', { keyPath: 'n', autoIncrement: true });
            if (!d.objectStoreNames.contains('arquivos')) d.createObjectStore('arquivos', { keyPath: 'h' });
          };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); } // sem IndexedDB (ex.: aba anônima): funciona só na memória
      });
    }
    return idbP;
  }
  function idbFazer(loja, modo, fn) {
    return idb().then(function (d) {
      if (!d) return undefined;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(loja, modo), r = fn(tx.objectStore(loja));
          tx.oncomplete = function () { resolve(r && 'result' in r ? r.result : undefined); };
          tx.onerror = tx.onabort = function () { resolve(undefined); };
        } catch (e) { resolve(undefined); }
      });
    });
  }

  function chave(col, id) { return col + '|' + id; }
  var local = {};      // col -> { id -> data }
  var fila = [];       // [{ n, op: 'set'|'update'|'delete', col, id, data }]
  var pendentes = {};  // chave -> gravações deste doc ainda na fila (o servidor ainda não tem)
  var CONHECIDAS_KEY = 'ripack_romaneio_colecoes';
  var conhecidas = {};
  try { conhecidas = JSON.parse(localStorage.getItem(CONHECIDAS_KEY) || '{}') || {}; } catch (e) {}
  function marcarConhecida(col) {
    if (conhecidas[col]) return;
    conhecidas[col] = true;
    try { localStorage.setItem(CONHECIDAS_KEY, JSON.stringify(conhecidas)); } catch (e) {}
  }

  var pronto = Promise.all([
    idbFazer('docs', 'readonly', function (s) { return s.getAll(); }),
    idbFazer('fila', 'readonly', function (s) { return s.getAll(); })
  ]).then(function (r) {
    (r[0] || []).forEach(function (d) { (local[d.col] = local[d.col] || {})[d.id] = d.data; });
    fila = (r[1] || []).sort(function (a, b) { return a.n - b.n; });
    fila.forEach(function (g) { g.salvo = Promise.resolve(g.n); });
    fila.forEach(function (g) { var k = chave(g.col, g.id); pendentes[k] = (pendentes[k] || 0) + 1; });
  }, function () {});

  // data null = apagado
  function guardarLocal(col, id, data) {
    var c = local[col] = local[col] || {};
    if (data === null || data === undefined) {
      if (!(id in c)) return;
      delete c[id];
      idbFazer('docs', 'readwrite', function (s) { return s['delete'](chave(col, id)); });
    } else {
      c[id] = data;
      idbFazer('docs', 'readwrite', function (s) { return s.put({ k: chave(col, id), col: col, id: id, data: data }); });
    }
  }

  // ---- imagens guardadas à parte ----
  // O servidor tira assinatura e desenho da carga de dentro dos documentos e manda só
  // "ripack-arquivo:<hash>" (?arq=1). Cada imagem é baixada uma vez e guardada no aparelho; a
  // página continua recebendo o "data:..." de antes.
  var MARCA_ARQUIVO = /^ripack-arquivo:([0-9a-f]{64})$/;
  var arquivos = {};
  function lerArquivo(hash) {
    if (!arquivos[hash]) {
      arquivos[hash] = idbFazer('arquivos', 'readonly', function (s) { return s.get(hash); }).then(function (guardado) {
        if (guardado) return guardado.v;
        var controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controle) setTimeout(function () { controle.abort(); }, 20000);
        return fetch(BASE + '/arquivos/' + hash, { signal: controle ? controle.signal : undefined }).then(function (r) {
          if (!r.ok) throw erroHttp(r.status, null);
          return r.text();
        }).then(function (t) {
          idbFazer('arquivos', 'readwrite', function (s) { return s.put({ h: hash, v: t }); });
          return t;
        });
      });
      // sem servidor e sem cópia: fica a marca por enquanto (tenta de novo na próxima vez)
      arquivos[hash] = arquivos[hash].catch(function () { delete arquivos[hash]; return 'ripack-arquivo:' + hash; });
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
  // [{id, data}] -> nova lista com as imagens no lugar das marcas (a cópia local fica com as marcas)
  function hidratar(docs) {
    var hashes = {};
    docs.forEach(function (d) { juntarMarcas(d.data, hashes); });
    var lista = Object.keys(hashes);
    if (!lista.length) return Promise.resolve(docs);
    return Promise.all(lista.map(lerArquivo)).then(function (textos) {
      var conteudo = {};
      lista.forEach(function (h, i) { conteudo[h] = textos[i]; });
      return docs.map(function (d) { return { id: d.id, data: trocarMarcas(d.data, conteudo) }; });
    });
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

  // ---- buscas na cópia local, com as mesmas regras do servidor (/api/romaneio/docs) ----
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
  function avaliar(q) {
    var todos = local[q.col] || {};
    var lista = Object.keys(todos).map(function (id) { return { id: id, data: todos[id] }; })
      .filter(function (d) { return entraNaBusca(q, d.data); });
    lista.sort(q._ordem ? comparar(q) : function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return q._limite ? lista.slice(0, q._limite) : lista;
  }

  // resposta do servidor para uma busca: atualiza a cópia e tira dela o que o servidor não tem mais
  // (o que ainda está na fila deste aparelho fica como está: é mais novo que o servidor)
  function reconciliar(q, docs) {
    var col = q.col, vistos = {};
    docs.forEach(function (d) {
      vistos[d.id] = true;
      if (!pendentes[chave(col, d.id)]) guardarLocal(col, d.id, d.data);
    });
    var completo = !q._limite || docs.length < q._limite;
    var ultimo = docs[docs.length - 1], cmp = q._ordem ? comparar(q) : null;
    Object.keys(local[col] || {}).forEach(function (id) {
      if (vistos[id] || pendentes[chave(col, id)]) return;
      var d = { id: id, data: local[col][id] };
      if (!entraNaBusca(q, d.data)) return;
      if (completo || (cmp && ultimo && cmp(d, ultimo) < 0)) guardarLocal(col, id, null);
    });
    marcarConhecida(col);
  }

  function caminhoDoc(col, id) { return '/docs/' + encodeURIComponent(col) + '/' + encodeURIComponent(id); }

  // busca um documento no servidor e atualiza a cópia; uma busca por vez para o mesmo doc
  var lendoDoc = {};
  function buscarDocServidor(col, id) {
    var k = chave(col, id);
    if (lendoDoc[k]) return lendoDoc[k];
    var p = http('GET', caminhoDoc(col, id) + '?arq=1').then(function (r) { return r.data; }, function (e) {
      if (e.status === 404) return null;
      throw e;
    }).then(function (data) {
      if (!pendentes[k]) guardarLocal(col, id, data);
    });
    lendoDoc[k] = p;
    p.then(function () { delete lendoDoc[k]; }, function () { delete lendoDoc[k]; });
    return p;
  }
  function buscarQueryServidor(q) {
    return http('GET', q._caminho() + (q._caminho().indexOf('?') >= 0 ? '&' : '?') + 'arq=1').then(function (r) {
      reconciliar(q, (r && r.docs) || []);
    });
  }

  // ---- ouvintes (onSnapshot) ----
  var ouvintes = [];   // { col, docId?, entregar(), atualizar() }
  var MAX_INCREMENTAL = 25;

  // a cópia de uma coleção mudou: cada tela que mostra essa coleção refaz a conta localmente
  var avisosPendentes = {};
  function notificar(col) {
    if (avisosPendentes[col]) return;
    avisosPendentes[col] = true;
    setTimeout(function () {
      delete avisosPendentes[col];
      ouvintes.forEach(function (o) { if (o.col === col) o.entregar(); });
    }, 0);
  }

  // mudanças de outros aparelhos (long-poll): busca só os documentos que mudaram
  function mudouNoServidor(col, ids, apagados) {
    var alvo = ouvintes.filter(function (o) { return o.col === col; });
    if (ids.length > MAX_INCREMENTAL) {
      alvo.forEach(function (o) { o.atualizar(); });
      return;
    }
    Promise.all(ids.map(function (id) {
      if (apagados.indexOf(id) >= 0) {
        if (!pendentes[chave(col, id)]) guardarLocal(col, id, null);
        return null;
      }
      return buscarDocServidor(col, id).catch(function () {});
    })).then(function () { notificar(col); });
  }

  var cursor = null, acompanhando = false, falhasSeguidas = 0;
  function acompanhar() {
    if (acompanhando) return;
    acompanhando = true;
    (function laco() {
      var caminho = cursor === null ? '/changes' : '/changes?since=' + cursor;
      http('GET', caminho, null, 40000).then(function (r) {
        var voltou = falhasSeguidas > 0;
        falhasSeguidas = 0;
        var porColecao = {}, apagados = {};
        (r.changes || []).forEach(function (c) {
          (porColecao[c.collection] = porColecao[c.collection] || []).push(c.id);
          if (c.deleted) (apagados[c.collection] = apagados[c.collection] || []).push(c.id);
        });
        cursor = r.seq;
        Object.keys(porColecao).forEach(function (col) { mudouNoServidor(col, porColecao[col], apagados[col] || []); });
        // o servidor voltou: manda o que ficou na fila e confere as telas
        if (voltou) { enviarFila(); ouvintes.forEach(function (o) { o.atualizar(); }); }
        laco();
      }, function (e) {
        falhasSeguidas++;
        esperar(esperaDaTentativa(falhasSeguidas, e)).then(laco);
      });
    })();
  }

  // q: a Query; null para ouvinte de um documento só
  function ouvir(col, docId, q, cb) {
    var ativo = true, ultimo = null, confirmado = false, jaEntregou = false, falhas = 0, timer = null;
    var o = {
      col: col,
      docId: docId,
      entregar: function () {
        if (!ativo) return;
        var docs;
        if (docId) {
          var data = (local[col] || {})[docId];
          // doc que este aparelho nunca viu: espera o servidor antes de dizer que não existe
          if (data === undefined && !confirmado && !jaEntregou) return;
          docs = data === undefined ? [] : [{ id: docId, data: data }];
        } else {
          docs = avaliar(q);
        }
        var marca = JSON.stringify(docs);
        if (marca === ultimo) return;
        ultimo = marca;
        hidratar(docs).then(function (h) {
          if (!ativo || marca !== ultimo) return;
          jaEntregou = true;
          var snap = docId ? docSnap(docId, h.length ? h[0].data : undefined, h.length > 0) : querySnap(h);
          try { cb(snap); } catch (e) { setTimeout(function () { throw e; }); }
        });
      },
      atualizar: function () {
        if (!ativo) return;
        clearTimeout(timer);
        (docId ? buscarDocServidor(col, docId) : buscarQueryServidor(q)).then(function () {
          falhas = 0;
          confirmado = true;
          notificar(col);
        }, function (e) {
          // sem servidor: fica com a cópia local (lista vazia se este aparelho nunca viu a coleção)
          if (!docId) { confirmado = true; o.entregar(); }
          if (recusadoDeVez(e)) return;
          falhas++;
          timer = setTimeout(o.atualizar, esperaDaTentativa(falhas, e));
        });
      }
    };
    ouvintes.push(o);
    pronto.then(function () {
      if (!ativo) return;
      if (docId || conhecidas[col]) o.entregar();
      o.atualizar();
      acompanhar();
    });
    return function () {
      ativo = false;
      clearTimeout(timer);
      var i = ouvintes.indexOf(o);
      if (i >= 0) ouvintes.splice(i, 1);
    };
  }

  // ---- gravações: na cópia na hora, no servidor pela fila ----
  function gravar(op, col, id, data) {
    return pronto.then(function () {
      var atual = (local[col] || {})[id];
      if (op === 'set') guardarLocal(col, id, copia(data));
      else if (op === 'update' && atual !== undefined) guardarLocal(col, id, Object.assign({}, atual, copia(data)));
      else if (op === 'delete') guardarLocal(col, id, null);
      var registro = { op: op, col: col, id: id, data: op === 'delete' ? null : copia(data) };
      var item = { op: registro.op, col: col, id: id, data: registro.data };
      // salvo: o número da gravação no IndexedDB, para tirar de lá depois de enviada
      item.salvo = idbFazer('fila', 'readwrite', function (s) { return s.add(registro); });
      var k = chave(col, id);
      pendentes[k] = (pendentes[k] || 0) + 1;
      fila.push(item);
      return item.salvo.then(function () {
        notificar(col);
        enviarFila();
      });
    });
  }

  var enviando = false, falhasFila = 0, timerFila = null;
  function enviarFila() {
    if (enviando) return;
    clearTimeout(timerFila);
    enviando = true;
    (function proximo() {
      var item = fila[0];
      if (!item) { enviando = false; falhasFila = 0; return; }
      var metodo = item.op === 'set' ? 'PUT' : item.op === 'update' ? 'PATCH' : 'DELETE';
      http(metodo, caminhoDoc(item.col, item.id), item.op === 'delete' ? null : { data: item.data }, 60000).then(null, function (e) {
        if (!recusadoDeVez(e)) throw e;
        // recusado de vez (ex.: atualizar um doc que outro aparelho apagou): sai da fila
      }).then(function () {
        fila.shift();
        var k = chave(item.col, item.id);
        if (--pendentes[k] <= 0) delete pendentes[k];
        item.salvo.then(function (n) { if (n !== undefined) idbFazer('fila', 'readwrite', function (s) { return s['delete'](n); }); });
        falhasFila = 0;
        proximo();
      }, function (e) {
        enviando = false;
        falhasFila++;
        timerFila = setTimeout(enviarFila, esperaDaTentativa(falhasFila, e));
      });
    })();
  }
  pronto.then(function () { if (fila.length) enviarFila(); });
  window.addEventListener('online', function () { falhasFila = 0; enviarFila(); });

  // mesmo formato dos ids automáticos do Firestore (20 caracteres), criado aqui para gravar sem servidor
  function novoId() {
    var letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', bytes = new Uint8Array(20), s = '';
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < 20; i++) s += letras[bytes[i] % letras.length];
    return s;
  }

  // ---- referências ----
  function DocRef(col, id) { this.col = col; this.id = id; }
  DocRef.prototype.get = function () {
    var self = this;
    return pronto.then(function () {
      return buscarDocServidor(self.col, self.id).then(null, function (e) {
        // sem servidor: responde com a cópia; doc nunca visto aqui fica sem resposta certa
        if (!((local[self.col] || {}).hasOwnProperty(self.id))) {
          var err = new Error('Sem conexão com o servidor');
          err.code = 'unavailable';
          throw err;
        }
      });
    }).then(function () {
      var data = (local[self.col] || {})[self.id];
      return hidratar(data === undefined ? [] : [{ id: self.id, data: data }]).then(function (h) {
        return docSnap(self.id, h.length ? h[0].data : undefined, h.length > 0);
      });
    });
  };
  DocRef.prototype.set = function (data) { return gravar('set', this.col, this.id, data); };
  DocRef.prototype.update = function (data) { return gravar('update', this.col, this.id, data); };
  DocRef.prototype['delete'] = function () { return gravar('delete', this.col, this.id); };
  DocRef.prototype.onSnapshot = function (cb) { return ouvir(this.col, this.id, null, cb); };

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
  Query.prototype.get = function () {
    var self = this;
    return pronto.then(function () {
      return buscarQueryServidor(self).then(null, function () { /* sem servidor: vale a cópia */ });
    }).then(function () { return hidratar(avaliar(self)); }).then(querySnap);
  };
  Query.prototype.onSnapshot = function (cb) { return ouvir(this.col, null, this, cb); };

  function Collection(nome) { Query.call(this, nome); }
  Collection.prototype = Object.create(Query.prototype);
  Collection.prototype.doc = function (id) {
    if (!id) throw new Error('Romaneio: doc() precisa de id');
    return new DocRef(this.col, String(id));
  };
  // o id nasce aqui (não no servidor), para o documento novo existir mesmo sem conexão
  Collection.prototype.add = function (data) {
    var ref = new DocRef(this.col, novoId());
    return gravar('set', ref.col, ref.id, data).then(function () { return ref; });
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
