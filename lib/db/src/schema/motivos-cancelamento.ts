import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const motivosCancelamentoTable = pgTable("motivos_cancelamento", {
  id: serial("id").primaryKey(),
  motivo: text("motivo").notNull(),
});

export type MotivoCancelamento = typeof motivosCancelamentoTable.$inferSelect;
