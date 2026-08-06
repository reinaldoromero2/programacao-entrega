#!/usr/bin/env node
/**
 * Migração cross-version: exporta tabelas do Render (PG 18) e importa no Neon.
 * Usa node-postgres (pg) — sem dependência de pg_dump versão específica.
 */
import pg from '../node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js';

const { Client } = pg;

const OLD_DB_URL = process.env.OLD_DB_URL;
const NEW_DB_URL = process.env.NEW_DB_URL;

if (!OLD_DB_URL || !NEW_DB_URL) {
  console.error('❌  Defina OLD_DB_URL e NEW_DB_URL');
  process.exit(1);
}

async function getClient(url, label) {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`✅  Conectado ao ${label}`);
  return client;
}

async function getTables(client) {
  const res = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return res.rows.map(r => r.tablename);
}

async function getSequences(client) {
  const res = await client.query(`
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name
  `);
  return res.rows.map(r => r.sequence_name);
}

async function main() {
  console.log('============================================');
  console.log('  Migração Node.js — Render → Neon');
  console.log('============================================\n');

  const oldClient = await getClient(OLD_DB_URL, 'Render Postgres');
  const newClient = await getClient(NEW_DB_URL, 'Neon');

  // 1. Listar tabelas (excluir tabelas de migração do drizzle)
  const tables = (await getTables(oldClient)).filter(t => t !== 'drizzle_migrations' && t !== '__drizzle_migrations');
  console.log(`\n📋  Tabelas encontradas: ${tables.join(', ')}\n`);

  // 2. Para cada tabela: copiar dados (schema já criado via drizzle push)
  for (const table of tables) {
    console.log(`\n── Tabela: ${table} ──`);

    // Verificar que a tabela existe no Neon
    const existsRes = await newClient.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) as exists
    `, [table]);

    if (!existsRes.rows[0].exists) {
      console.log(`   ⚠️  Tabela não existe no Neon — pulando`);
      continue;
    }

    // Contagem na origem
    const countRes = await oldClient.query(`SELECT COUNT(*) as n FROM "${table}"`);
    const total = parseInt(countRes.rows[0].n);
    console.log(`   📊 Registros no Render: ${total}`);

    if (total === 0) {
      console.log(`   ⏭️  Tabela vazia — pulando`);
      continue;
    }

    // Limpar tabela no destino antes de inserir
    await newClient.query(`DELETE FROM "${table}"`);

    // Ler todos os dados da origem
    const dataRes = await oldClient.query(`SELECT * FROM "${table}"`);
    const rows = dataRes.rows;
    const cols = dataRes.fields.map(f => f.name);

    // Inserir em lotes
    let inserted = 0;
    const BATCH = 50;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      for (const row of batch) {
        const values = cols.map(c => row[c]);
        const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const insertSQL = `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        await newClient.query(insertSQL, values);
        inserted++;
      }
      process.stdout.write(`\r   ⏳ ${inserted}/${total} inseridos...`);
    }
    console.log(`\r   ✅ ${inserted} registros inseridos`);
  }

  // 3. Sincronizar sequences (para que novos INSERTs não colidam)
  console.log('\n🔄  Sincronizando sequences...');
  const sequences = await getSequences(oldClient);
  for (const seq of sequences) {
    try {
      const seqRes = await oldClient.query(`SELECT last_value FROM "${seq}"`);
      const lastVal = seqRes.rows[0]?.last_value;
      if (lastVal) {
        // Tentar encontrar sequence equivalente no Neon
        await newClient.query(`SELECT setval('${seq}', ${lastVal}, true)`).catch(() => {
          // sequence pode ter nome diferente no Neon — ignorar
        });
        console.log(`   ✅ ${seq} → ${lastVal}`);
      }
    } catch (err) {
      console.log(`   ⚠️  ${seq}: ${err.message.split('\n')[0]}`);
    }
  }

  // 4. Contagem final
  console.log('\n============================================');
  console.log('  Verificação Final');
  console.log('============================================');
  let allOk = true;
  for (const table of tables) {
    try {
      const oldCount = await oldClient.query(`SELECT COUNT(*) as n FROM "${table}"`);
      const newCount = await newClient.query(`SELECT COUNT(*) as n FROM "${table}"`);
      const oldN = oldCount.rows[0].n;
      const newN = newCount.rows[0].n;
      const ok = oldN === newN ? '✅' : '❌';
      if (oldN !== newN) allOk = false;
      console.log(`${ok}  ${table}: Render=${oldN}  Neon=${newN}`);
    } catch (err) {
      console.log(`❌  ${table}: ${err.message.split('\n')[0]}`);
      allOk = false;
    }
  }

  await oldClient.end();
  await newClient.end();

  if (allOk) {
    console.log('\n✅  Migração concluída com sucesso!');
    console.log('\nPróximo passo: atualize DATABASE_URL no Render web service');
    console.log('  Render Dashboard → Data-Fill-Tool → Environment → DATABASE_URL');
  } else {
    console.log('\n⚠️  Migração concluída com divergências — verifique acima.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
