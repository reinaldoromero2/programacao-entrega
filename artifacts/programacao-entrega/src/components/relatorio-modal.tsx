import { useState, useEffect } from "react";
import { FileText, Download, Loader2, BarChart2, Truck, LayoutList } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";

// ─── API helper ───────────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_URL || "https://data-fill-tool.onrender.com").replace(/\/+$/, "");
const apiFetch = <T = unknown>(path: string): Promise<T> =>
  fetch(`${API_BASE}${path}`).then((r) => {
    if (!r.ok) throw new Error(`Erro ${r.status}`);
    return r.json() as Promise<T>;
  });

// ─── Types ────────────────────────────────────────────────────────────────────

interface Divergencia {
  id: number;
  date: string;
  cliente: string;
  motorista: string | null;
  placa: string | null;
  divergencias: string;
}

interface FreteResumo {
  frete: string;
  total: number;
}

interface FretePorDia {
  date: string;
  RIPACK?: number;
  TRANSPORTADORA?: number;
  "3º"?: number;
  COLETA?: number;
  CANCELADOS?: number;
}

interface FreteMensalData {
  mes: string;
  resumo: FreteResumo[];
  porDia: FretePorDia[];
  canceladosTotal: number;
}

interface CanceladoItem {
  id: number;
  date: string;
  cliente: string;
  obs: string | null;
  frete: string | null;
  nf: string | null;
  cg: string | null;
}

interface MotoristaResult {
  motorista: string;
  placa: string | null;
  total: number;
}

interface MotoristaRelatorio {
  filtro: string;
  valor: string;
  resultado: MotoristaResult[];
  totalViagens: number;
}

interface ResumoMensalData {
  mes: string;
  total: number;
  ativasTotal: number;
  ripack: { total: number; pct: number };
  terceiros: { total: number; pct: number };
  coleta: { total: number; pct: number };
  diasUteis: number;
  mediaPorDia: number;
  canceladas: { total: number; pct: number };
  canceladasRipack: number;
  canceladasTerceiros: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FRETE_CORES: Record<string, string> = {
  RIPACK: "#16a34a",
  TRANSPORTADORA: "#2563eb",
  "3º": "#d97706",
  COLETA: "#7c3aed",
};

const TIPOS = ["RIPACK", "TRANSPORTADORA", "3º", "COLETA"];

function mesAtual() {
  return new Date().toISOString().slice(0, 7);
}

function mesLabel(mes: string) {
  const [ano, num] = mes.split("-");
  const nomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${nomes[parseInt(num) - 1]} ${ano}`;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}
function localMes() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
}
function localAno() { return String(new Date().getFullYear()); }

type FiltroTipo = "dia" | "mes" | "ano";

// ─── Resumo Mensal tab ────────────────────────────────────────────────────────

function ResumoMensalTab() {
  const [mes, setMes] = useState(mesAtual());
  const [data, setData] = useState<ResumoMensalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    setData(null);
    apiFetch<ResumoMensalData>(`/api/entregas/resumo-mensal?mes=${mes}`)
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [mes]);

  const prevMes = () => {
    const [ano, num] = mes.split("-").map(Number);
    setMes(`${num === 1 ? ano - 1 : ano}-${String(num === 1 ? 12 : num - 1).padStart(2,"0")}`);
  };
  const nextMes = () => {
    const [ano, num] = mes.split("-").map(Number);
    setMes(`${num === 12 ? ano + 1 : ano}-${String(num === 12 ? 1 : num + 1).padStart(2,"0")}`);
  };

  const exportExcel = () => {
    if (!data) return;
    const esc = (v: string | number) =>
      String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const cell = (v: string | number, type: "String" | "Number" = "String") =>
      `<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
    const row = (...cells: [string | number, "String" | "Number"?][]) =>
      `<Row>${cells.map(([v, t]) => cell(v, t ?? (typeof v === "number" ? "Number" : "String"))).join("")}</Row>`;
    const sep = `<Row><Cell ss:MergeAcross="2"><Data ss:Type="String"> </Data></Cell></Row>`;

    const rows = [
      row(["RESUMO MENSAL"], [mesLabel(mes)]),
      sep,
      row(["TOTAL DE ENTREGAS NO MÊS", data.total], [""]),
      row(["ENTREGAS REALIZADAS (não canceladas)", data.ativasTotal]),
      sep,
      row(["RIPACK — Total", data.ripack.total], ["Percentual", data.ripack.pct + "%"]),
      row(["TRANSPORTADORA + 3º — Total", data.terceiros.total], ["Percentual", data.terceiros.pct + "%"]),
      ...(data.coleta.total > 0 ? [row(["COLETA — Total", data.coleta.total], ["Percentual", data.coleta.pct + "%"])] : []),
      sep,
      row(["DIAS ÚTEIS NO MÊS", data.diasUteis]),
      row(["MÉDIA DE ENTREGAS POR DIA ÚTIL", data.mediaPorDia]),
      sep,
      row(["CANCELAMENTOS — Total", data.canceladas.total], ["Percentual sobre total", data.canceladas.pct + "%"]),
      row(["CANCELAMENTOS RIPACK", data.canceladasRipack]),
      row(["CANCELAMENTOS TRANSPORTADORA + 3º", data.canceladasTerceiros]),
    ].join("");

    const ss = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Resumo ${mes}"><Table>${rows}</Table></Worksheet></Workbook>`;
    const blob = new Blob([ss], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `resumo_${mes}.xls`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-auto">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <button onClick={prevMes} className="px-3 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
        <span className="text-sm font-semibold text-slate-700">{mesLabel(mes)}</span>
        <button onClick={nextMes} className="px-3 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
      </div>

      {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>}
      {fetchError && <p className="text-sm text-red-500 text-center py-8">{fetchError}</p>}

      {data && !loading && (
        <>
          {/* Grid de cards */}
          <div className="grid grid-cols-2 gap-3">

            {/* Total entregas */}
            <Card accent="#2563eb" label="Total de Entregas no Mês" value={data.total} sub="incluindo cancelamentos" />
            <Card accent="#16a34a" label="Entregas Realizadas" value={data.ativasTotal} sub="excluindo cancelamentos" />

            {/* Ripack */}
            <Card accent="#16a34a" label="RIPACK" value={data.ripack.total}>
              <Pct value={data.ripack.pct} color="#16a34a" />
            </Card>

            {/* Transportadora + 3º */}
            <Card accent="#2563eb" label="TRANSPORTADORA + 3º" value={data.terceiros.total}>
              <Pct value={data.terceiros.pct} color="#2563eb" />
            </Card>

            {/* Coleta */}
            <Card accent="#7c3aed" label="COLETA" value={data.coleta.total}>
              <Pct value={data.coleta.pct} color="#7c3aed" />
            </Card>

            {/* Dias úteis */}
            <Card accent="#7c3aed" label="Dias Úteis no Mês" value={data.diasUteis} sub="excl. finais de semana e feriados" />

            {/* Média por dia */}
            <Card accent="#0891b2" label="Média de Entregas / Dia Útil" value={data.mediaPorDia} />

            {/* Cancelamentos totais */}
            <Card accent="#dc2626" label="Cancelamentos no Mês" value={data.canceladas.total}>
              <Pct value={data.canceladas.pct} color="#dc2626" label="do total" />
            </Card>

            {/* Cancelamentos Ripack */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <Card accent="#dc2626" label="Cancelamentos RIPACK" value={data.canceladasRipack} />
              <Card accent="#dc2626" label="Cancelamentos TRANSP. + 3º" value={data.canceladasTerceiros} />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={exportExcel} className="gap-2 bg-green-700 hover:bg-green-800 text-white">
              <Download className="w-4 h-4" />
              Exportar para Excel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Card({
  accent, label, value, sub, children,
}: {
  accent: string;
  label: string;
  value: number;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-1 shadow-sm" style={{ borderLeftWidth: 4, borderLeftColor: accent }}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
      <p className="text-3xl font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
      {children}
    </div>
  );
}

function Pct({ value, color, label = "das realizadas" }: { value: number; color: string; label?: string }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 bg-slate-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{value}%</span>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

// ─── Divergencias tab ─────────────────────────────────────────────────────────

function DivergenciasTab() {
  const [data, setData] = useState<Divergencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<FiltroTipo>("mes");
  const [dia, setDia] = useState(localToday);
  const [mes, setMes] = useState(localMes);
  const [ano, setAno] = useState(localAno);

  useEffect(() => {
    setLoading(true);
    apiFetch<Divergencia[]>("/api/entregas/divergencias")
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = data.filter((d) => {
    if (filtro === "dia") return d.date === dia;
    if (filtro === "mes") return d.date.startsWith(mes);
    return d.date.startsWith(ano);
  });

  const prevMes = () => {
    const [a, m] = mes.split("-").map(Number);
    const p = m === 1 ? 12 : m - 1;
    setMes(`${m === 1 ? a - 1 : a}-${String(p).padStart(2,"0")}`);
  };
  const nextMes = () => {
    const [a, m] = mes.split("-").map(Number);
    const p = m === 12 ? 1 : m + 1;
    setMes(`${m === 12 ? a + 1 : a}-${String(p).padStart(2,"0")}`);
  };

  const exportExcel = () => {
    const rows = [
      ["DATA", "CLIENTE", "MOTORISTA", "PLACA", "DIVERGÊNCIAS"],
      ...filtered.map((d) => [d.date, d.cliente, d.motorista ?? "", d.placa ?? "", d.divergencias]),
    ];
    const xml = rows.map((row) =>
      "<Row>" + row.map((cell) =>
        `<Cell><Data ss:Type="String">${String(cell).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</Data></Cell>`
      ).join("") + "</Row>"
    ).join("");
    const ss = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Divergencias"><Table>${xml}</Table></Worksheet></Workbook>`;
    const blob = new Blob([ss], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `divergencias_${dia}.xls`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>;
  if (fetchError) return <p className="text-sm text-red-500 text-center py-8">{fetchError}</p>;

  return (
    <>
      <div className="flex items-center gap-3 pb-2">
        <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs font-semibold">
          {(["dia", "mes", "ano"] as FiltroTipo[]).map((t) => (
            <button
              key={t}
              onClick={() => setFiltro(t)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filtro === t ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t === "dia" ? "Dia" : t === "mes" ? "Mês" : "Ano"}
            </button>
          ))}
        </div>

        {filtro === "dia" && (
          <input
            type="date"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}

        {filtro === "mes" && (
          <div className="flex items-center gap-1">
            <button onClick={prevMes} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
            <span className="text-sm font-semibold text-slate-700 w-24 text-center">{mesLabel(mes)}</span>
            <button onClick={nextMes} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
          </div>
        )}

        {filtro === "ano" && (
          <div className="flex items-center gap-1">
            <button onClick={() => setAno((a) => String(Number(a) - 1))} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
            <span className="text-sm font-semibold text-slate-700 w-14 text-center">{ano}</span>
            <button onClick={() => setAno((a) => String(Number(a) + 1))} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
          </div>
        )}

        <span className="text-xs text-slate-400 ml-auto">{filtered.length} registro{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8 italic">Nenhuma divergência no período selecionado.</p>
      ) : (
        <>
          <div className="flex-1 overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-semibold text-xs uppercase sticky top-0">
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Motorista</th>
                  <th className="px-3 py-2 text-left">Placa</th>
                  <th className="px-3 py-2 text-left">Divergências</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{d.date}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{d.cliente}</td>
                    <td className="px-3 py-2 text-slate-600">{d.motorista ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-600 font-mono">{d.placa ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-700">{d.divergencias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end pt-3">
            <Button size="sm" onClick={exportExcel} className="gap-2 bg-green-700 hover:bg-green-800 text-white">
              <Download className="w-4 h-4" />
              Exportar para Excel
            </Button>
          </div>
        </>
      )}
    </>
  );
}

// ─── Frete mensal tab ─────────────────────────────────────────────────────────

function FreteMensalTab() {
  const [mes, setMes] = useState(mesAtual());
  const [data, setData] = useState<FreteMensalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelados, setCancelados] = useState<CanceladoItem[] | null>(null);
  const [loadingCancelados, setLoadingCancelados] = useState(false);
  const [showCancelados, setShowCancelados] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    setShowCancelados(false);
    setCancelados(null);
    apiFetch<FreteMensalData>(`/api/entregas/frete-mensal?mes=${mes}`)
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro"))
      .finally(() => setLoading(false));
  }, [mes]);

  const handleCanceladosClick = () => {
    if (showCancelados) { setShowCancelados(false); return; }
    setShowCancelados(true);
    if (cancelados !== null) return;
    setLoadingCancelados(true);
    apiFetch<CanceladoItem[]>(`/api/entregas/cancelados?mes=${mes}`)
      .then(setCancelados)
      .catch(() => setCancelados([]))
      .finally(() => setLoadingCancelados(false));
  };

  const prevMes = () => {
    const [ano, num] = mes.split("-").map(Number);
    const p = num === 1 ? 12 : num - 1;
    const a = num === 1 ? ano - 1 : ano;
    setMes(`${a}-${String(p).padStart(2, "0")}`);
  };
  const nextMes = () => {
    const [ano, num] = mes.split("-").map(Number);
    const p = num === 12 ? 1 : num + 1;
    const a = num === 12 ? ano + 1 : ano;
    setMes(`${a}-${String(p).padStart(2, "0")}`);
  };

  const total = data?.resumo.reduce((s, r) => s + r.total, 0) ?? 0;
  const canceladosTotal = data?.canceladosTotal ?? 0;
  const hasCancelados = canceladosTotal > 0;

  const pieData = [
    ...( data?.resumo.filter((r) => r.total > 0) ?? [] ),
    ...(hasCancelados ? [{ frete: "CANCELADOS", total: canceladosTotal }] : []),
  ];

  const CANCELADOS_COR = "#dc2626";
  const corOf = (frete: string) => frete === "CANCELADOS" ? CANCELADOS_COR : (FRETE_CORES[frete] ?? "#94a3b8");

  const activeFreteTipos = TIPOS.filter((t) => data?.resumo.find((r) => r.frete === t && r.total > 0));
  const hasCanceladosBar = data?.porDia.some((d) => (d as unknown as Record<string, number>)["CANCELADOS"] > 0);

  const exportExcel = () => {
    if (!data) return;
    const esc = (v: string | number) =>
      String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cell = (v: string | number) =>
      `<Cell><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${esc(v)}</Data></Cell>`;
    const row = (cells: (string | number)[]) =>
      `<Row>${cells.map(cell).join("")}</Row>`;

    const allCols = [...TIPOS, ...(data.canceladosTotal > 0 ? ["CANCELADOS"] : [])];

    const rows = [
      row(["TIPO DE FRETE", "TOTAL"]),
      ...data.resumo.map((r) => row([r.frete, r.total])),
      ...(data.canceladosTotal > 0 ? [row(["CANCELADOS / X", data.canceladosTotal])] : []),
      "<Row/>",
      row(["DATA", ...allCols]),
      ...data.porDia.map((d) =>
        row([d.date, ...allCols.map((c) => ((d as unknown as Record<string, number>)[c] ?? 0))])
      ),
    ].join("");

    const ss = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Frete ${mes}"><Table>${rows}</Table></Worksheet></Workbook>`;
    const blob = new Blob([ss], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `frete-mensal_${mes}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <button onClick={prevMes} className="px-3 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
        <span className="text-sm font-semibold text-slate-700">{mesLabel(mes)}</span>
        <button onClick={nextMes} className="px-3 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
      </div>

      {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>}
      {fetchError && <p className="text-sm text-red-500 text-center py-8">{fetchError}</p>}

      {data && !loading && (
        <>
          {total === 0 && !hasCancelados ? (
            <p className="text-sm text-slate-400 text-center py-8 italic">Nenhuma entrega registrada em {mesLabel(mes)}.</p>
          ) : (
            <>
            <div className="flex gap-4 flex-1 min-h-0">
              <div className="flex flex-col items-center gap-3 w-52 flex-shrink-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total do Mês</p>
                {pieData.length > 0 && (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="total"
                        nameKey="frete"
                        cx="50%"
                        cy="50%"
                        outerRadius={75}
                        label={({ percent }) => `${Math.round((percent ?? 0) * 100)}%`}
                        labelLine={false}
                        onClick={(entry: { frete?: string }) => {
                          if (entry.frete === "CANCELADOS") handleCanceladosClick();
                        }}
                      >
                        {pieData.map((entry) => (
                          <Cell
                            key={entry.frete}
                            fill={corOf(entry.frete)}
                            style={entry.frete === "CANCELADOS" ? { cursor: "pointer" } : undefined}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value}`, name as string]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}

                <div className="w-full flex flex-col gap-1">
                  {data.resumo.map((r) => (
                    <div key={r.frete} className="flex items-center justify-between px-2 py-1 rounded text-xs" style={{ background: FRETE_CORES[r.frete] + "18" }}>
                      <span className="flex items-center gap-1.5 font-medium" style={{ color: FRETE_CORES[r.frete] }}>
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: FRETE_CORES[r.frete] }} />
                        {r.frete}
                      </span>
                      <span className="font-bold text-slate-700">{r.total}</span>
                    </div>
                  ))}

                  {hasCancelados && (
                    <button
                      onClick={handleCanceladosClick}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs mt-1 border transition-colors ${showCancelados ? "border-red-400 bg-red-100" : "border-red-200 hover:border-red-400 hover:bg-red-100"}`}
                      style={{ background: showCancelados ? undefined : "#fef2f2" }}
                      title="Clique para ver as cargas canceladas"
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-red-600">
                        <span className="w-2 h-2 rounded-full inline-block bg-red-600" />
                        CANCELADOS / X
                      </span>
                      <span className="font-bold text-red-700">{canceladosTotal}</span>
                    </button>
                  )}
                </div>
              </div>

              {data.porDia.length > 0 && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Por Dia</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.porDia} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: string) => v.slice(8)}
                      />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={(v: string) => v} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      {activeFreteTipos.map((tipo) => (
                        <Bar key={tipo} dataKey={tipo} stackId="a" fill={FRETE_CORES[tipo]} />
                      ))}
                      {hasCanceladosBar && (
                        <Bar dataKey="CANCELADOS" stackId="b" fill={CANCELADOS_COR} onClick={handleCanceladosClick} style={{ cursor: "pointer" }} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            {/* ── Lista de cancelados ───────────────────────────────── */}
            {showCancelados && (
              <div className="rounded-lg border border-red-200 bg-red-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-red-100 border-b border-red-200">
                  <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                    Cargas Canceladas — {mesLabel(mes)}
                  </span>
                  <button onClick={() => setShowCancelados(false)} className="text-red-400 hover:text-red-700 text-lg leading-none">×</button>
                </div>
                {loadingCancelados && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                  </div>
                )}
                {!loadingCancelados && cancelados !== null && cancelados.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-4 italic">Nenhum cancelamento encontrado.</p>
                )}
                {!loadingCancelados && cancelados && cancelados.length > 0 && (
                  <div className="overflow-x-auto max-h-52 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-red-100">
                        <tr>
                          <th className="text-left px-3 py-1.5 text-red-700 font-semibold">Data</th>
                          <th className="text-left px-3 py-1.5 text-red-700 font-semibold">Cliente</th>
                          <th className="text-left px-3 py-1.5 text-red-700 font-semibold">Frete</th>
                          <th className="text-left px-3 py-1.5 text-red-700 font-semibold">OBS</th>
                          <th className="text-center px-3 py-1.5 text-red-700 font-semibold">NF</th>
                          <th className="text-center px-3 py-1.5 text-red-700 font-semibold">CG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cancelados.map((c, i) => (
                          <tr key={c.id} className={i % 2 === 0 ? "bg-white" : "bg-red-50"}>
                            <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.date.slice(8)}/{c.date.slice(5,7)}</td>
                            <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[160px] truncate">{c.cliente || "—"}</td>
                            <td className="px-3 py-1.5 text-slate-600">{c.frete || "—"}</td>
                            <td className="px-3 py-1.5 text-slate-600 uppercase">{c.obs || "—"}</td>
                            <td className="px-3 py-1.5 text-center text-red-600 font-bold">{c.nf === "x" ? "✗" : ""}</td>
                            <td className="px-3 py-1.5 text-center text-red-600 font-bold">{c.cg === "x" ? "✗" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={exportExcel} className="gap-2 bg-green-700 hover:bg-green-800 text-white">
                <Download className="w-4 h-4" />
                Exportar para Excel
              </Button>
            </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Motorista tab ────────────────────────────────────────────────────────────

const MOTORISTA_CORES = [
  "#2563eb","#16a34a","#d97706","#7c3aed","#0891b2","#db2777","#65a30d","#ea580c",
  "#0284c7","#dc2626","#9333ea","#059669",
];

function MotoristaTab() {
  const [filtro, setFiltro] = useState<FiltroTipo>("mes");
  const [dia,  setDia]  = useState(localToday);
  const [mes,  setMes]  = useState(localMes);
  const [ano,  setAno]  = useState(localAno);

  const [data, setData] = useState<MotoristaRelatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const valor = filtro === "dia" ? dia : filtro === "mes" ? mes : ano;

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    apiFetch<MotoristaRelatorio>(`/api/entregas/motorista-relatorio?filtro=${filtro}&valor=${valor}`)
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro"))
      .finally(() => setLoading(false));
  }, [filtro, valor]);

  const prevMes = () => {
    const [a, m] = mes.split("-").map(Number);
    setMes(`${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2,"0")}`);
  };
  const nextMes = () => {
    const [a, m] = mes.split("-").map(Number);
    setMes(`${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2,"0")}`);
  };

  const exportExcel = () => {
    if (!data || data.resultado.length === 0) return;
    const esc = (v: string | number) =>
      String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const cell = (v: string | number) =>
      `<Cell><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${esc(v)}</Data></Cell>`;
    const row = (cells: (string | number)[]) => `<Row>${cells.map(cell).join("")}</Row>`;

    const rows = [
      row(["MOTORISTA","PLACA","VIAGENS"]),
      ...data.resultado.map((r) => row([r.motorista, r.placa ?? "-", r.total])),
      "<Row/>",
      row(["TOTAL","",data.totalViagens]),
    ].join("");

    const ss = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Motoristas"><Table>${rows}</Table></Worksheet></Workbook>`;
    const blob = new Blob([ss], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `motoristas_${filtro}_${valor}.xls`; a.click();
    URL.revokeObjectURL(url);
  };

  const periodoLabel =
    filtro === "dia" ? dia :
    filtro === "mes" ? mesLabel(mes) :
    ano;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-3">
        <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs font-semibold">
          {(["dia","mes","ano"] as FiltroTipo[]).map((t) => (
            <button key={t} onClick={() => setFiltro(t)}
              className={`px-3 py-1.5 transition-colors ${filtro === t ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              {t === "dia" ? "Dia" : t === "mes" ? "Mês" : "Ano"}
            </button>
          ))}
        </div>

        {filtro === "dia" && (
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
        {filtro === "mes" && (
          <div className="flex items-center gap-1">
            <button onClick={prevMes} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
            <span className="text-sm font-semibold text-slate-700 w-24 text-center">{mesLabel(mes)}</span>
            <button onClick={nextMes} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
          </div>
        )}
        {filtro === "ano" && (
          <div className="flex items-center gap-1">
            <button onClick={() => setAno((a) => String(Number(a) - 1))} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
            <span className="text-sm font-semibold text-slate-700 w-14 text-center">{ano}</span>
            <button onClick={() => setAno((a) => String(Number(a) + 1))} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
          </div>
        )}

        {data && !loading && (
          <span className="text-xs text-slate-400 ml-auto">
            {data.totalViagens} viagem{data.totalViagens !== 1 ? "s" : ""} · {periodoLabel}
          </span>
        )}
      </div>

      {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>}
      {fetchError && <p className="text-sm text-red-500 text-center py-8">{fetchError}</p>}

      {data && !loading && (
        <>
          {data.resultado.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8 italic">Nenhuma viagem registrada no período.</p>
          ) : (
            <>
              <div className="flex-shrink-0">
                <ResponsiveContainer width="100%" height={Math.max(120, data.resultado.length * 36)}>
                  <BarChart
                    data={data.resultado.map((r, i) => ({
                      nome: r.placa ? `${r.motorista} · ${r.placa}` : r.motorista,
                      viagens: r.total,
                      cor: MOTORISTA_CORES[i % MOTORISTA_CORES.length],
                    }))}
                    layout="vertical"
                    margin={{ top: 2, right: 40, left: 8, bottom: 2 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" tick={{ fontSize: 11 }} width={160} />
                    <Tooltip formatter={(v) => [`${v} viagem${Number(v) !== 1 ? "s" : ""}`, "Total"]} />
                    <Bar dataKey="viagens" radius={[0, 4, 4, 0]}>
                      {data.resultado.map((_, i) => (
                        <Cell key={i} fill={MOTORISTA_CORES[i % MOTORISTA_CORES.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="flex-1 overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-semibold text-xs uppercase sticky top-0">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Motorista</th>
                      <th className="px-3 py-2 text-left">Placa</th>
                      <th className="px-3 py-2 text-center">Viagens</th>
                      <th className="px-3 py-2 text-left">Participação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.resultado.map((r, i) => {
                      const pct = data.totalViagens > 0 ? Math.round((r.total / data.totalViagens) * 100) : 0;
                      const cor = MOTORISTA_CORES[i % MOTORISTA_CORES.length];
                      return (
                        <tr key={`${r.motorista}-${r.placa}`} className="border-t border-slate-200 hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-800">{r.motorista}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{r.placa ?? "—"}</td>
                          <td className="px-3 py-2 text-center font-bold" style={{ color: cor }}>{r.total}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-100 rounded-full h-2">
                                <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: cor }} />
                              </div>
                              <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-1">
                <Button size="sm" onClick={exportExcel} className="gap-2 bg-green-700 hover:bg-green-800 text-white">
                  <Download className="w-4 h-4" />
                  Exportar para Excel
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

type Tab = "resumo" | "divergencias" | "frete" | "motoristas";

export function RelatorioModal() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("resumo");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 text-slate-700 border-slate-300 hover:bg-slate-100">
          <FileText className="w-4 h-4" />
          RELATÓRIO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <FileText className="w-5 h-5 text-blue-600" />
            Relatórios
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 gap-1 -mx-1 px-1">
          {([
            { key: "resumo",       label: "Resumo Mensal",    icon: <LayoutList className="w-3.5 h-3.5" /> },
            { key: "divergencias", label: "Divergências",     icon: <FileText className="w-3.5 h-3.5" /> },
            { key: "frete",        label: "Frete Mensal",     icon: <BarChart2 className="w-3.5 h-3.5" /> },
            { key: "motoristas",   label: "Viagens/Motorista", icon: <Truck className="w-3.5 h-3.5" /> },
          ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col min-h-0 pt-1">
          {open && tab === "resumo"       && <ResumoMensalTab />}
          {open && tab === "divergencias" && <DivergenciasTab />}
          {open && tab === "frete"        && <FreteMensalTab />}
          {open && tab === "motoristas"   && <MotoristaTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
