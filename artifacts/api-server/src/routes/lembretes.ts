import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, lembretesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/lembretes", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(lembretesTable)
    .orderBy(asc(lembretesTable.date), asc(lembretesTable.id));
  res.json(rows);
});

router.post("/lembretes", async (req, res): Promise<void> => {
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === date;

  if (!validDate || !text || text.length > 240) {
    res.status(400).json({ error: "Data válida e recado de até 240 caracteres são obrigatórios" });
    return;
  }

  const [created] = await db
    .insert(lembretesTable)
    .values({ date, text })
    .onConflictDoNothing()
    .returning();

  if (created) {
    res.status(201).json(created);
    return;
  }

  const [existing] = await db
    .select()
    .from(lembretesTable)
    .where(and(eq(lembretesTable.date, date), eq(lembretesTable.text, text)))
    .limit(1);
  res.json(existing);
});

router.delete("/lembretes/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [deleted] = await db
    .delete(lembretesTable)
    .where(eq(lembretesTable.id, id))
    .returning({ id: lembretesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Lembrete não encontrado" });
    return;
  }
  res.sendStatus(204);
});

export default router;