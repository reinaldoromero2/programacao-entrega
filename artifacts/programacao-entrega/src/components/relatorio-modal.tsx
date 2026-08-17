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

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Extract cancellation reason from obs field. "CANCELADO - Produção não terminou" → "Produção não terminou" */
function extractMotivo(obs: string | null): string {
  if (!obs) return "—";
  const m = obs.match(/^CANCELAD[AO]\s*[-–]\s*(.+)/i);
  if (m) return m[1].trim();
  if (/^CANCELAD[AO]$/i.test(obs.trim())) return "Sem motivo";
  return obs;
}

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
  motorista: string | null;
  placa: string | null;
  obs: string | null;
  frete: string | null;
  divergencias: string | null;
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

interface ClienteResult {
  cliente: string;
  total: number;
}

interface ClienteRelatorio {
  filtro: string;
  valor: string;
  resultado: ClienteResult[];
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

function FreteMensalTab({ onNavigateDia }: { onNavigateDia?: (dateStr: string) => void } = {}) {
  const [mes, setMes] = useState(mesAtual());
  const [data, setData] = useState<FreteMensalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedFrete, setSelectedFrete] = useState<string | null>(null);
  const [freteList, setFreteList] = useState<CanceladoItem[] | null>(null);
  const [loadingFreteList, setLoadingFreteList] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    setSelectedFrete(null);
    setFreteList(null);
    apiFetch<FreteMensalData>(`/api/entregas/frete-mensal?mes=${mes}`)
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro"))
      .finally(() => setLoading(false));
  }, [mes]);

  const handleFreteClick = (frete: string) => {
    if (selectedFrete === frete) { setSelectedFrete(null); return; }
    setSelectedFrete(frete);
    setLoadingFreteList(true);
    apiFetch<CanceladoItem[]>(`/api/entregas/por-frete?mes=${mes}&frete=${encodeURIComponent(frete)}`)
      .then(setFreteList)
      .catch(() => setFreteList([]))
      .finally(() => setLoadingFreteList(false));
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
    <div className="flex flex-col gap-4">
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
            <div className="flex gap-4">
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
                          if (entry.frete) handleFreteClick(entry.frete);
                        }}
                      >
                        {pieData.map((entry) => (
                          <Cell
                            key={entry.frete}
                            fill={corOf(entry.frete)}
                            style={{ cursor: "pointer" }}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value}`, name as string]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}

                <div className="w-full flex flex-col gap-1">
                  {data.resumo.map((r) => (
                    <button
                      key={r.frete}
                      onClick={() => handleFreteClick(r.frete)}
                      className="w-full flex items-center justify-between px-2 py-1 rounded text-xs transition-colors hover:opacity-80"
                      style={{
                        background: selectedFrete === r.frete ? FRETE_CORES[r.frete] + "40" : FRETE_CORES[r.frete] + "18",
                        outline: selectedFrete === r.frete ? `2px solid ${FRETE_CORES[r.frete]}` : undefined,
                      }}
                      title={`Clique para ver cargas ${r.frete}`}
                    >
                      <span className="flex items-center gap-1.5 font-medium" style={{ color: FRETE_CORES[r.frete] }}>
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: FRETE_CORES[r.frete] }} />
                        {r.frete}
                      </span>
                      <span className="font-bold text-slate-700">{r.total}</span>
                    </button>
                  ))}

                  {hasCancelados && (
                    <button
                      onClick={() => handleFreteClick("CANCELADOS")}
                      className="w-full flex items-center justify-between px-2 py-1 rounded text-xs mt-1 border transition-colors hover:bg-red-100"
                      style={{
                        background: selectedFrete === "CANCELADOS" ? "#fecaca" : "#fef2f2",
                        borderColor: selectedFrete === "CANCELADOS" ? "#dc2626" : "#fecaca",
                        outline: selectedFrete === "CANCELADOS" ? "2px solid #dc2626" : undefined,
                      }}
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
                        <Bar key={tipo} dataKey={tipo} stackId="a" fill={FRETE_CORES[tipo]} onClick={() => handleFreteClick(tipo)} style={{ cursor: "pointer" }} />
                      ))}
                      {hasCanceladosBar && (
                        <Bar dataKey="CANCELADOS" stackId="b" fill={CANCELADOS_COR} onClick={() => handleFreteClick("CANCELADOS")} style={{ cursor: "pointer" }} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            {/* ── Lista por tipo de frete ───────────────────────────── */}
            {selectedFrete && (() => {
              const isCancel = selectedFrete === "CANCELADOS";
              const accent   = isCancel ? "#dc2626" : (FRETE_CORES[selectedFrete] ?? "#2563eb");
              const bgLight  = accent + "12";
              const bgMed    = accent + "25";
              const label    = isCancel ? "Cargas Canceladas" : `Cargas — ${selectedFrete}`;
              return (
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${accent}40` }}>
                  <div className="flex items-center justify-between px-3 py-2 border-b" style={{ background: bgMed, borderColor: accent + "40" }}>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
                      {label} — {mesLabel(mes)}
                    </span>
                    <button onClick={() => setSelectedFrete(null)} className="text-lg leading-none hover:opacity-70" style={{ color: accent }}>×</button>
                  </div>
                  {loadingFreteList && (
                    <div className="flex items-center justify-center py-6" style={{ background: bgLight }}>
                      <Loader2 className="w-5 h-5 animate-spin" style={{ color: accent }} />
                    </div>
                  )}
                  {!loadingFreteList && freteList !== null && freteList.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4 italic" style={{ background: bgLight }}>Nenhuma carga encontrada.</p>
                  )}
                  {/* Motivo breakdown summary (only for CANCELADOS) */}
                  {!loadingFreteList && isCancel && freteList && freteList.length > 0 && (() => {
                    const summary = freteList.reduce<Record<string, number>>((acc, c) => {
                      const m = extractMotivo(c.obs);
                      acc[m] = (acc[m] ?? 0) + 1;
                      return acc;
                    }, {});
                    const entries = Object.entries(summary).sort((a, b) => b[1] - a[1]);
                    return (
                      <div className="px-3 py-2 border-b" style={{ borderColor: accent + "40", background: bgLight }}>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: accent }}>Resumo por motivo</p>
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                          {entries.map(([motivo, count]) => (
                            <span key={motivo} className="text-xs text-slate-700">
                              <span className="font-bold" style={{ color: accent }}>{count}×</span> {motivo}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {!loadingFreteList && freteList && freteList.length > 0 && (
                    <div className="overflow-x-auto max-h-52 overflow-y-auto" style={{ background: bgLight }}>
                      <table className="w-full text-xs">
                        <thead className="sticky top-0" style={{ background: bgMed }}>
                          <tr>
                            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>Data</th>
                            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>Cliente</th>
                            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>Motorista</th>
                            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>Placa</th>
                            {isCancel && <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>Frete</th>}
                            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>{isCancel ? "Motivo" : "OBS"}</th>
                            <th className="text-left px-3 py-1.5 font-semibold" style={{ color: accent }}>Divergências</th>
                          </tr>
                        </thead>
                        <tbody>
                          {freteList.map((c, i) => (
                            <tr key={c.id}
                              className={`${i % 2 === 0 ? "bg-white" : ""} ${isCancel && onNavigateDia ? "cursor-pointer hover:brightness-95" : ""}`}
                              style={i % 2 !== 0 ? { background: bgLight } : undefined}
                              onClick={isCancel && onNavigateDia ? () => onNavigateDia(c.date) : undefined}
                              title={isCancel && onNavigateDia ? `Ir para ${c.date.slice(8)}/${c.date.slice(5,7)}/${c.date.slice(0,4)}` : undefined}
                            >
                              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.date.slice(8)}/{c.date.slice(5,7)}</td>
                              <td className="px-3 py-1.5 font-medium text-slate-800 whitespace-nowrap">{c.cliente || "—"}</td>
                              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.motorista || "—"}</td>
                              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.placa || "—"}</td>
                              {isCancel && <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{c.frete || "—"}</td>}
                              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{isCancel ? extractMotivo(c.obs) : (c.obs || "—")}</td>
                              <td className="px-3 py-1.5 text-slate-600 min-w-[200px]">{c.divergencias || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

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

interface MotoristaViagem { date: string; cliente: string; frete: string; obs: string; }

function MotoristaTab({ onNavigateDia }: { onNavigateDia?: (dateStr: string) => void }) {
  const [filtro, setFiltro] = useState<FiltroTipo>("mes");
  const [dia,  setDia]  = useState(localToday);
  const [mes,  setMes]  = useState(localMes);
  const [ano,  setAno]  = useState(localAno);

  const [data, setData] = useState<MotoristaRelatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedMotorista, setSelectedMotorista] = useState<string | null>(null);
  const [motoristaViagens, setMotoristaViagens] = useState<MotoristaViagem[] | null>(null);
  const [loadingViagens, setLoadingViagens] = useState(false);

  const valor = filtro === "dia" ? dia : filtro === "mes" ? mes : ano;

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    setSelectedMotorista(null);
    setMotoristaViagens(null);
    apiFetch<MotoristaRelatorio>(`/api/entregas/motorista-relatorio?filtro=${filtro}&valor=${valor}`)
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro"))
      .finally(() => setLoading(false));
  }, [filtro, valor]);

  const handleMotoristaClick = (motorista: string) => {
    if (selectedMotorista === motorista) { setSelectedMotorista(null); setMotoristaViagens(null); return; }
    setSelectedMotorista(motorista);
    setLoadingViagens(true);
    apiFetch<{ viagens: MotoristaViagem[] }>(
      `/api/entregas/motorista-datas?filtro=${filtro}&valor=${valor}&motorista=${encodeURIComponent(motorista)}`
    )
      .then(r => setMotoristaViagens(r.viagens))
      .catch(() => setMotoristaViagens([]))
      .finally(() => setLoadingViagens(false));
  };

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
              <div className="overflow-y-auto border rounded-md" style={{ maxHeight: "200px" }}>
                <ResponsiveContainer width="100%" height={Math.max(120, data.resultado.length * 36)}>
                  <BarChart
                    data={data.resultado.map((r, i) => ({
                      nome: r.placa ? `${r.motorista} · ${r.placa}` : r.motorista,
                      viagens: r.total,
                      cor: MOTORISTA_CORES[i % MOTORISTA_CORES.length],
                    }))}
                    layout="vertical"
                    margin={{ top: 2, right: 40, left: 8, bottom: 2 }}
                    onClick={(s) => { if (s?.activePayload?.[0]?.payload?.nome) { const raw = s.activePayload[0].payload.nome as string; const motorista = raw.includes(" · ") ? raw.split(" · ")[0]! : raw; handleMotoristaClick(motorista); } }}
                    style={{ cursor: "pointer" }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" tick={{ fontSize: 11 }} width={160} />
                    <Tooltip formatter={(v) => [`${v} viagem${Number(v) !== 1 ? "s" : ""}`, "Total"]} />
                    <Bar dataKey="viagens" radius={[0, 4, 4, 0]}>
                      {data.resultado.map((r, i) => (
                        <Cell
                          key={i}
                          fill={MOTORISTA_CORES[i % MOTORISTA_CORES.length]}
                          opacity={selectedMotorista && selectedMotorista !== r.motorista ? 0.4 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Linha lado a lado: tabela de motoristas | painel de viagens */}
              <div className="flex gap-3 min-h-0" style={{ height: "260px" }}>

                {/* Esquerda — ranking de motoristas */}
                <div className="w-1/2 overflow-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold text-xs uppercase sticky top-0">
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Motorista</th>
                        <th className="px-3 py-2 text-left">Placa</th>
                        <th className="px-3 py-2 text-center">Viagens</th>
                        <th className="px-3 py-2 text-left">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.resultado.map((r, i) => {
                        const pct = data.totalViagens > 0 ? Math.round((r.total / data.totalViagens) * 100) : 0;
                        const cor = MOTORISTA_CORES[i % MOTORISTA_CORES.length];
                        return (
                          <tr
                            key={`${r.motorista}-${r.placa}`}
                            onClick={() => handleMotoristaClick(r.motorista)}
                            className={`border-t border-slate-200 cursor-pointer transition-colors ${selectedMotorista === r.motorista ? "bg-blue-50" : "hover:bg-slate-50"}`}
                          >
                            <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{r.motorista}</td>
                            <td className="px-3 py-2 font-mono text-slate-600 text-xs">{r.placa ?? "—"}</td>
                            <td className="px-3 py-2 text-center font-bold" style={{ color: cor }}>{r.total}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <div className="flex-1 bg-slate-100 rounded-full h-2">
                                  <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: cor }} />
                                </div>
                                <span className="text-xs text-slate-500 w-7 text-right">{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Direita — viagens do motorista selecionado */}
                <div className="w-1/2 rounded-md overflow-hidden border border-blue-200 flex flex-col">
                  {!selectedMotorista ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l6 6m0 0l-6 6m6-6H3" />
                      </svg>
                      <p className="text-xs">Clique em um motorista para ver as viagens</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border-b border-blue-200 shrink-0">
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700 truncate pr-2">
                          {selectedMotorista}
                          {motoristaViagens && !loadingViagens && (
                            <span className="ml-2 font-normal text-blue-500 normal-case">
                              · {motoristaViagens.reduce((s, v) => s + (v.cliente.replace(/\([^)]*\)/g,"").split("+").filter(p=>p.trim()).length || 1), 0)} viagem{motoristaViagens.reduce((s, v) => s + (v.cliente.replace(/\([^)]*\)/g,"").split("+").filter(p=>p.trim()).length || 1), 0) !== 1 ? "s" : ""} em {periodoLabel}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => { setSelectedMotorista(null); setMotoristaViagens(null); }}
                          className="text-blue-400 hover:text-blue-600 text-lg leading-none shrink-0"
                        >×</button>
                      </div>
                      {loadingViagens && (
                        <div className="flex items-center justify-center flex-1">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        </div>
                      )}
                      {!loadingViagens && motoristaViagens?.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-6 italic flex-1">Nenhuma viagem encontrada.</p>
                      )}
                      {!loadingViagens && motoristaViagens && motoristaViagens.length > 0 && (
                        <div className="overflow-y-auto flex-1">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-blue-100">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">Data</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">Cliente</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">Frete</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">OBS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {motoristaViagens.map((v, i) => (
                                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-blue-50/40"}>
                                  <td
                                    className={`px-3 py-1.5 font-medium whitespace-nowrap ${onNavigateDia ? "text-blue-600 underline cursor-pointer hover:text-blue-800" : "text-slate-700"}`}
                                    onClick={() => onNavigateDia?.(v.date)}
                                    title={onNavigateDia ? "Ir para este dia" : undefined}
                                  >
                                    {v.date.slice(8)}/{v.date.slice(5,7)}/{v.date.slice(0,4)}
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-600">{v.cliente || "—"}</td>
                                  <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{v.frete || "—"}</td>
                                  <td className="px-3 py-1.5 text-slate-500">{v.obs || ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
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
        </>
      )}
    </div>
  );
}

// ─── Cliente tab ──────────────────────────────────────────────────────────────

const CLIENTE_CORES = [
  "#2563eb","#16a34a","#d97706","#7c3aed","#0891b2","#db2777","#65a30d","#ea580c",
  "#0284c7","#dc2626","#9333ea","#059669",
];

interface ClienteViagem { date: string; motorista: string; frete: string; obs: string; }

function ClienteTab({ onNavigateDia }: { onNavigateDia?: (dateStr: string) => void }) {
  const [filtro, setFiltro] = useState<FiltroTipo>("mes");
  const [dia,  setDia]  = useState(localToday);
  const [mes,  setMes]  = useState(localMes);
  const [ano,  setAno]  = useState(localAno);

  const [data, setData] = useState<ClienteRelatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedCliente, setSelectedCliente] = useState<string | null>(null);
  const [clienteViagens, setClienteViagens] = useState<ClienteViagem[] | null>(null);
  const [loadingViagens, setLoadingViagens] = useState(false);

  const valor = filtro === "dia" ? dia : filtro === "mes" ? mes : ano;

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    setSelectedCliente(null);
    setClienteViagens(null);
    apiFetch<ClienteRelatorio>(`/api/entregas/cliente-relatorio?filtro=${filtro}&valor=${valor}`)
      .then(setData)
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : "Erro"))
      .finally(() => setLoading(false));
  }, [filtro, valor]);

  const handleClienteClick = (nome: string) => {
    if (selectedCliente === nome) { setSelectedCliente(null); setClienteViagens(null); return; }
    setSelectedCliente(nome);
    setLoadingViagens(true);
    apiFetch<{ viagens: ClienteViagem[] }>(
      `/api/entregas/cliente-datas?filtro=${filtro}&valor=${valor}&cliente=${encodeURIComponent(nome)}`
    )
      .then(r => setClienteViagens(r.viagens))
      .catch(() => setClienteViagens([]))
      .finally(() => setLoadingViagens(false));
  };

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
      row(["CLIENTE","ENTREGAS"]),
      ...data.resultado.map((r) => row([r.cliente, r.total])),
      "<Row/>",
      row(["TOTAL","",data.totalViagens]),
    ].join("");

    const ss = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Clientes"><Table>${rows}</Table></Worksheet></Workbook>`;
    const blob = new Blob([ss], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `clientes_${filtro}_${valor}.xls`; a.click();
    URL.revokeObjectURL(url);
  };

  const periodoLabel =
    filtro === "dia" ? dia :
    filtro === "mes" ? mesLabel(mes) :
    ano;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
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
            {data.totalViagens} entrega{data.totalViagens !== 1 ? "s" : ""} · {periodoLabel}
          </span>
        )}
      </div>

      {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>}
      {fetchError && <p className="text-sm text-red-500 text-center py-8">{fetchError}</p>}

      {data && !loading && (
        <>
          {data.resultado.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8 italic">Nenhuma entrega registrada no período.</p>
          ) : (
            <>
              <div className="overflow-y-auto border rounded-md" style={{ maxHeight: "340px" }}>
                <ResponsiveContainer width="100%" height={Math.max(120, data.resultado.length * 32)}>
                  <BarChart
                    data={data.resultado.map((r, i) => ({
                      nome: r.cliente,
                      entregas: r.total,
                      cor: CLIENTE_CORES[i % CLIENTE_CORES.length],
                    }))}
                    layout="vertical"
                    margin={{ top: 2, right: 40, left: 8, bottom: 2 }}
                    onClick={(s) => { if (s?.activePayload?.[0]?.payload?.nome) handleClienteClick(s.activePayload[0].payload.nome); }}
                    style={{ cursor: "pointer" }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" tick={{ fontSize: 10 }} width={180} />
                    <Tooltip formatter={(v) => [`${v} entrega${Number(v) !== 1 ? "s" : ""}`, "Total"]} />
                    <Bar dataKey="entregas" radius={[0, 4, 4, 0]}>
                      {data.resultado.map((r, i) => (
                        <Cell
                          key={i}
                          fill={CLIENTE_CORES[i % CLIENTE_CORES.length]}
                          opacity={selectedCliente && selectedCliente !== r.cliente ? 0.4 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Linha lado a lado: tabela de clientes | painel de viagens */}
              <div className="flex gap-3 min-h-0" style={{ height: "260px" }}>

                {/* Esquerda — ranking de clientes */}
                <div className="w-1/2 overflow-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold text-xs uppercase sticky top-0">
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Cliente</th>
                        <th className="px-3 py-2 text-center">Entregas</th>
                        <th className="px-3 py-2 text-left">Participação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.resultado.map((r, i) => {
                        const pct = data.totalViagens > 0 ? Math.round((r.total / data.totalViagens) * 100) : 0;
                        const cor = CLIENTE_CORES[i % CLIENTE_CORES.length];
                        return (
                          <tr
                            key={r.cliente}
                            onClick={() => handleClienteClick(r.cliente)}
                            className={`border-t border-slate-200 cursor-pointer transition-colors ${selectedCliente === r.cliente ? "bg-blue-50" : "hover:bg-slate-50"}`}
                          >
                            <td className="px-3 py-2 text-slate-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{r.cliente}</td>
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

                {/* Direita — viagens do cliente selecionado */}
                <div className="w-1/2 rounded-md overflow-hidden border border-blue-200 flex flex-col">
                  {!selectedCliente ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-6-6m0 0l6-6m-6 6h12" />
                      </svg>
                      <p className="text-xs">Clique em um cliente para ver as viagens</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border-b border-blue-200 shrink-0">
                        <span className="text-xs font-semibold uppercase tracking-wide text-blue-700 truncate pr-2">
                          {selectedCliente}
                          {clienteViagens && !loadingViagens && (
                            <span className="ml-2 font-normal text-blue-500 normal-case">
                              · {clienteViagens.length} viagem{clienteViagens.length !== 1 ? "s" : ""} em {periodoLabel}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => { setSelectedCliente(null); setClienteViagens(null); }}
                          className="text-blue-400 hover:text-blue-600 text-lg leading-none shrink-0"
                        >×</button>
                      </div>
                      {loadingViagens && (
                        <div className="flex items-center justify-center flex-1">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        </div>
                      )}
                      {!loadingViagens && clienteViagens?.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-6 italic flex-1">Nenhuma viagem encontrada.</p>
                      )}
                      {!loadingViagens && clienteViagens && clienteViagens.length > 0 && (
                        <div className="overflow-y-auto flex-1">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-blue-100">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">Data</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">Motorista</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">Frete</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-blue-700">OBS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {clienteViagens.map((v, i) => (
                                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-blue-50/40"}>
                                  <td
                                className={`px-3 py-1.5 font-medium whitespace-nowrap ${onNavigateDia ? "text-blue-600 underline cursor-pointer hover:text-blue-800" : "text-slate-700"}`}
                                onClick={() => onNavigateDia?.(v.date)}
                                title={onNavigateDia ? "Ir para este dia" : undefined}
                              >
                                {v.date.slice(8)}/{v.date.slice(5,7)}/{v.date.slice(0,4)}
                              </td>
                                  <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{v.motorista || "—"}</td>
                                  <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{v.frete || "—"}</td>
                                  <td className="px-3 py-1.5 text-slate-500">{v.obs || ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
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
        </>
      )}
    </div>
  );
}

// ─── Faturamento tab ──────────────────────────────────────────────────────────

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function parseBRL(s: string): number | null {
  const cleaned = s.replace(/[R$\s.]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function daysInMonth(mes: string): string[] {
  const [y, m] = mes.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const d = String(i + 1).padStart(2, "0");
    return `${mes}-${d}`;
  });
}

const MES_ABREV = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function fmtDia(date: string) {
  const d = date.slice(8, 10);
  const m = parseInt(date.slice(5, 7), 10) - 1;
  return `${d}/${MES_ABREV[m]}`;
}

async function apiFetchPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const API_BASE = (import.meta.env.VITE_API_URL || "https://data-fill-tool.onrender.com").replace(/\/+$/, "");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

type FatDia = { date: string; matriz: number | null; filial: number | null; aglotec: number | null; tatu: number | null; tatu_qtd: string | null };
type FatCols = "matriz" | "filial" | "aglotec";

// inputs keyed as "date|col", e.g. "2026-08-03|matriz"
function inputKey(date: string, col: FatCols) { return `${date}|${col}`; }

// ── TATU product catalog ─────────────────────────────────────────────────────
const TATU_ITEMS = [
  { code: "1046-001", unitPrice: 50.46 },
  { code: "1046-002", unitPrice: 46.16 },
  { code: "1046-003", unitPrice: 46.10 },
  { code: "1046-004", unitPrice: 127.00 },
] as const;

type TatuQtd = Record<string, number>;

function calcTatuTotal(qtd: TatuQtd): number {
  return TATU_ITEMS.reduce((s, item) => s + (qtd[item.code] ?? 0) * item.unitPrice, 0);
}

function TatuPopover({
  date, initialQtd, onSave, onClose,
}: {
  date: string;
  initialQtd: TatuQtd;
  onSave: (qtd: TatuQtd, total: number) => void;
  onClose: () => void;
}) {
  const [qtd, setQtd] = useState<TatuQtd>(initialQtd);
  const total = calcTatuTotal(qtd);

  const handleChange = (code: string, val: string) => {
    const n = parseInt(val.replace(/\D/g, ""), 10);
    setQtd((s) => ({ ...s, [code]: isNaN(n) ? 0 : n }));
  };

  const handleConfirm = () => { onSave(qtd, total); onClose(); };

  return (
    <div className="absolute z-50 right-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-xl p-3 flex flex-col gap-2"
      onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-600">TATU — {fmtDia(date)}</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-base leading-none">×</button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 uppercase">
            <th className="text-left py-1">Código</th>
            <th className="text-right py-1">Unit.</th>
            <th className="text-right py-1 w-20">Qtd</th>
            <th className="text-right py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {TATU_ITEMS.map((item) => {
            const q = qtd[item.code] ?? 0;
            return (
              <tr key={item.code} className="border-t border-slate-100">
                <td className="py-1.5 font-mono font-semibold text-slate-700">{item.code}</td>
                <td className="py-1.5 text-right text-slate-500 font-mono">
                  {item.unitPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-1.5 pl-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={q === 0 ? "" : String(q)}
                    onChange={(e) => handleChange(item.code, e.target.value)}
                    placeholder="0"
                    className="w-full text-right border border-slate-300 rounded px-1.5 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 bg-slate-50"
                  />
                </td>
                <td className="py-1.5 text-right font-mono text-slate-700">
                  {(q * item.unitPrice).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between pt-1 border-t border-slate-200">
        <span className="text-xs font-bold text-slate-600">TOTAL</span>
        <span className="text-sm font-bold font-mono text-blue-700">{BRL.format(total)}</span>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-3 py-1 text-xs rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Cancelar</button>
        <button onClick={handleConfirm} className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-semibold">Confirmar</button>
      </div>
    </div>
  );
}

function FaturamentoTab() {
  const [mes, setMes] = useState(localMes);
  const [data, setData] = useState<{ meta: number | null; dias: FatDia[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [tatuQtd, setTatuQtd] = useState<Record<string, TatuQtd>>({}); // keyed by date
  const [metaInput, setMetaInput] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [savingMeta, setSavingMeta] = useState(false);
  const [tatuPopover, setTatuPopover] = useState<string | null>(null); // date of open popover

  const allDays = daysInMonth(mes);

  const numFmt = (v: number | null) => v !== null ? v.toFixed(2).replace(".", ",") : "";

  useEffect(() => {
    setLoading(true);
    setData(null);
    apiFetch<{ meta: number | null; dias: FatDia[] }>(
      `/api/faturamento?mes=${mes}`
    ).then((d) => {
      setData(d);
      const map: Record<string, string> = {};
      const qtdMap: Record<string, TatuQtd> = {};
      for (const dia of d.dias) {
        map[inputKey(dia.date, "matriz")]  = numFmt(dia.matriz);
        map[inputKey(dia.date, "filial")]  = numFmt(dia.filial);
        map[inputKey(dia.date, "aglotec")] = numFmt(dia.aglotec);
        if (dia.tatu_qtd) {
          try { qtdMap[dia.date] = JSON.parse(dia.tatu_qtd); } catch { /* ignore */ }
        }
      }
      setInputs(map);
      setTatuQtd(qtdMap);
      setMetaInput(d.meta !== null ? d.meta.toFixed(2).replace(".", ",") : "");
    }).catch(() => {}).finally(() => setLoading(false));
  }, [mes]);

  const prevMes = () => {
    const [a, m] = mes.split("-").map(Number);
    setMes(`${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`);
  };
  const nextMes = () => {
    const [a, m] = mes.split("-").map(Number);
    setMes(`${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`);
  };

  const getNum = (date: string, col: FatCols): number | null => {
    const raw = (inputs[inputKey(date, col)] ?? "").trim();
    return raw === "" ? null : parseBRL(raw);
  };

  const saveDia = async (date: string, overrides: Partial<{ matriz: number | null; filial: number | null; aglotec: number | null; tatu: number | null; tatu_qtd: string | null }> = {}) => {
    const prev = data?.dias.find((d) => d.date === date);
    const payload = {
      date,
      matriz:   "matriz"   in overrides ? overrides.matriz   : getNum(date, "matriz"),
      filial:   "filial"   in overrides ? overrides.filial   : getNum(date, "filial"),
      aglotec:  "aglotec"  in overrides ? overrides.aglotec  : getNum(date, "aglotec"),
      tatu:     "tatu"     in overrides ? overrides.tatu     : (prev?.tatu ?? null),
      tatu_qtd: "tatu_qtd" in overrides ? overrides.tatu_qtd : (prev?.tatu_qtd ?? null),
    };
    await apiFetchPut("/api/faturamento/dia", payload);
    setData((prev2) => {
      if (!prev2) return prev2;
      const dias = prev2.dias.filter((d) => d.date !== date);
      const updated: FatDia = {
        date,
        matriz:   payload.matriz   ?? null,
        filial:   payload.filial   ?? null,
        aglotec:  payload.aglotec  ?? null,
        tatu:     payload.tatu     ?? null,
        tatu_qtd: payload.tatu_qtd ?? null,
      };
      if (Object.values(updated).some((v, i) => i > 0 && v !== null)) dias.push(updated);
      return { ...prev2, dias: dias.sort((a, b) => a.date.localeCompare(b.date)) };
    });
  };

  const handleCellBlur = async (date: string, col: FatCols) => {
    const raw = (inputs[inputKey(date, col)] ?? "").trim();
    const num = raw === "" ? null : parseBRL(raw);
    if (raw !== "" && num === null) {
      const prev = data?.dias.find((d) => d.date === date);
      setInputs((s) => ({ ...s, [inputKey(date, col)]: numFmt(prev?.[col] ?? null) }));
      return;
    }
    const key = inputKey(date, col);
    setSaving((s) => { const n = new Set(s); n.add(key); return n; });
    try { await saveDia(date, { [col]: num }); }
    finally { setSaving((s) => { const n = new Set(s); n.delete(key); return n; }); }
  };

  const handleTatuSave = async (date: string, qtd: TatuQtd, total: number) => {
    setTatuQtd((s) => ({ ...s, [date]: qtd }));
    const saveKey = `${date}|tatu`;
    setSaving((s) => { const n = new Set(s); n.add(saveKey); return n; });
    try {
      await saveDia(date, {
        tatu:     total > 0 ? total : null,
        tatu_qtd: total > 0 ? JSON.stringify(qtd) : null,
      });
    } finally { setSaving((s) => { const n = new Set(s); n.delete(saveKey); return n; }); }
  };

  const handleMetaBlur = async () => {
    const raw = metaInput.trim();
    const num = raw === "" ? null : parseBRL(raw);
    if (raw !== "" && num === null) {
      setMetaInput(data?.meta !== null && data?.meta !== undefined ? data.meta.toFixed(2).replace(".", ",") : "");
      return;
    }
    setSavingMeta(true);
    try {
      await apiFetchPut("/api/faturamento/meta", { mes, meta: num });
      setData((prev) => prev ? { ...prev, meta: num } : prev);
    } finally { setSavingMeta(false); }
  };

  // ── Summary calculations ─────────────────────────────────────────────────
  const dailyTotals = allDays.map((date) => {
    const m = getNum(date, "matriz")  ?? 0;
    const f = getNum(date, "filial")  ?? 0;
    const a = getNum(date, "aglotec") ?? 0;
    const t = calcTatuTotal(tatuQtd[date] ?? {});
    return { date, total: m + f + a + t, matriz: m, filial: f, aglotec: a, tatu: t };
  });

  const totalMatriz  = dailyTotals.reduce((s, d) => s + d.matriz,  0);
  const totalFilial  = dailyTotals.reduce((s, d) => s + d.filial,  0);
  const totalAglotec = dailyTotals.reduce((s, d) => s + d.aglotec, 0);
  const totalTatu    = dailyTotals.reduce((s, d) => s + d.tatu,    0);
  const totalFaturado = totalMatriz + totalFilial + totalAglotec + totalTatu;

  const diasComValor = dailyTotals.filter((d) => d.total > 0);
  const meta = data?.meta ?? null;
  const falta = meta !== null ? Math.max(0, meta - totalFaturado) : null;
  const pctAtingido = meta && meta > 0 ? Math.min(100, (totalFaturado / meta) * 100) : null;
  const pctFalta = meta && meta > 0 ? Math.max(0, ((meta - totalFaturado) / meta) * 100) : null;
  const atingiu = meta !== null && totalFaturado >= meta;

  const maxDia = diasComValor.length > 0 ? diasComValor.reduce((a, b) => a.total > b.total ? a : b) : null;
  const minDia = diasComValor.length > 0 ? diasComValor.reduce((a, b) => a.total < b.total ? a : b) : null;

  const inputCls = "w-full text-right text-xs px-1.5 py-0.5 rounded border border-transparent bg-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 font-mono";

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0" onClick={() => setTatuPopover(null)}>
      {/* Header: month nav + meta input */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={prevMes} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">‹</button>
          <span className="text-sm font-semibold text-slate-700 w-28 text-center">{mesLabel(mes)}</span>
          <button onClick={nextMes} className="px-2 py-1 rounded border border-slate-300 text-sm hover:bg-slate-100">›</button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Meta do mês:</span>
          <div className="relative">
            <input
              type="text"
              value={metaInput}
              onChange={(e) => setMetaInput(e.target.value)}
              onBlur={handleMetaBlur}
              placeholder="R$ 0,00"
              className="border border-slate-300 rounded px-2 py-1 text-sm w-36 text-right font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            {savingMeta && <Loader2 className="w-3 h-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />}
          </div>
        </div>
      </div>

      {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>}

      {!loading && (
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left — day table */}
          <div className="flex flex-col" style={{ width: "58%" }}>
            <div className="overflow-y-auto border rounded-t-md flex-1" style={{ maxHeight: 460 }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase w-14">Dia</th>
                    <th className="px-2 py-2 text-right font-semibold text-slate-600 uppercase">Matriz</th>
                    <th className="px-2 py-2 text-right font-semibold text-slate-600 uppercase">Filial</th>
                    <th className="px-2 py-2 text-right font-semibold text-slate-600 uppercase">Aglotec</th>
                    <th className="px-2 py-2 text-right font-semibold text-amber-700 uppercase bg-amber-50">Tatu</th>
                    <th className="px-2 py-2 text-right font-semibold text-slate-700 uppercase bg-slate-200">Total Diário</th>
                  </tr>
                </thead>
                <tbody>
                  {allDays.map((date, i) => {
                    const dayData = dailyTotals.find(d => d.date === date)!;
                    const isMax = maxDia?.date === date;
                    const isMin = minDia?.date === date && diasComValor.length > 1;
                    const tatuVal = dayData.tatu;
                    const isSavingTatu = saving.has(`${date}|tatu`);
                    return (
                      <tr key={date} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                        <td className="px-2 py-1 text-slate-600 whitespace-nowrap font-mono font-semibold">
                          {fmtDia(date)}
                          {isMax && <span className="ml-0.5 text-emerald-600 font-bold" title="Maior dia">↑</span>}
                          {isMin && <span className="ml-0.5 text-red-400 font-bold" title="Menor dia">↓</span>}
                        </td>
                        {(["matriz", "filial", "aglotec"] as FatCols[]).map((col) => {
                          const key = inputKey(date, col);
                          const isSaving = saving.has(key);
                          return (
                            <td key={col} className="px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                              <div className="relative">
                                <input
                                  type="text"
                                  value={inputs[key] ?? ""}
                                  onChange={(e) => setInputs((s) => ({ ...s, [key]: e.target.value }))}
                                  onBlur={() => handleCellBlur(date, col)}
                                  placeholder="—"
                                  className={inputCls}
                                />
                                {isSaving && <Loader2 className="w-2.5 h-2.5 animate-spin absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
                              </div>
                            </td>
                          );
                        })}
                        {/* TATU cell */}
                        <td className="px-1 py-0.5 bg-amber-50/60" onClick={(e) => e.stopPropagation()}>
                          <div className="relative">
                            <button
                              onClick={() => setTatuPopover((p) => p === date ? null : date)}
                              className={`w-full text-right text-xs px-1.5 py-0.5 rounded font-mono border transition-colors ${
                                tatuVal > 0
                                  ? "text-amber-700 font-semibold border-amber-200 bg-amber-50 hover:border-amber-400"
                                  : "text-slate-400 border-transparent hover:border-amber-300 hover:bg-amber-50"
                              }`}
                            >
                              {isSavingTatu
                                ? <Loader2 className="w-3 h-3 animate-spin inline" />
                                : tatuVal > 0
                                  ? tatuVal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                  : "—"}
                            </button>
                            {tatuPopover === date && (
                              <TatuPopover
                                date={date}
                                initialQtd={tatuQtd[date] ?? {}}
                                onSave={(qtd, total) => handleTatuSave(date, qtd, total)}
                                onClose={() => setTatuPopover(null)}
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1 text-right font-mono font-bold text-slate-700 bg-slate-50 whitespace-nowrap">
                          {dayData.total > 0 ? dayData.total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals footer */}
            <div className="border border-t-0 rounded-b-md overflow-hidden text-sm font-bold">
              <div className="grid bg-blue-600 text-white" style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr 1fr" }}>
                <span className="px-2 py-2">FATURAMENTO</span>
                <span className="px-2 py-2 text-right font-mono">{totalMatriz  > 0 ? BRL.format(totalMatriz)  : "—"}</span>
                <span className="px-2 py-2 text-right font-mono">{totalFilial  > 0 ? BRL.format(totalFilial)  : "—"}</span>
                <span className="px-2 py-2 text-right font-mono">{totalAglotec > 0 ? BRL.format(totalAglotec) : "—"}</span>
                <span className="px-2 py-2 text-right font-mono">{totalTatu    > 0 ? BRL.format(totalTatu)    : "—"}</span>
                <span className="px-2 py-2 text-right font-mono">{BRL.format(totalFaturado)}</span>
              </div>
              <div className="grid bg-emerald-500 text-white" style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr 1fr" }}>
                <span className="px-2 py-2">META</span>
                <span className="col-span-4 px-2 py-2 text-right font-mono">{meta !== null ? BRL.format(meta) : "—"}</span>
                <span className="px-2 py-2 text-right font-mono">{meta !== null ? BRL.format(meta) : "—"}</span>
              </div>
              <div className={`grid ${atingiu ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`} style={{ gridTemplateColumns: "auto 1fr 1fr 1fr 1fr 1fr" }}>
                <span className="px-2 py-2">{atingiu ? "SUPERADO" : "FALTA"}</span>
                <span className="col-span-4 px-2 py-2" />
                <span className="px-2 py-2 text-right font-mono">{falta !== null ? BRL.format(falta) : "—"}</span>
              </div>
            </div>
          </div>

          {/* Right — summary cards */}
          <div className="flex flex-col gap-3" style={{ width: 240 }}>
            {/* Progress bar */}
            <div className="border rounded-md p-3 bg-white flex flex-col gap-2">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-semibold text-slate-700">Progresso da meta</span>
                <span className={`text-base font-bold ${atingiu ? "text-emerald-600" : "text-blue-600"}`}>
                  {pctAtingido !== null ? `${pctAtingido.toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                <div
                  className={`h-4 rounded-full transition-all ${atingiu ? "bg-emerald-500" : "bg-blue-500"}`}
                  style={{ width: `${Math.min(100, pctAtingido ?? 0)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>R$ 0</span>
                <span>{meta !== null ? BRL.format(meta) : "Meta não definida"}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-2">
              <div className="border rounded-md p-2.5 bg-blue-50">
                <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide">Faturado</p>
                <p className="text-base font-bold text-blue-700 font-mono mt-0.5">{BRL.format(totalFaturado)}</p>
                {pctAtingido !== null && <p className="text-xs text-blue-400">{pctAtingido.toFixed(1)}% da meta</p>}
              </div>
              <div className={`border rounded-md p-2.5 ${atingiu ? "bg-emerald-50" : "bg-red-50"}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${atingiu ? "text-emerald-500" : "text-red-400"}`}>
                  {atingiu ? "Meta superada!" : "Falta para meta"}
                </p>
                <p className={`text-base font-bold font-mono mt-0.5 ${atingiu ? "text-emerald-700" : "text-red-600"}`}>
                  {falta !== null ? BRL.format(falta) : "—"}
                </p>
                {pctFalta !== null && !atingiu && <p className="text-xs text-red-400">{pctFalta.toFixed(1)}% restante</p>}
              </div>
              <div className="border rounded-md p-2.5 bg-emerald-50">
                <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wide">↑ Maior dia</p>
                {maxDia ? (
                  <>
                    <p className="text-base font-bold text-emerald-700 font-mono mt-0.5">{BRL.format(maxDia.total)}</p>
                    <p className="text-xs text-emerald-500">{fmtDia(maxDia.date)}</p>
                  </>
                ) : <p className="text-sm text-slate-400 mt-1">—</p>}
              </div>
              <div className="border rounded-md p-2.5 bg-red-50">
                <p className="text-xs text-red-400 font-semibold uppercase tracking-wide">↓ Menor dia</p>
                {minDia ? (
                  <>
                    <p className="text-base font-bold text-red-600 font-mono mt-0.5">{BRL.format(minDia.total)}</p>
                    <p className="text-xs text-red-400">{fmtDia(minDia.date)}</p>
                  </>
                ) : <p className="text-sm text-slate-400 mt-1">—</p>}
              </div>
            </div>

            <div className="border rounded-md p-2.5 bg-white text-xs text-slate-600">
              <span className="font-semibold text-slate-700">{diasComValor.length}</span> dia{diasComValor.length !== 1 ? "s" : ""} lançado{diasComValor.length !== 1 ? "s" : ""} de {allDays.length} em {mesLabel(mes)}
              {diasComValor.length > 0 && totalFaturado > 0 && (
                <div className="text-slate-400 mt-0.5">média {BRL.format(totalFaturado / diasComValor.length)}/dia</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

type Tab = "resumo" | "divergencias" | "frete" | "motoristas" | "clientes" | "faturamento";

export function RelatorioModal({ onNavigateDate }: { onNavigateDate?: (dateStr: string) => void } = {}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("resumo");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-10 w-10 text-slate-700 border-slate-300 hover:bg-slate-100" title="Relatórios">
          <FileText className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] flex flex-col">
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
            { key: "clientes",     label: "Clientes",           icon: <LayoutList className="w-3.5 h-3.5" /> },
            { key: "faturamento",  label: "Faturamento",        icon: <BarChart2 className="w-3.5 h-3.5" /> },
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

        <div className="flex-1 overflow-y-auto pt-1 min-h-0">
          {open && tab === "resumo"       && <ResumoMensalTab />}
          {open && tab === "divergencias" && <DivergenciasTab />}
          {open && tab === "frete"        && <FreteMensalTab onNavigateDia={(d) => { setOpen(false); onNavigateDate?.(d); }} />}
          {open && tab === "motoristas"   && <MotoristaTab onNavigateDia={(d) => { setOpen(false); onNavigateDate?.(d); }} />}
          {open && tab === "clientes"     && <ClienteTab onNavigateDia={(d) => { setOpen(false); onNavigateDate?.(d); }} />}
          {open && tab === "faturamento"  && <FaturamentoTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
