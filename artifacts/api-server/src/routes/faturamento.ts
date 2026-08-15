import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, faturamentoDiarioTable, faturamentoMetaTable } from "@workspace/db";

const router: IRouter = Router();

type DiaRow = { date: string; matriz: number | null; filial: number | null; aglotec: number | null };

/** GET /api/faturamento?mes=yyyy-MM → { mes, meta, dias: [{date, matriz, filial, aglotec}] } */
router.get("/faturamento", async (req, res): Promise<void> => {
  const mes = typeof req.query.mes === "string" ? req.query.mes : new Date().toISOString().slice(0, 7);

  const [metaRow] = await db
    .select()
    .from(faturamentoMetaTable)
    .where(eq(faturamentoMetaTable.mes, mes));

  const allDias = await db.select().from(faturamentoDiarioTable);
  const filtered = allDias
    .filter((r) => r.date.startsWith(mes))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    mes,
    meta: metaRow ? Number(metaRow.meta) : null,
    dias: filtered.map((r): DiaRow => ({
      date:    r.date,
      matriz:  r.matriz  !== null && r.matriz  !== undefined ? Number(r.matriz)  : null,
      filial:  r.filial  !== null && r.filial  !== undefined ? Number(r.filial)  : null,
      aglotec: r.aglotec !== null && r.aglotec !== undefined ? Number(r.aglotec) : null,
    })),
  });
});

/** PUT /api/faturamento/dia → upsert a day entry with matriz/filial/aglotec */
router.put("/faturamento/dia", async (req, res): Promise<void> => {
  const date    = typeof req.body?.date === "string" ? req.body.date.trim() : "";
  const matrizRaw   = req.body?.matriz;
  const filialRaw   = req.body?.filial;
  const aglotecRaw  = req.body?.aglotec;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date inválido (yyyy-MM-dd)" });
    return;
  }

  const toNum = (v: unknown): number | null => {
    if (v === null || v === "" || v === undefined) return null;
    const n = Number(String(v).replace(",", "."));
    return isNaN(n) || n < 0 ? null : n;
  };

  const matriz  = toNum(matrizRaw);
  const filial  = toNum(filialRaw);
  const aglotec = toNum(aglotecRaw);

  // If all three are null → delete the row
  if (matriz === null && filial === null && aglotec === null) {
    await db.delete(faturamentoDiarioTable).where(eq(faturamentoDiarioTable.date, date));
    res.json({ deleted: true, date });
    return;
  }

  const vals = {
    matriz:  matriz  !== null ? String(matriz)  : null,
    filial:  filial  !== null ? String(filial)  : null,
    aglotec: aglotec !== null ? String(aglotec) : null,
  };

  const existing = await db.select().from(faturamentoDiarioTable).where(eq(faturamentoDiarioTable.date, date));
  if (existing.length > 0) {
    const [row] = await db
      .update(faturamentoDiarioTable)
      .set(vals)
      .where(eq(faturamentoDiarioTable.date, date))
      .returning();
    res.json({ date: row!.date, matriz: row!.matriz !== null ? Number(row!.matriz) : null, filial: row!.filial !== null ? Number(row!.filial) : null, aglotec: row!.aglotec !== null ? Number(row!.aglotec) : null });
  } else {
    const [row] = await db
      .insert(faturamentoDiarioTable)
      .values({ date, ...vals })
      .returning();
    res.json({ date: row!.date, matriz: row!.matriz !== null ? Number(row!.matriz) : null, filial: row!.filial !== null ? Number(row!.filial) : null, aglotec: row!.aglotec !== null ? Number(row!.aglotec) : null });
  }
});

/** PUT /api/faturamento/meta → upsert month meta */
router.put("/faturamento/meta", async (req, res): Promise<void> => {
  const mes  = typeof req.body?.mes  === "string" ? req.body.mes.trim()  : "";
  const meta = req.body?.meta;

  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    res.status(400).json({ error: "mes inválido (yyyy-MM)" });
    return;
  }

  if (meta === null || meta === "" || meta === undefined) {
    await db.delete(faturamentoMetaTable).where(eq(faturamentoMetaTable.mes, mes));
    res.json({ deleted: true, mes });
    return;
  }

  const num = Number(String(meta).replace(",", "."));
  if (isNaN(num) || num < 0) {
    res.status(400).json({ error: "meta inválida" });
    return;
  }

  const existing = await db.select().from(faturamentoMetaTable).where(eq(faturamentoMetaTable.mes, mes));
  if (existing.length > 0) {
    const [row] = await db
      .update(faturamentoMetaTable)
      .set({ meta: String(num) })
      .where(eq(faturamentoMetaTable.mes, mes))
      .returning();
    res.json({ mes: row!.mes, meta: Number(row!.meta) });
  } else {
    const [row] = await db
      .insert(faturamentoMetaTable)
      .values({ mes, meta: String(num) })
      .returning();
    res.json({ mes: row!.mes, meta: Number(row!.meta) });
  }
});

export default router;
