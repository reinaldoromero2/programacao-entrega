import { date, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const lembretesTable = pgTable("lembretes", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("lembretes_date_text_unique").on(table.date, table.text)]);

export type Lembrete = typeof lembretesTable.$inferSelect;