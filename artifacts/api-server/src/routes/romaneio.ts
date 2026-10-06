import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
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

// mesmo formato dos ids automáticos do Firestore (20 caracteres alfanuméricos)
function novoId(): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(randomBytes(20), (b) => letras[b % letras.length]).join("");
}

async function gravar(collection: string, id: string, data: Record<string, unknown>): Promise<number> {
  const result = await pool.query<{ seq: string }>(
    `INSERT INTO romaneio_docs (collection, id, data, seq, deleted, updated_at)
     VALUES ($1, $2, $3::jsonb, nextval('romaneio_docs_seq_gen'), false, NOW())
     ON CONFLICT (collection, id) DO UPDATE
       SET data = EXCLUDED.data, seq = EXCLUDED.seq, deleted = false, updated_at = NOW()
     RETURNING seq`,
    [collection, id, JSON.stringify(data)],
  );
  avisos.emit("mudou");
  return Number(result.rows[0].seq);
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
  res.json({ docs: result.rows });
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
  res.json({ id, data: result.rows[0].data });
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
  const result = await pool.query<{ seq: string }>(
    `UPDATE romaneio_docs
        SET data = data || $3::jsonb, seq = nextval('romaneio_docs_seq_gen'), updated_at = NOW()
      WHERE collection = $1 AND id = $2 AND NOT deleted
      RETURNING seq`,
    [col, id, JSON.stringify(data)],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Documento não encontrado" });
    return;
  }
  avisos.emit("mudou");
  res.json({ id, seq: Number(result.rows[0].seq) });
});

router.delete("/romaneio/docs/:col/:id", async (req, res): Promise<void> => {
  const { col, id } = req.params;
  if (!nomeValido(col) || !nomeValido(id)) {
    res.status(400).json({ error: "Coleção ou id inválido" });
    return;
  }

  // marca como apagado (em vez de remover) para /changes avisar os outros aparelhos
  const result = await pool.query(
    `UPDATE romaneio_docs
        SET deleted = true, data = '{}'::jsonb, seq = nextval('romaneio_docs_seq_gen'), updated_at = NOW()
      WHERE collection = $1 AND id = $2 AND NOT deleted`,
    [col, id],
  );
  if (result.rowCount) avisos.emit("mudou");
  res.sendStatus(204);
});

// Long-poll: devolve o que mudou depois de `since`; sem novidade, segura a resposta até 25 s.
// Sem `since`, devolve só a posição atual para o aparelho começar a acompanhar dali.
router.get("/romaneio/changes", async (req, res): Promise<void> => {
  const since = Number(req.query["since"]);

  if (!Number.isFinite(since) || since < 0) {
    const atual = await pool.query<{ seq: string | null }>(`SELECT MAX(seq) AS seq FROM romaneio_docs`);
    res.json({ seq: Number(atual.rows[0].seq ?? 0), changes: [] });
    return;
  }

  let aberto = true;
  res.on("close", () => { aberto = false; });
  const fim = Date.now() + ESPERA_MAX_MS;

  while (aberto) {
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
    await new Promise<void>((resolve) => {
      const timer = setTimeout(acordar, Math.min(VERIFICA_MS, fim - Date.now()));
      function acordar() {
        clearTimeout(timer);
        avisos.off("mudou", acordar);
        resolve();
      }
      avisos.on("mudou", acordar);
    });
  }
});

export default router;
