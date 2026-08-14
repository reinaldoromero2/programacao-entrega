import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, motivosCancelamentoTable } from "@workspace/db";
const router: IRouter = Router();

router.get("/motivos-cancelamento", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(motivosCancelamentoTable)
    .orderBy(asc(motivosCancelamentoTable.motivo));
  res.json(rows);
});

router.post("/motivos-cancelamento", async (req, res): Promise<void> => {
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  if (!motivo) { res.status(400).json({ error: "motivo é obrigatório" }); return; }
  const [row] = await db
    .insert(motivosCancelamentoTable)
    .values({ motivo })
    .returning();
  res.status(201).json(row);
});

router.patch("/motivos-cancelamento/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  if (!motivo) { res.status(400).json({ error: "motivo é obrigatório" }); return; }

  const [row] = await db
    .update(motivosCancelamentoTable)
    .set({ motivo })
    .where(eq(motivosCancelamentoTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Motivo não encontrado" }); return; }
  res.json(row);
});

router.delete("/motivos-cancelamento/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [row] = await db
    .delete(motivosCancelamentoTable)
    .where(eq(motivosCancelamentoTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Motivo não encontrado" }); return; }
  res.sendStatus(204);
});

export default router;
