import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, faturamentoDiarioTable, faturamentoMetaTable } from "@workspace/db";

const router: IRouter = Router();

type DiaRow = {
  date: string;
  matriz: number | null;
  filial: number | null;
  aglotec: number | null;
  tatu: number | null;
  tatu_qtd: string | null;
};

/** GET /api/faturamento?mes=yyyy-MM */
router.get("/faturamento", async (req, res): Promise<void> => {
  const mes = typeof req.query.mes === "string" ? req.query.mes : new Date().toISOString().slice(0, 7);

  const [metaRow] = await db.select().from(faturamentoMetaTable).where(eq(faturamentoMetaTable.mes, mes));
  const allDias = await db.select().from(faturamentoDiarioTable);
  const filtered = allDias.filter((r) => r.date.startsWith(mes)).sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    mes,
    meta: metaRow ? Number(metaRow.meta) : null,
    dias: filtered.map((r): DiaRow => ({
      date:     r.date,
      matriz:   r.matriz   != null ? Number(r.matriz)   : null,
      filial:   r.filial   != null ? Number(r.filial)   : null,
      aglotec:  r.aglotec  != null ? Number(r.aglotec)  : null,
      tatu:     r.tatu     != null ? Number(r.tatu)     : null,
      tatu_qtd: r.tatu_qtd ?? null,
    })),
  });
});

/** PUT /api/faturamento/dia */
router.put("/faturamento/dia", async (req, res): Promise<void> => {
  const date = typeof req.body?.date === "string" ? req.body.date.trim() : "";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date inválido (yyyy-MM-dd)" }); return;
  }

  const toNum = (v: unknown): number | null => {
    if (v === null || v === "" || v === undefined) return null;
    const n = Number(String(v).replace(",", "."));
    return isNaN(n) || n < 0 ? null : n;
  };

  const matriz  = toNum(req.body?.matriz);
  const filial  = toNum(req.body?.filial);
  const aglotec = toNum(req.body?.aglotec);
  const tatu    = toNum(req.body?.tatu);
  const tatu_qtd = typeof req.body?.tatu_qtd === "string" ? req.body.tatu_qtd : null;

  if (matriz === null && filial === null && aglotec === null && tatu === null) {
    await db.delete(faturamentoDiarioTable).where(eq(faturamentoDiarioTable.date, date));
    res.json({ deleted: true, date }); return;
  }

  const vals = {
    matriz:   matriz   != null ? String(matriz)   : null,
    filial:   filial   != null ? String(filial)   : null,
    aglotec:  aglotec  != null ? String(aglotec)  : null,
    tatu:     tatu     != null ? String(tatu)     : null,
    tatu_qtd: tatu_qtd,
  };

  const existing = await db.select().from(faturamentoDiarioTable).where(eq(faturamentoDiarioTable.date, date));
  const [row] = existing.length > 0
    ? await db.update(faturamentoDiarioTable).set(vals).where(eq(faturamentoDiarioTable.date, date)).returning()
    : await db.insert(faturamentoDiarioTable).values({ date, ...vals }).returning();

  res.json({
    date: row!.date,
    matriz:  row!.matriz  != null ? Number(row!.matriz)  : null,
    filial:  row!.filial  != null ? Number(row!.filial)  : null,
    aglotec: row!.aglotec != null ? Number(row!.aglotec) : null,
    tatu:    row!.tatu    != null ? Number(row!.tatu)    : null,
    tatu_qtd: row!.tatu_qtd ?? null,
  });
});

/** PUT /api/faturamento/meta */
router.put("/faturamento/meta", async (req, res): Promise<void> => {
  const mes  = typeof req.body?.mes  === "string" ? req.body.mes.trim()  : "";
  const meta = req.body?.meta;

  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    res.status(400).json({ error: "mes inválido (yyyy-MM)" }); return;
  }
  if (meta === null || meta === "" || meta === undefined) {
    await db.delete(faturamentoMetaTable).where(eq(faturamentoMetaTable.mes, mes));
    res.json({ deleted: true, mes }); return;
  }
  const num = Number(String(meta).replace(",", "."));
  if (isNaN(num) || num < 0) { res.status(400).json({ error: "meta inválida" }); return; }

  const existing = await db.select().from(faturamentoMetaTable).where(eq(faturamentoMetaTable.mes, mes));
  const [row] = existing.length > 0
    ? await db.update(faturamentoMetaTable).set({ meta: String(num) }).where(eq(faturamentoMetaTable.mes, mes)).returning()
    : await db.insert(faturamentoMetaTable).values({ mes, meta: String(num) }).returning();

  res.json({ mes: row!.mes, meta: Number(row!.meta) });
});

export default router;
