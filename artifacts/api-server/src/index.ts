import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { migrarArquivosAntigos } from "./routes/romaneio";

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
  const expectedTables = ["entregas", "motoristas", "motivos_cancelamento", "clientes_cadastro", "faturamento_diario", "faturamento_meta", "lembretes", "romaneio_docs"];

  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE entregas ADD COLUMN IF NOT EXISTS frete text`);
    await client.query(`ALTER TABLE entregas ADD COLUMN IF NOT EXISTS status_manual text`);
    await client.query(`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS frete text`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lembretes (
        id serial PRIMARY KEY,
        date date NOT NULL,
        text text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT lembretes_date_text_unique UNIQUE (date, text)
      )
    `);
    await client.query(`CREATE SEQUENCE IF NOT EXISTS romaneio_docs_seq_gen`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS romaneio_docs (
        collection text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        seq bigint NOT NULL,
        deleted boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection, id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS romaneio_docs_seq_idx ON romaneio_docs (seq)`);
    // imagens do Romaneio, guardadas uma vez cada (ver routes/romaneio.ts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS romaneio_arquivos (
        hash text PRIMARY KEY,
        conteudo text NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT NOW()
      )
    `);

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

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'entregas'
          AND column_name = 'frete'`,
    );

    if (columns.rowCount === 0) {
      logger.error(
        "Schema validation failed — column entregas.frete not found in database.",
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
        migrarArquivosAntigos()
          .then((n) => { if (n) logger.info({ n }, "Imagens do Romaneio separadas dos documentos"); })
          .catch((err) => logger.error({ err }, "Falha ao separar imagens do Romaneio"));
        resolve();
      }
    });
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
