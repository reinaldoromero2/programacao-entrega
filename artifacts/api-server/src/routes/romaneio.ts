import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

// Banco do Romaneio: substitui o db do artefato do claude.ai (coleções de documentos JSON).
// A página usa só: buscar (where "==", orderBy, limit), ler um doc, add, set, update, delete
// e acompanhar mudanças — este último via long-poll em /romaneio/changes.

const router: IRouter = Router();

const NOME = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const LIMITE_MAX = 5000;
const ESPERA_MAX_MS = 25_000;
const VERIFICA_MS = 2_000;

// acorda na hora quem está esperando em /changes quando a gravação passa por esta instância;
// gravações feitas por outra instância chegam pela verificação periódica
const avisos = new EventEmitter();
avisos.setMaxListeners(0);

function nomeValido(valor: unknown): valor is string {
  return typeof valor === "string" && NOME.test(valor);
}

function dadosValidos(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// ---- Imagens fora dos documentos ----
// Assinatura e desenho da carga chegam como "data:image/png;base64,..." (~80 KB cada). Dentro do
// documento, cada busca de lista levava todas de novo — foi o que esgotou a transferência mensal
// do Neon em 2026-10-07. Agora cada imagem é guardada uma vez em romaneio_arquivos (pelo hash) e o
// documento leva só "ripack-arquivo:<hash>". O app (?arq=1) baixa cada imagem uma única vez e
// guarda em cache; versões antigas recebem o documento remontado, como antes.
const MARCA = "ripack-arquivo:";
const TAMANHO_MIN_ARQUIVO = 2048;
const MARCA_VALIDA = /^ripack-arquivo:[0-9a-f]{64}$/;
const HASH_VALIDO = /^[0-9a-f]{64}$/;
const CACHE_ARQUIVOS_MAX = 64 * 1024 * 1024;

// cópia em memória das imagens já lidas: o mesmo arquivo não sai do banco duas vezes
const cacheArquivos = new Map<string, string>();
let cacheArquivosBytes = 0;

function guardarNoCache(hash: string, conteudo: string): void {
  if (cacheArquivos.has(hash)) return;
  cacheArquivos.set(hash, conteudo);
  cacheArquivosBytes += conteudo.length;
  for (const [h, c] of cacheArquivos) {
    if (cacheArquivosBytes <= CACHE_ARQUIVOS_MAX) break;
    cacheArquivos.delete(h);
    cacheArquivosBytes -= c.length;
  }
}

function lerDoCache(hash: string): string | undefined {
  const c = cacheArquivos.get(hash);
  if (c !== undefined) { cacheArquivos.delete(hash); cacheArquivos.set(hash, c); }
  return c;
}

// troca cada imagem grande pela marca; junta em `arquivos` o que precisa ser gravado
function separarArquivos(valor: unknown, arquivos: Map<string, string>): unknown {
  if (typeof valor === "string") {
    if (valor.length < TAMANHO_MIN_ARQUIVO || !valor.startsWith("data:")) return valor;
    const hash = createHash("sha256").update(valor).digest("hex");
    arquivos.set(hash, valor);
    return MARCA + hash;
  }
  if (Array.isArray(valor)) return valor.map((v) => separarArquivos(v, arquivos));
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = separarArquivos(v, arquivos);
    return saida;
  }
  return valor;
}

async function gravarArquivos(arquivos: Map<string, string>): Promise<void> {
  for (const [hash, conteudo] of arquivos) {
    if (cacheArquivos.has(hash)) continue;
    await pool.query(
      `INSERT INTO romaneio_arquivos (hash, conteudo) VALUES ($1, $2) ON CONFLICT (hash) DO NOTHING`,
      [hash, conteudo],
    );
    guardarNoCache(hash, conteudo);
  }
}

async function lerArquivos(hashes: string[]): Promise<Map<string, string>> {
  const achados = new Map<string, string>();
  const faltam: string[] = [];
  for (const h of hashes) {
    const c = lerDoCache(h);
    if (c !== undefined) achados.set(h, c);
    else faltam.push(h);
  }
  if (faltam.length) {
    const result = await pool.query<{ hash: string; conteudo: string }>(
      `SELECT hash, conteudo FROM romaneio_arquivos WHERE hash = ANY($1::text[])`,
      [faltam],
    );
    for (const r of result.rows) { achados.set(r.hash, r.conteudo); guardarNoCache(r.hash, r.conteudo); }
  }
  return achados;
}

function juntarMarcas(valor: unknown, hashes: Set<string>): void {
  if (typeof valor === "string") { if (MARCA_VALIDA.test(valor)) hashes.add(valor.slice(MARCA.length)); return; }
  if (valor && typeof valor === "object") for (const v of Object.values(valor)) juntarMarcas(v, hashes);
}

function trocarMarcas(valor: unknown, arquivos: Map<string, string>): unknown {
  if (typeof valor === "string") return MARCA_VALIDA.test(valor) ? arquivos.get(valor.slice(MARCA.length)) ?? valor : valor;
  if (Array.isArray(valor)) return valor.map((v) => trocarMarcas(v, arquivos));
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = trocarMarcas(v, arquivos);
    return saida;
  }
  return valor;
}

// para versões antigas do app, que não sabem buscar as imagens à parte
async function remontar<T extends { data: unknown }>(docs: T[]): Promise<T[]> {
  const hashes = new Set<string>();
  for (const d of docs) juntarMarcas(d.data, hashes);
  if (!hashes.size) return docs;
  const arquivos = await lerArquivos([...hashes]);
  return docs.map((d) => ({ ...d, data: trocarMarcas(d.data, arquivos) }));
}

// Documentos gravados antes desta mudança: separa as imagens uma vez, sem mudar `seq`
// (para quem lê, o conteúdo continua o mesmo). Roda ao ligar; depois não acha mais nada.
export async function migrarArquivosAntigos(): Promise<number> {
  const ids = await pool.query<{ collection: string; id: string }>(
    `SELECT collection, id FROM romaneio_docs WHERE NOT deleted AND strpos(data::text, '"data:') > 0`,
  );
  let migrados = 0;
  for (const { collection, id } of ids.rows) {
    const r = await pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM romaneio_docs WHERE collection = $1 AND id = $2`, [collection, id],
    );
    if (!r.rowCount) continue;
    const arquivos = new Map<string, string>();
    const data = separarArquivos(r.rows[0].data, arquivos);
    if (!arquivos.size) continue;
    await gravarArquivos(arquivos);
    // só troca se ninguém gravou o documento no meio do caminho
    await pool.query(
      `UPDATE romaneio_docs SET data = $3::jsonb WHERE collection = $1 AND id = $2 AND data = $4::jsonb`,
      [collection, id, JSON.stringify(data), JSON.stringify(r.rows[0].data)],
    );
    migrados++;
  }
  return migrados;
}

// ---- Posição das mudanças, guardada em memória ----
// Toda gravação passa por esta instância, então ela sabe a última `seq` sem perguntar ao banco.
// Antes, cada aparelho em /changes consultava o banco a cada 2 s, o dia todo (e a noite toda
// com o app aberto), e o Neon nunca desligava. Gravações feitas fora daqui (script de
// importação) aparecem na conferência periódica.
const CONFERE_SEQ_MS = 5 * 60_000;
let ultimaSeq = -1;
let seqConferidaEm = 0;
let conferindoSeq: Promise<number> | null = null;

function anotarSeq(seq: number): void {
  if (seq > ultimaSeq) ultimaSeq = seq;
  avisos.emit("mudou");
}

async function seqAtual(): Promise<number> {
  if (ultimaSeq >= 0 && Date.now() - seqConferidaEm < CONFERE_SEQ_MS) return ultimaSeq;
  if (!conferindoSeq) {
    conferindoSeq = pool.query<{ seq: string | null }>(`SELECT MAX(seq) AS seq FROM romaneio_docs`)
      .then((r) => {
        const seq = Number(r.rows[0].seq ?? 0);
        if (seq > ultimaSeq) ultimaSeq = seq;
        seqConferidaEm = Date.now();
        return ultimaSeq;
      })
      .finally(() => { conferindoSeq = null; });
  }
  return conferindoSeq;
}

// mesmo formato dos ids automáticos do Firestore (20 caracteres alfanuméricos)
function novoId(): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(randomBytes(20), (b) => letras[b % letras.length]).join("");
}

async function gravar(collection: string, id: string, recebido: Record<string, unknown>): Promise<number> {
  const arquivos = new Map<string, string>();
  const data = separarArquivos(recebido, arquivos);
  await gravarArquivos(arquivos);
  const result = await pool.query<{ seq: string }>(
    `INSERT INTO romaneio_docs (collection, id, data, seq, deleted, updated_at)
     VALUES ($1, $2, $3::jsonb, nextval('romaneio_docs_seq_gen'), false, NOW())
     ON CONFLICT (collection, id) DO UPDATE
       SET data = EXCLUDED.data, seq = EXCLUDED.seq, deleted = false, updated_at = NOW()
     RETURNING seq`,
    [collection, id, JSON.stringify(data)],
  );
  const seq = Number(result.rows[0].seq);
  anotarSeq(seq);
  return seq;
}

router.get("/romaneio/docs/:col", async (req, res): Promise<void> => {
  const col = req.params.col;
  const where = req.query["where"];
  const orderBy = req.query["orderBy"];
  const dir = req.query["dir"] === "desc" ? "DESC" : "ASC";
  const limit = Math.min(Number(req.query["limit"]) || LIMITE_MAX, LIMITE_MAX);

  if (!nomeValido(col) || (where !== undefined && !nomeValido(where)) || (orderBy !== undefined && !nomeValido(orderBy))) {
    res.status(400).json({ error: "Coleção ou campo inválido" });
    return;
  }

  const params: unknown[] = [col];
  let sql = `SELECT id, data FROM romaneio_docs WHERE collection = $1 AND NOT deleted`;

  if (where !== undefined) {
    let valor: unknown;
    try {
      valor = JSON.parse(String(req.query["eq"]));
    } catch {
      res.status(400).json({ error: "Valor do filtro inválido" });
      return;
    }
    params.push(where, JSON.stringify(valor));
    sql += ` AND data -> $${params.length - 1} = $${params.length}::jsonb`;
  }

  if (orderBy !== undefined) {
    // como no Firestore: documento sem o campo não entra numa busca ordenada por ele
    params.push(orderBy);
    const p = params.length;
    sql += ` AND data ? $${p} ORDER BY data ->> $${p} COLLATE "C" ${dir} ${dir === "ASC" ? "NULLS FIRST" : "NULLS LAST"}, id`;
  }

  params.push(limit);
  sql += ` LIMIT $${params.length}`;

  const result = await pool.query<{ id: string; data: Record<string, unknown> }>(sql, params);
  res.json({ docs: req.query["arq"] === "1" ? result.rows : await remontar(result.rows) });
});

router.get("/romaneio/docs/:col/:id", async (req, res): Promise<void> => {
  const { col, id } = req.params;
  if (!nomeValido(col) || !nomeValido(id)) {
    res.status(400).json({ error: "Coleção ou id inválido" });
    return;
  }

  const result = await pool.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM romaneio_docs WHERE collection = $1 AND id = $2 AND NOT deleted`,
    [col, id],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Documento não encontrado" });
    return;
  }
  const doc = { id, data: result.rows[0].data };
  res.json(req.query["arq"] === "1" ? doc : (await remontar([doc]))[0]);
});

// imagem guardada à parte: nunca muda (o nome é o hash do conteúdo), então o aparelho guarda para sempre
router.get("/romaneio/arquivos/:hash", async (req, res): Promise<void> => {
  const hash = req.params.hash;
  if (!HASH_VALIDO.test(hash)) {
    res.status(400).json({ error: "Arquivo inválido" });
    return;
  }
  const conteudo = (await lerArquivos([hash])).get(hash);
  if (conteudo === undefined) {
    res.status(404).json({ error: "Arquivo não encontrado" });
    return;
  }
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("text/plain").send(conteudo);
});

router.post("/romaneio/docs/:col", async (req, res): Promise<void> => {
  const col = req.params.col;
  const data = req.body?.data;
  if (!nomeValido(col) || !dadosValidos(data)) {
    res.status(400).json({ error: "Coleção ou dados inválidos" });
    return;
  }

  const id = novoId();
  const seq = await gravar(col, id, data);
  res.status(201).json({ id, seq });
});

router.put("/romaneio/docs/:col/:id", async (req, res): Promise<void> => {
  const { col, id } = req.params;
  const data = req.body?.data;
  if (!nomeValido(col) || !nomeValido(id) || !dadosValidos(data)) {
    res.status(400).json({ error: "Coleção, id ou dados inválidos" });
    return;
  }

  const seq = await gravar(col, id, data);
  res.json({ id, seq });
});

router.patch("/romaneio/docs/:col/:id", async (req, res): Promise<void> => {
  const { col, id } = req.params;
  const data = req.body?.data;
  if (!nomeValido(col) || !nomeValido(id) || !dadosValidos(data)) {
    res.status(400).json({ error: "Coleção, id ou dados inválidos" });
    return;
  }

  // como o update do Firestore: junta os campos de primeiro nível e falha se o doc não existe
  const arquivos = new Map<string, string>();
  const campos = separarArquivos(data, arquivos);
  await gravarArquivos(arquivos);
  const result = await pool.query<{ seq: string }>(
    `UPDATE romaneio_docs
        SET data = data || $3::jsonb, seq = nextval('romaneio_docs_seq_gen'), updated_at = NOW()
      WHERE collection = $1 AND id = $2 AND NOT deleted
      RETURNING seq`,
    [col, id, JSON.stringify(campos)],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Documento não encontrado" });
    return;
  }
  const seq = Number(result.rows[0].seq);
  anotarSeq(seq);
  res.json({ id, seq });
});

router.delete("/romaneio/docs/:col/:id", async (req, res): Promise<void> => {
  const { col, id } = req.params;
  if (!nomeValido(col) || !nomeValido(id)) {
    res.status(400).json({ error: "Coleção ou id inválido" });
    return;
  }

  // marca como apagado (em vez de remover) para /changes avisar os outros aparelhos
  const result = await pool.query<{ seq: string }>(
    `UPDATE romaneio_docs
        SET deleted = true, data = '{}'::jsonb, seq = nextval('romaneio_docs_seq_gen'), updated_at = NOW()
      WHERE collection = $1 AND id = $2 AND NOT deleted
      RETURNING seq`,
    [col, id],
  );
  if (result.rowCount) anotarSeq(Number(result.rows[0].seq));
  res.sendStatus(204);
});

// Long-poll: devolve o que mudou depois de `since`; sem novidade, segura a resposta até 25 s.
// Sem `since`, devolve só a posição atual para o aparelho começar a acompanhar dali.
router.get("/romaneio/changes", async (req, res): Promise<void> => {
  const since = Number(req.query["since"]);

  if (!Number.isFinite(since) || since < 0) {
    res.json({ seq: await seqAtual(), changes: [] });
    return;
  }

  let aberto = true;
  res.on("close", () => { aberto = false; });
  const fim = Date.now() + ESPERA_MAX_MS;

  while (aberto) {
    // só pergunta ao banco quando há mesmo algo novo
    if ((await seqAtual()) <= since) {
      if (Date.now() >= fim) {
        res.json({ seq: since, changes: [] });
        return;
      }
      await esperarAviso(fim);
      continue;
    }
    const result = await pool.query<{ collection: string; id: string; deleted: boolean; seq: string }>(
      `SELECT collection, id, deleted, seq FROM romaneio_docs WHERE seq > $1 ORDER BY seq LIMIT 1000`,
      [since],
    );
    if (result.rowCount || Date.now() >= fim) {
      const rows = result.rows;
      res.json({
        seq: rows.length ? Number(rows[rows.length - 1].seq) : since,
        changes: rows.map((r) => ({ collection: r.collection, id: r.id, deleted: r.deleted })),
      });
      return;
    }
    await esperarAviso(fim);
  }
});

function esperarAviso(fim: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(acordar, Math.max(0, Math.min(VERIFICA_MS, fim - Date.now())));
    function acordar() {
      clearTimeout(timer);
      avisos.off("mudou", acordar);
      resolve();
    }
    avisos.on("mudou", acordar);
  });
}

export default router;
