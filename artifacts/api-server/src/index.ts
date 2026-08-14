import app from "./app";
import { logger } from "./lib/logger";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// Ensure new tables exist in production DB (idempotent)
async function runStartupMigrations() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS motivos_cancelamento (
        id     SERIAL PRIMARY KEY,
        motivo TEXT NOT NULL
      )
    `);
  } catch (err) {
    logger.warn({ err }, "Startup migration warning (non-fatal)");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runStartupMigrations().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
});
