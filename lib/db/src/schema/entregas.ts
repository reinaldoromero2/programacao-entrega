import { pgTable, serial, text, boolean, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entregasTable = pgTable("entregas", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  agendamento: boolean("agendamento").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  checked: text("checked").notNull().default("none"),
  cliente: text("cliente").notNull(),
  hrs: text("hrs"),
  obs: text("obs"),
  motorista: text("motorista"),
  placa: text("placa"),
  unidade: text("unidade").notNull().default("MATRIZ"),
  nf: text("nf").notNull().default("none"),
  cg: text("cg").notNull().default("none"),
  v: text("v"),
  divergencias: text("divergencias"),
  frete: text("frete"),
  statusManual: text("status_manual"),
});

export const insertEntregaSchema = createInsertSchema(entregasTable).omit({ id: true });
export type InsertEntrega = z.infer<typeof insertEntregaSchema>;
export type Entrega = typeof entregasTable.$inferSelect;
