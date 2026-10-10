import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

// Foto do ticket de agendamento: uma por entrega, numa tabela separada. A lista do mês só pergunta
// QUAIS entregas têm foto (sem a imagem); a imagem só desce quando alguém abre. Passado o dia do
// agendamento, a foto é apagada (a cota de transferência do Neon já estourou uma vez com imagens).

const router: IRouter = Router();

const TAMANHO_MAX = 3_000_000; // data URL; a tela já reduz a imagem antes de enviar
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const LIMPEZA_MS = 60 * 60 * 1000;

function idValido(valor: unknown): number | null {
  const n = Number(Array.isArray(valor) ? valor[0] : valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// fotos de agendamentos com dia já passado (horário de Brasília) e de entregas que não existem mais
export async function limparFotosVencidas(): Promise<number> {
  const r = await pool.query(
    `DELETE FROM agendamento_fotos f
      WHERE NOT EXISTS (
        SELECT 1 FROM entregas e
         WHERE e.id = f.entrega_id
           AND e.date >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
      )`,
  );
  return r.rowCount ?? 0;
}
let ultimaLimpeza = 0;
function limparDeVezEmQuando(): void {
  if (Date.now() - ultimaLimpeza < LIMPEZA_MS) return;
  ultimaLimpeza = Date.now();
  limparFotosVencidas().catch(() => { ultimaLimpeza = 0; });
}

// quais entregas do período têm foto (só os ids, sem imagem)
router.get("/agendamento-fotos", async (req, res, next): Promise<void> => {
  try {
    limparDeVezEmQuando();
    const from = String(req.query.from || ""), to = String(req.query.to || "");
    if (!DATA.test(from) || !DATA.test(to)) {
      res.status(400).json({ error: "Informe from e to (AAAA-MM-DD)." });
      return;
    }
    const r = await pool.query<{ entrega_id: number }>(
      `SELECT f.entrega_id FROM agendamento_fotos f JOIN entregas e ON e.id = f.entrega_id
        WHERE e.date BETWEEN $1 AND $2`,
      [from, to],
    );
    res.json(r.rows.map((x) => x.entrega_id));
  } catch (error) {
    next(error);
  }
});

router.get("/agendamento-fotos/:id", async (req, res, next): Promise<void> => {
  try {
    const id = idValido(req.params.id);
    if (!id) { res.status(400).json({ error: "id inválido" }); return; }
    const r = await pool.query<{ conteudo: string }>(`SELECT conteudo FROM agendamento_fotos WHERE entrega_id = $1`, [id]);
    if (!r.rows[0]) { res.status(404).json({ error: "sem foto" }); return; }
    res.json({ conteudo: r.rows[0].conteudo });
  } catch (error) {
    next(error);
  }
});

router.put("/agendamento-fotos/:id", async (req, res, next): Promise<void> => {
  try {
    const id = idValido(req.params.id);
    const conteudo = req.body && typeof req.body.conteudo === "string" ? req.body.conteudo : "";
    if (!id) { res.status(400).json({ error: "id inválido" }); return; }
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(conteudo) || conteudo.length > TAMANHO_MAX) {
      res.status(400).json({ error: "Imagem inválida ou grande demais." });
      return;
    }
    const existe = await pool.query(`SELECT 1 FROM entregas WHERE id = $1`, [id]);
    if (!existe.rowCount) { res.status(404).json({ error: "Agendamento não encontrado." }); return; }
    await pool.query(
      `INSERT INTO agendamento_fotos (entrega_id, conteudo) VALUES ($1, $2)
       ON CONFLICT (entrega_id) DO UPDATE SET conteudo = EXCLUDED.conteudo, criado_em = NOW()`,
      [id, conteudo],
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete("/agendamento-fotos/:id", async (req, res, next): Promise<void> => {
  try {
    const id = idValido(req.params.id);
    if (!id) { res.status(400).json({ error: "id inválido" }); return; }
    await pool.query(`DELETE FROM agendamento_fotos WHERE entrega_id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
