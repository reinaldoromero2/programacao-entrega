import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Asserts that all expected tables are present in the public schema.
 * If any table is missing the process exits immediately — a silent schema
 * mismatch would only surface later as 500 errors on every request.
 */
async function assertSchema(): Promise<void> {
  const expectedTables = ["entregas", "motoristas", "motivos_cancelamento", "clientes_cadastro"];

  const client = await pool.connect();
  try {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [expectedTables],
    );

    const found = result.rows.map((r) => r.table_name);
    const missing = expectedTables.filter((t) => !found.includes(t));

    if (missing.length > 0) {
      logger.error(
        { missing },
        "Schema validation failed — tables not found in database. " +
          "Run `pnpm --filter @workspace/db run push` and redeploy.",
      );
      process.exit(1);
    }

    logger.info({ tables: found }, "Schema validation passed");
  } finally {
    client.release();
  }
}

async function start(): Promise<void> {
  await assertSchema();

  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err?: Error) => {
      if (err) {
        reject(err);
      } else {
        logger.info({ port }, "Server listening");
        resolve();
      }
    });
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
