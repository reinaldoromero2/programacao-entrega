import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const clientesCadastroTable = pgTable("clientes_cadastro", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
});

export type ClienteCadastro = typeof clientesCadastroTable.$inferSelect;
