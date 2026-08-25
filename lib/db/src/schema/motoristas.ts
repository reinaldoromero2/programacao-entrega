import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const motoristasTable = pgTable("motoristas", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  placa: text("placa").notNull(),
  frete: text("frete"),
});

export const insertMotoristasSchema = createInsertSchema(motoristasTable).omit({ id: true });
export type InsertMotorista = z.infer<typeof insertMotoristasSchema>;
export type Motorista = typeof motoristasTable.$inferSelect;
