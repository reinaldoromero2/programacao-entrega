import { Router, type IRouter } from "express";
import { eq, asc, sql, inArray } from "drizzle-orm";
import { db, entregasTable, pool } from "@workspace/db";
import {
  ListEntregasQueryParams,
  ListEntregasResponse,
  CreateEntregaBody,
  CreateEntregaResponse,
  GetEntregaParams,
  GetEntregaResponse,
  UpdateEntregaParams,
  UpdateEntregaBody,
  UpdateEntregaResponse,
  DeleteEntregaParams,
  ReorderEntregasBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/entregas", async (req, res): Promise<void> => {
  const query = ListEntregasQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const date = query.data.date ?? new Date().toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(entregasTable)
    .where(eq(entregasTable.date, date))
    .orderBy(asc(entregasTable.sortOrder), asc(entregasTable.id));

  res.json(ListEntregasResponse.parse(rows));
});

router.post("/entregas", async (req, res): Promise<void> => {
  const parsed = CreateEntregaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Determine next sort order for the date
  const existing = await db
    .select({ sortOrder: entregasTable.sortOrder })
    .from(entregasTable)
    .where(eq(entregasTable.date, parsed.data.date))
    .orderBy(asc(entregasTable.sortOrder));

  const maxSort = existing.length > 0
    ? Math.max(...existing.map((r) => r.sortOrder ?? 0))
    : -1;

  const [entrega] = await db
    .insert(entregasTable)
    .values({
      ...parsed.data,
      sortOrder: parsed.data.sortOrder ?? maxSort + 1,
      checked: parsed.data.checked ?? "none",
      nf: parsed.data.nf ?? "none",
      cg: parsed.data.cg ?? "none",
      v: parsed.data.v ?? null,
    })
    .returning();

  res.status(201).json(CreateEntregaResponse.parse(entrega));
});

router.post("/entregas/reorder", async (req, res): Promise<void> => {
  const parsed = ReorderEntregasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ids } = parsed.data;

  // Validate all IDs exist before applying reorder
  const existing = await db
    .select({ id: entregasTable.id })
    .from(entregasTable)
    .where(inArray(entregasTable.id, ids));

  const existingIds = new Set(existing.map((r) => r.id));
  const invalid = ids.filter((id) => !existingIds.has(id));
  if (invalid.length > 0) {
    res.status(400).json({ error: `IDs not found: ${invalid.join(", ")}` });
    return;
  }

  // Single bulk UPDATE using UNNEST — avoids N round-trips to the DB
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE entregas
         SET sort_order = c.new_order
         FROM (SELECT UNNEST($1::int[]) AS id, UNNEST($2::int[]) AS new_order) AS c
        WHERE entregas.id = c.id`,
      [ids, ids.map((_, i) => i)]
    );
  } finally {
    client.release();
  }

  res.json({ success: true });
});

router.get("/entregas/divergencias", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: entregasTable.id,
      date: entregasTable.date,
      cliente: entregasTable.cliente,
      motorista: entregasTable.motorista,
      placa: entregasTable.placa,
      divergencias: entregasTable.divergencias,
    })
    .from(entregasTable)
    .where(sql`${entregasTable.divergencias} IS NOT NULL AND ${entregasTable.divergencias} != ''`)
    .orderBy(asc(entregasTable.date), asc(entregasTable.sortOrder));

  res.json(rows);
});

router.get("/entregas/frete-mensal", async (req, res): Promise<void> => {
  const mes = typeof req.query.mes === "string" ? req.query.mes : new Date().toISOString().slice(0, 7);
  const start = `${mes}-01`;
  const end = `${mes}-31`;

  // Frete rows
  const freteRows = await db
    .select({ date: entregasTable.date, frete: entregasTable.frete })
    .from(entregasTable)
    .where(sql`${entregasTable.date} >= ${start} AND ${entregasTable.date} <= ${end} AND ${entregasTable.frete} IS NOT NULL`)
    .orderBy(asc(entregasTable.date));

  // Cancelados: OBS = CANCELADO/CANCELADA OR nf = 'x' OR cg = 'x'
  const cancelRows = await db
    .select({ date: entregasTable.date })
    .from(entregasTable)
    .where(sql`
      ${entregasTable.date} >= ${start} AND ${entregasTable.date} <= ${end}
      AND (
        UPPER(${entregasTable.obs}) IN ('CANCELADO', 'CANCELADA')
        OR ${entregasTable.nf} = 'x'
        OR ${entregasTable.cg} = 'x'
      )
    `)
    .orderBy(asc(entregasTable.date));

  // Summary per frete type
  const tipos = ["RIPACK", "TRANSPORTADORA", "3º", "COLETA"];
  const resumo = tipos.map((tipo) => ({
    frete: tipo,
    total: freteRows.filter((r) => r.frete === tipo).length,
  }));

  // Per-day breakdown (frete + cancelados merged)
  const diasMap = new Map<string, Record<string, number>>();
  for (const row of freteRows) {
    if (!diasMap.has(row.date)) diasMap.set(row.date, {});
    const d = diasMap.get(row.date)!;
    d[row.frete!] = (d[row.frete!] ?? 0) + 1;
  }
  for (const row of cancelRows) {
    if (!diasMap.has(row.date)) diasMap.set(row.date, {});
    const d = diasMap.get(row.date)!;
    d["CANCELADOS"] = (d["CANCELADOS"] ?? 0) + 1;
  }
  const porDia = Array.from(diasMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  res.json({ mes, resumo, porDia, canceladosTotal: cancelRows.length });
});

// ─── Resumo Mensal ────────────────────────────────────────────────────────────
function diasUteisNoMes(ano: number, mes: number): number {
  // Brazilian national fixed holidays (MM-DD)
  const nationalHolidays = new Set([
    "01-01","04-21","05-01","09-07","10-12","11-02","11-15","11-20","12-25",
  ]);
  // São Paulo state fixed holiday (MM-DD)
  const spStateHolidays = new Set([
    "07-09", // Revolução Constitucionalista de 1932
  ]);
  const fixedHolidays = new Set([...nationalHolidays, ...spStateHolidays]);
  // Easter-based holidays (calculated per year)
  const easterHolidays = getEasterBasedHolidays(ano);

  let count = 0;
  const daysInMonth = new Date(ano, mes, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(ano, mes - 1, d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekend
    const mmdd = `${String(mes).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const yyyymmdd = `${ano}-${mmdd}`;
    if (fixedHolidays.has(mmdd) || easterHolidays.has(yyyymmdd)) continue;
    count++;
  }
  return count;
}

function getEasterBasedHolidays(ano: number): Set<string> {
  // Computus algorithm for Easter
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m + 114) / 31);
  const day = ((h + l - 7*m + 114) % 31) + 1;
  const easter = new Date(ano, month - 1, day);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const add = (base: Date, days: number) => new Date(base.getTime() + days * 86400000);
  return new Set([
    fmt(add(easter, -2)),  // Sexta-feira Santa
    fmt(add(easter, 60)),  // Corpus Christi
  ]);
}

router.get("/entregas/resumo-mensal", async (req, res): Promise<void> => {
  const mes = typeof req.query.mes === "string" ? req.query.mes : new Date().toISOString().slice(0, 7);
  const [anoStr, mesStr] = mes.split("-");
  const ano = parseInt(anoStr, 10);
  const mesNum = parseInt(mesStr, 10);
  const start = `${mes}-01`;
  const end = `${mes}-31`;

  // Entries with frete set (for active delivery counts)
  const freteRows = await db
    .select({
      frete: entregasTable.frete,
    })
    .from(entregasTable)
    .where(sql`${entregasTable.date} >= ${start} AND ${entregasTable.date} <= ${end} AND ${entregasTable.frete} IS NOT NULL`);

  // Cancelled entries: same logic as frete-mensal — no frete filter so we catch all
  const cancelRows = await db
    .select({ frete: entregasTable.frete })
    .from(entregasTable)
    .where(sql`
      ${entregasTable.date} >= ${start} AND ${entregasTable.date} <= ${end}
      AND (
        UPPER(${entregasTable.obs}) IN ('CANCELADO', 'CANCELADA')
        OR ${entregasTable.nf} = 'x'
        OR ${entregasTable.cg} = 'x'
      )
    `);

  const canceladasTotal = cancelRows.length;
  const canceladasRipack = cancelRows.filter((r) => r.frete === "RIPACK").length;
  const canceladasTerceiros = cancelRows.filter((r) => r.frete === "TRANSPORTADORA" || r.frete === "3º").length;
  // cancelled entries that have a frete value (to subtract from totals)
  const canceladasComFrete = cancelRows.filter((r) => r.frete !== null).length;

  const total = freteRows.length; // all entries with frete (including cancelled)
  const ripackAtivas = freteRows.filter((r) => r.frete === "RIPACK").length - canceladasRipack;
  const terceirosAtivas = freteRows.filter((r) => r.frete === "TRANSPORTADORA" || r.frete === "3º").length - canceladasTerceiros;
  const coletaAtivas = freteRows.filter((r) => r.frete === "COLETA").length;
  const ativasTotal = total - canceladasComFrete;

  const diasUteis = diasUteisNoMes(ano, mesNum);
  const mediaPorDia = diasUteis > 0 ? Math.round((ativasTotal / diasUteis) * 10) / 10 : 0;

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  res.json({
    mes,
    total,
    ativasTotal,
    ripack: { total: ripackAtivas, pct: pct(ripackAtivas, ativasTotal) },
    terceiros: { total: terceirosAtivas, pct: pct(terceirosAtivas, ativasTotal) },
    coleta: { total: coletaAtivas, pct: pct(coletaAtivas, ativasTotal) },
    diasUteis,
    mediaPorDia,
    canceladas: { total: canceladasTotal, pct: pct(canceladasTotal, total) },
    canceladasRipack,
    canceladasTerceiros,
  });
});

router.get("/entregas/motorista-relatorio", async (req, res): Promise<void> => {
  const filtro = typeof req.query.filtro === "string" ? req.query.filtro : "mes";
  const valor  = typeof req.query.valor  === "string" ? req.query.valor  : new Date().toISOString().slice(0, 7);

  let whereExpr;
  if (filtro === "dia") {
    whereExpr = sql`${entregasTable.date} = ${valor}
      AND ${entregasTable.motorista} IS NOT NULL
      AND ${entregasTable.motorista} <> ''`;
  } else if (filtro === "mes") {
    whereExpr = sql`${entregasTable.date} >= ${valor + "-01"}
      AND ${entregasTable.date} <= ${valor + "-31"}
      AND ${entregasTable.motorista} IS NOT NULL
      AND ${entregasTable.motorista} <> ''`;
  } else {
    whereExpr = sql`${entregasTable.date} >= ${valor + "-01-01"}
      AND ${entregasTable.date} <= ${valor + "-12-31"}
      AND ${entregasTable.motorista} IS NOT NULL
      AND ${entregasTable.motorista} <> ''`;
  }

  const rows = await db
    .select({ motorista: entregasTable.motorista, placa: entregasTable.placa, date: entregasTable.date })
    .from(entregasTable)
    .where(whereExpr)
    .orderBy(asc(entregasTable.date));

  // Group by motorista + placa
  const grouped = new Map<string, { motorista: string; placa: string | null; total: number }>();
  for (const row of rows) {
    const key = `${row.motorista}||${row.placa ?? ""}`;
    if (!grouped.has(key)) grouped.set(key, { motorista: row.motorista!, placa: row.placa, total: 0 });
    grouped.get(key)!.total++;
  }

  const resultado = Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  res.json({ filtro, valor, resultado, totalViagens: rows.length });
});

router.get("/entregas/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetEntregaParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entrega] = await db
    .select()
    .from(entregasTable)
    .where(eq(entregasTable.id, params.data.id));

  if (!entrega) {
    res.status(404).json({ error: "Entrega não encontrada" });
    return;
  }

  res.json(GetEntregaResponse.parse(entrega));
});

router.patch("/entregas/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateEntregaParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateEntregaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [entrega] = await db
    .update(entregasTable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(parsed.data as any)
    .where(eq(entregasTable.id, params.data.id))
    .returning();

  if (!entrega) {
    res.status(404).json({ error: "Entrega não encontrada" });
    return;
  }

  res.json(UpdateEntregaResponse.parse(entrega));
});

router.delete("/entregas/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteEntregaParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entrega] = await db
    .delete(entregasTable)
    .where(eq(entregasTable.id, params.data.id))
    .returning();

  if (!entrega) {
    res.status(404).json({ error: "Entrega não encontrada" });
    return;
  }

  res.sendStatus(204);
});

export default router;
