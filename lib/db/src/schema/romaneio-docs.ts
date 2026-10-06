import { bigint, boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Documentos do Romaneio (antes no banco do artefato do claude.ai): uma linha por documento,
// endereçada por coleção + id. `seq` cresce a cada gravação e alimenta /romaneio/changes;
// apagar marca `deleted` para os outros aparelhos ficarem sabendo.
export const romaneioDocsTable = pgTable("romaneio_docs", {
  collection: text("collection").notNull(),
  id: text("id").notNull(),
  data: jsonb("data").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  deleted: boolean("deleted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.collection, table.id] }),
  index("romaneio_docs_seq_idx").on(table.seq),
]);

export type RomaneioDoc = typeof romaneioDocsTable.$inferSelect;
