import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, clientesCadastroTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/clientes-cadastro", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(clientesCadastroTable)
    .orderBy(asc(clientesCadastroTable.nome));
  res.json(rows);
});

router.post("/clientes-cadastro", async (req, res): Promise<void> => {
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim().toUpperCase() : "";
  if (!nome) { res.status(400).json({ error: "nome é obrigatório" }); return; }
  const [row] = await db
    .insert(clientesCadastroTable)
    .values({ nome })
    .returning();
  res.status(201).json(row);
});

router.delete("/clientes-cadastro/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [row] = await db
    .delete(clientesCadastroTable)
    .where(eq(clientesCadastroTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Cliente não encontrado" }); return; }
  res.sendStatus(204);
});

export default router;
