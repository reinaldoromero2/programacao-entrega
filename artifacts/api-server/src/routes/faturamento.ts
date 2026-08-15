import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, faturamentoDiarioTable, faturamentoMetaTable } from "@workspace/db";

const router: IRouter = Router();

/** GET /api/faturamento?mes=yyyy-MM → { mes, meta, dias: [{date, valor}] } */
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
    dias: filtered.map((r) => ({ date: r.date, valor: Number(r.valor) })),
  });
});

/** PUT /api/faturamento/dia → upsert or delete a day entry */
router.put("/faturamento/dia", async (req, res): Promise<void> => {
  const date  = typeof req.body?.date  === "string" ? req.body.date.trim()  : "";
  const valor = req.body?.valor;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date inválido (yyyy-MM-dd)" });
    return;
  }

  // If valor is null/empty string → delete the entry
  if (valor === null || valor === "" || valor === undefined) {
    await db.delete(faturamentoDiarioTable).where(eq(faturamentoDiarioTable.date, date));
    res.json({ deleted: true, date });
    return;
  }

  const num = Number(String(valor).replace(",", "."));
  if (isNaN(num) || num < 0) {
    res.status(400).json({ error: "valor inválido" });
    return;
  }

  // Upsert
  const existing = await db.select().from(faturamentoDiarioTable).where(eq(faturamentoDiarioTable.date, date));
  if (existing.length > 0) {
    const [row] = await db
      .update(faturamentoDiarioTable)
      .set({ valor: String(num) })
      .where(eq(faturamentoDiarioTable.date, date))
      .returning();
    res.json({ date: row!.date, valor: Number(row!.valor) });
  } else {
    const [row] = await db
      .insert(faturamentoDiarioTable)
      .values({ date, valor: String(num) })
      .returning();
    res.json({ date: row!.date, valor: Number(row!.valor) });
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
