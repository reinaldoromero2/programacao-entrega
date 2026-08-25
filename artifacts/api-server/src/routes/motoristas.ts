import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, motoristasTable } from "@workspace/db";
import {
  CreateMotoristaBody,
  UpdateMotoristaBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/motoristas", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(motoristasTable)
    .orderBy(asc(motoristasTable.nome));
  res.json(rows);
});

router.post("/motoristas", async (req, res): Promise<void> => {
  const parsed = CreateMotoristaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(motoristasTable)
    .values({ nome: parsed.data.nome, placa: parsed.data.placa.toUpperCase(), frete: parsed.data.frete ?? null })
    .returning();
  res.status(201).json(row);
});

router.patch("/motoristas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const parsed = UpdateMotoristaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, string | null> = {};
  if (parsed.data.nome) updates.nome = parsed.data.nome;
  if (parsed.data.placa) updates.placa = parsed.data.placa.toUpperCase();
  if (parsed.data.frete !== undefined) updates.frete = parsed.data.frete;

  const [row] = await db
    .update(motoristasTable)
    .set(updates)
    .where(eq(motoristasTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Motorista não encontrado" }); return; }
  res.json(row);
});

router.delete("/motoristas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [row] = await db
    .delete(motoristasTable)
    .where(eq(motoristasTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Motorista não encontrado" }); return; }
  res.sendStatus(204);
});

export default router;
