import { pgTable, serial, text, numeric } from "drizzle-orm/pg-core";

export const faturamentoDiarioTable = pgTable("faturamento_diario", {
  id:    serial("id").primaryKey(),
  date:  text("date").notNull().unique(),   // yyyy-MM-dd
  valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
});

export const faturamentoMetaTable = pgTable("faturamento_meta", {
  id:   serial("id").primaryKey(),
  mes:  text("mes").notNull().unique(),     // yyyy-MM
  meta: numeric("meta", { precision: 15, scale: 2 }).notNull(),
});

export type FaturamentoDiario = typeof faturamentoDiarioTable.$inferSelect;
export type FaturamentoMeta   = typeof faturamentoMetaTable.$inferSelect;
