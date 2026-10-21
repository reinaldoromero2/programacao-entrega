import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Loader2, Trash2, GripVertical, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CampoPopup, semAcento, type OpcaoPopup } from "@/components/campo-popup";
import { getCurrentSegment, isInsideParens, replaceLastSegment, validateValue } from "@/components/cliente-autocomplete";
import { useClientesCadastro } from "@/components/clientes-cadastro-modal";
import { abrirGradeComCliente } from "@/components/romaneio-frame";
import {
  Entrega,
  EntregaUnidade,
  useUpdateEntrega,
  useCreateEntrega,
  useDeleteEntrega,
  useReorderEntregas,
  useListMotoristas,
  getListEntregasQueryKey
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getOfflineSnapshot } from "@/lib/offline-snapshot";

// ----------------------------------------------------------------------
// Motivos de cancelamento hook
// ----------------------------------------------------------------------
const MOTIVOS_API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");

interface MotivoItem { id: number; motivo: string; }

function useMotivosCancelamento() {
  return useQuery({
    queryKey: ["motivos-cancelamento"],
    initialData: () => getOfflineSnapshot()?.motivos ?? [],
    queryFn: async (): Promise<MotivoItem[]> => {
      try {
        const res = await fetch(`${MOTIVOS_API_BASE}/api/motivos-cancelamento`);
        if (!res.ok) return getOfflineSnapshot()?.motivos ?? [];
        return res.json();
      } catch {
        return getOfflineSnapshot()?.motivos ?? [];
      }
    },
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
  });
}

// ----------------------------------------------------------------------
// Column definitions & resize context
// ----------------------------------------------------------------------

const STORAGE_KEY = "delivery-table-col-widths";

const DEFAULT_WIDTHS = [40, 40, 200, 80, 150, 220, 120, 50, 140, 100, 50, 160, 80];
const MIN_WIDTHS    = [30, 30,  80, 50,  60, 120,  80, 36,  80,  60, 36,  80, 36];
const COL_LABELS = ["S", "#", "CLIENTE", "HRS", "OBS", "MOTORISTA • PLACA", "FRETE", "V", "UNIDADE", "NF", "CG", "DIVERGÊNCIAS", ""];

const FRETE_OPTIONS = ["RIPACK", "TRANSPORTADORA", "3º", "COLETA"] as const;
type FreteOption = typeof FRETE_OPTIONS[number];


function loadWidths(): number[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as number[];
      if (Array.isArray(parsed) && parsed.length === DEFAULT_WIDTHS.length) return parsed;
    }
  } catch {}
  return DEFAULT_WIDTHS;
}

const ColWidthsContext = createContext<number[]>(DEFAULT_WIDTHS);

function useColWidths() {
  return useContext(ColWidthsContext);
}

function gridTemplate(widths: number[]) {
  return widths.map(w => `${w}px`).join(" ");
}

// ----------------------------------------------------------------------
// Main table
// ----------------------------------------------------------------------

interface DeliveryTableProps {
  entregas: Entrega[];
  date: string;
  backgroundImageEnabled: boolean;
  rowThemeColor: string | null;
  acrylicEnabled: boolean;
  selectedIds: Set<number>;
  selectionMode: boolean;
  onToggleSelection: (id: number) => void;
}

export function DeliveryTable({ entregas, date, backgroundImageEnabled, rowThemeColor, acrylicEnabled, selectedIds, selectionMode, onToggleSelection }: DeliveryTableProps) {
  const queryClient = useQueryClient();
  const reorderEntregas = useReorderEntregas();
  const updateEntregaTabela = useUpdateEntrega();
  const deleteEntregaTabela = useDeleteEntrega();
  // "Conjugar carga": linha marcada que, solta em cima de outra, vira "cliente + cliente" numa linha só
  const [conjugarId, setConjugarId] = useState<number | null>(null);
  // a linha guarda o que foi digitado só ao montar: depois de conjugar, remonta a linha do alvo pra mostrar o cliente novo
  const [versaoLinha, setVersaoLinha] = useState<Record<number, number>>({});

  // "S" do cabeçalho: volta todos os quadradinhos S do dia para branco (grava em cada entrega marcada)
  const limparColunaS = () => {
    const marcadas = entregas.filter((e) => e.checked && e.checked !== "none");
    if (!marcadas.length) return;
    const queryKey = getListEntregasQueryKey({ date });
    const ids = new Set(marcadas.map((e) => e.id));
    // as linhas acompanham a lista: ficam brancas na hora, sem esperar o servidor
    queryClient.setQueryData<Entrega[]>(queryKey, (old) => old?.map((e) => (ids.has(e.id) ? { ...e, checked: "none" } : e)) ?? []);
    let pendentes = marcadas.length;
    marcadas.forEach((e) => {
      updateEntregaTabela.mutate({ id: e.id, data: { checked: "none" } }, {
        onSettled: () => { if (--pendentes === 0) queryClient.invalidateQueries({ queryKey }); },
      });
    });
  };
  useEffect(() => {
    if (conjugarId === null) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setConjugarId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conjugarId]);

  const [colWidths, setColWidths] = useState<number[]>(loadWidths);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Persist to localStorage whenever widths change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colWidths));
  }, [colWidths]);

  // Resize logic
  const resizingCol = useRef<number | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizeMouseDown = useCallback((colIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizingCol.current = colIndex;
    startX.current = e.clientX;
    startWidth.current = colWidths[colIndex];

    const onMouseMove = (ev: MouseEvent) => {
      if (resizingCol.current === null) return;
      const delta = ev.clientX - startX.current;
      const newWidth = Math.max(MIN_WIDTHS[resizingCol.current], startWidth.current + delta);
      setColWidths(prev => {
        const next = [...prev];
        next[resizingCol.current!] = newWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      resizingCol.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [colWidths]);

  // Sort entregas
  const sortedEntregas = [...entregas].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id - b.id;
  });

  const handleDragStart = (id: number) => setDraggedId(id);
  const handleDragEnter = (id: number) => { if (id !== draggedId) setDragOverId(id); };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  // junta a linha `origemId` na linha `alvoId`: cliente, OBS e HRS somados com " + "; motorista e placa
  // ficam os do alvo (ou os da origem, se o alvo não tiver); a linha de origem é apagada
  const conjugar = (origemId: number, alvoId: number) => {
    const origem = sortedEntregas.find(e => e.id === origemId);
    const alvo = sortedEntregas.find(e => e.id === alvoId);
    if (!origem || !alvo) return;
    const juntar = (a: string | null | undefined, b: string | null | undefined) => {
      const x = (a ?? "").trim(), y = (b ?? "").trim();
      return x && y ? `${x} + ${y}` : (x || y);
    };
    const data = {
      cliente: juntar(alvo.cliente, origem.cliente),
      obs: juntar(alvo.obs, origem.obs) || null,
      hrs: juntar(alvo.hrs, origem.hrs) || null,
      motorista: (alvo.motorista ?? "").trim() || origem.motorista || null,
      placa: (alvo.placa ?? "").trim() || origem.placa || null,
    };
    if (!window.confirm(`Conjugar a carga?\n\n${origem.cliente || "(sem cliente)"}  →  ${alvo.cliente || "(sem cliente)"}\n\nFica uma linha só: ${data.cliente}`)) return;
    const queryKey = getListEntregasQueryKey({ date });
    const previous = queryClient.getQueryData<Entrega[]>(queryKey);
    queryClient.setQueryData<Entrega[]>(queryKey, (old) =>
      old?.filter(e => e.id !== origemId).map(e => (e.id === alvoId ? { ...e, ...data } : e)) ?? []
    );
    setVersaoLinha((v) => ({ ...v, [alvoId]: (v[alvoId] ?? 0) + 1 }));
    updateEntregaTabela.mutate({ id: alvoId, data }, {
      onSuccess: () => {
        deleteEntregaTabela.mutate({ id: origemId }, {
          onSettled: () => queryClient.invalidateQueries({ queryKey }),
        });
      },
      onError: () => {
        queryClient.setQueryData(queryKey, previous);
        window.alert("Não foi possível conjugar agora. Tente de novo.");
      },
    });
  };

  const handleDrop = (targetId: number) => {
    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    // linha marcada em "Conjugar carga": em vez de mudar a ordem, junta com a linha onde foi solta
    if (conjugarId !== null && draggedId === conjugarId){
      const origem = draggedId;
      setDraggedId(null);
      setDragOverId(null);
      setConjugarId(null);
      conjugar(origem, targetId);
      return;
    }
    const fromIndex = sortedEntregas.findIndex(e => e.id === draggedId);
    const toIndex   = sortedEntregas.findIndex(e => e.id === targetId);
    const newOrder  = [...sortedEntregas];
    const [moved]   = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);

    const queryKey = getListEntregasQueryKey({ date });
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old: Entrega[] | undefined) =>
      old?.map(e => {
        const idx = newOrder.findIndex(n => n.id === e.id);
        return idx !== -1 ? { ...e, sortOrder: idx } : e;
      })
    );

    reorderEntregas.mutate(
      { data: { ids: newOrder.map(e => e.id) } },
      {
        onError: () => queryClient.setQueryData(queryKey, previous),
        onSuccess: () => queryClient.invalidateQueries({ queryKey }),
      }
    );
    setDraggedId(null);
    setDragOverId(null);
  };

  const template = gridTemplate(colWidths);

  return (
    <ColWidthsContext.Provider value={colWidths}>
      <div className="w-full flex flex-col text-sm overflow-x-auto">
        {/* Table Header */}
        <div
          className={cn(
            "app-acrylic-surface flex border-b-2 border-slate-300 font-bold text-slate-700 text-xs text-center sticky top-0 z-10 select-none",
            acrylicEnabled || backgroundImageEnabled ? "bg-slate-100/50 backdrop-blur-md" : "bg-slate-100"
          )}
          style={{ display: "grid", gridTemplateColumns: template }}
        >
          {COL_LABELS.map((label, i) => (
            <div
              key={i}
              className={cn(
                "relative flex items-center justify-center p-3",
                i < COL_LABELS.length - 1 && "border-r border-slate-200",
                i === 2 || i === 4 || i === 5 ? "justify-start" : "justify-center"
              )}
            >
              {i === 0 ? (
                <button
                  type="button"
                  onClick={limparColunaS}
                  className="truncate cursor-pointer hover:text-blue-600 print:pointer-events-none"
                  title="Limpar a coluna S (todas as linhas voltam para branco)"
                  data-testid="button-limpar-coluna-s"
                >
                  {label}
                </button>
              ) : (
                <span className="truncate">{label}</span>
              )}

              {/* Resize handle — not on last column */}
              {i < COL_LABELS.length - 1 && (
                <div
                  onMouseDown={handleResizeMouseDown(i)}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize z-20 flex items-center justify-center group/handle"
                  title="Arrastar para redimensionar"
                >
                  <div className="w-0.5 h-4 bg-slate-300 rounded group-hover/handle:bg-blue-500 group-hover/handle:h-full transition-all" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Table Body */}
        <div className="flex flex-col">
          {sortedEntregas.map((entrega, index) => (
            <DeliveryRow
              key={`${entrega.id}-${versaoLinha[entrega.id] ?? 0}`}
              entrega={entrega}
              date={date}
              rowIndex={index + 1}
              onDragStart={() => handleDragStart(entrega.id)}
              onDragEnter={() => handleDragEnter(entrega.id)}
              onDrop={() => handleDrop(entrega.id)}
              onDragEnd={handleDragEnd}
              isDragging={draggedId === entrega.id}
              isDragOver={dragOverId === entrega.id}
              isSelected={selectedIds.has(entrega.id)}
              backgroundImageEnabled={backgroundImageEnabled}
              rowThemeColor={rowThemeColor}
              acrylicEnabled={acrylicEnabled}
              selectionMode={selectionMode}
              onToggleSelection={() => onToggleSelection(entrega.id)}
              conjugando={conjugarId === entrega.id}
              conjugarAtivo={conjugarId !== null}
              onConjugar={() => setConjugarId((atual) => (atual === entrega.id ? null : entrega.id))}
            />
          ))}

          {Array.from({ length: Math.max(5, 10 - sortedEntregas.length) }).map((_, i) => (
            <NewDeliveryRow
              key={`new-${i}`}
              date={date}
              index={sortedEntregas.length + i}
              backgroundImageEnabled={backgroundImageEnabled}
              acrylicEnabled={acrylicEnabled}
            />
          ))}
        </div>
      </div>
    </ColWidthsContext.Provider>
  );
}

// ----------------------------------------------------------------------
// Editable Row
// ----------------------------------------------------------------------

interface DeliveryRowProps {
  entrega: Entrega;
  date: string;
  rowIndex: number;
  onDragStart: () => void;
  conjugando?: boolean;
  conjugarAtivo?: boolean;
  onConjugar?: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragOver: boolean;
  isSelected: boolean;
  backgroundImageEnabled: boolean;
  rowThemeColor: string | null;
  acrylicEnabled: boolean;
  selectionMode: boolean;
  onToggleSelection: () => void;
}

// hora digitada no pop-up da HRS: "7" -> "07:00", "730"/"0730"/"7:30"/"7h30" -> "07:30", "14" -> "14:00";
// várias horas separadas por "+" (carga conjugada) são tratadas uma a uma; o que não for hora fica como digitado
function normalizarHora(texto: string): string {
  return texto.split("+").map((parte) => {
    const t = parte.trim();
    if (!t) return "";
    const m = t.match(/^(\d{1,2})(?:\s*[:hH.,]\s*(\d{1,2})?)?\s*[hH]?$/) || t.match(/^(\d{1,2})(\d{2})$/);
    if (!m) return t.toUpperCase();
    const h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 23 || min > 59) return t.toUpperCase();
    return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
  }).filter(Boolean).join(" + ");
}

const UNIDADE_OPTIONS = ["MATRIZ", "FILIAL", "MATRIZ + FILIAL"] as const;

// cliente: as sugestões olham só o último cliente digitado (depois do último "+"), fora dos parênteses
function useOpcoesClientes() {
  const { data: clientes = [] } = useClientesCadastro();
  const opcoes = React.useMemo(() => clientes.map((c) => ({ chave: String(c.id), rotulo: c.nome })), [clientes]);
  const nomes = React.useMemo(() => new Set(clientes.map((c) => c.nome.toUpperCase())), [clientes]);
  return { opcoes, nomes, podeConferir: clientes.length > 0 };
}
const segmentoCliente = (texto: string) => {
  const seg = getCurrentSegment(texto);
  return isInsideParens(seg) ? "" : seg.replace(/\([^)]*\)/g, "").trim();
};
const filtrarCliente = (texto: string, op: OpcaoPopup) => {
  const seg = segmentoCliente(texto);
  return !seg || semAcento(op.rotulo).includes(semAcento(seg));
};

type CampoLinha = "cliente" | "hrs" | "motorista" | "frete" | "unidade";
function LinhaResumo({ numero, estado, editando }: { numero: number; estado: ReturnType<typeof estadoDaEntrega>; editando: CampoLinha }) {
  const cel = (campo: CampoLinha | null, conteudo: React.ReactNode, extra?: string) => (
    <div className={cn("px-2 py-1.5 border-r border-slate-200 last:border-r-0 truncate", extra, campo === editando && "bg-blue-100 ring-2 ring-inset ring-blue-500 font-bold")}>
      {conteudo}
    </div>
  );
  const caixa = (v: string, cor: string) => <span className={cn("inline-block w-4 h-4 rounded border align-middle", v === "check" || v === "filled" || v === "confirmed" ? cor : "bg-white border-slate-300")} />;
  return (
    <div className="hidden sm:grid rounded-md border border-slate-300 bg-white text-sm text-slate-800 overflow-hidden items-center"
      style={{ gridTemplateColumns: "32px 32px minmax(120px,2.2fr) 70px minmax(150px,2fr) 110px 40px 130px 36px 36px" }}
      data-testid="popup-linha">
      {cel(null, caixa(estado.checked, estado.checked === "confirmed" ? "bg-green-700 border-green-700" : "bg-slate-800 border-slate-800"), "text-center")}
      {cel(null, <span className="text-xs font-bold text-slate-400">{numero}</span>, "text-center")}
      {cel("cliente", estado.cliente || <span className="text-slate-400 italic">sem cliente</span>)}
      {cel("hrs", estado.hrs, cn("text-center font-bold", estado.hrs && "bg-yellow-200"))}
      {cel("motorista", <>{estado.motorista || <span className="text-slate-400">Motorista</span>} <span className="text-slate-400">•</span> <span className="font-mono text-slate-600">{estado.placa}</span></>)}
      {cel("frete", estado.frete || "—", "text-xs font-semibold")}
      {cel(null, estado.v === "2A" ? <span className="text-xs font-semibold text-blue-800">2ª</span> : "", "text-center")}
      {cel("unidade", estado.unidade, "text-xs font-semibold")}
      {cel(null, caixa(estado.nf, "bg-green-700 border-green-700"), "text-center")}
      {cel(null, caixa(estado.cg, "bg-green-700 border-green-700"), "text-center")}
    </div>
  );
}

function estadoDaEntrega(entrega: Entrega) {
  return {
    checked: entrega.checked,
    cliente: entrega.cliente ?? "",
    hrs: entrega.hrs || "",
    obs: entrega.obs || "",
    motorista: entrega.motorista || "",
    placa: entrega.placa || "",
    unidade: entrega.unidade,
    nf: entrega.nf,
    cg: entrega.cg,
    divergencias: entrega.divergencias || "",
    v: entrega.v ?? null,
    frete: (entrega.frete ?? null) as FreteOption | null,
  };
}

function DeliveryRow({ entrega, date, rowIndex, onDragStart, onDragEnter, onDrop, onDragEnd, isDragging, isDragOver, isSelected, backgroundImageEnabled, rowThemeColor, acrylicEnabled, selectionMode, onToggleSelection, conjugando, conjugarAtivo, onConjugar }: DeliveryRowProps) {
  const colWidths = useColWidths();
  const queryClient = useQueryClient();
  const updateEntrega = useUpdateEntrega();
  const deleteEntrega = useDeleteEntrega();

  const [isSaving, setIsSaving] = useState(false);
  const [editingDivergencias, setEditingDivergencias] = useState(false);
  // pop-ups de cliente, motorista • placa, frete e unidade (um aberto por vez)
  const [popupAberto, setPopupAberto] = useState<null | "cliente" | "motorista" | "frete" | "unidade">(null);
  const { opcoes: opcoesClientes, nomes: nomesClientes, podeConferir: podeConferirCliente } = useOpcoesClientes();
  const { data: motoristas = [] } = useListMotoristas();
  const opcoesMotoristas = React.useMemo(() => motoristas.map((m) => ({ chave: String(m.id), rotulo: m.nome, detalhe: m.placa })), [motoristas]);
  const [motoristaDigitado, setMotoristaDigitado] = useState("");
  const [placaLivre, setPlacaLivre] = useState("");
  const fecharPopup = () => setPopupAberto(null);
  const salvarCliente = (valor: string) => {
    setLocalState(prev => ({ ...prev, cliente: valor }));
    saveField("cliente", valor);
    fecharPopup();
  };
  const salvarMotorista = (nome: string, placa: string, frete?: string | null) => {
    setLocalState(prev => ({ ...prev, motorista: nome, placa, ...(frete !== undefined ? { frete: frete as FreteOption | null } : {}) }));
    saveField("motorista", nome);
    saveField("placa", placa);
    if (frete !== undefined) saveField("frete", frete);
    fecharPopup();
  };
  // pop-up da hora: o que está sendo digitado (null = fechado)
  const [horaDigitada, setHoraDigitada] = useState<string | null>(null);
  const salvarHora = (texto: string) => {
    const valor = normalizarHora(texto);
    setLocalState(prev => ({ ...prev, hrs: valor }));
    saveField("hrs", valor);
    setHoraDigitada(null);
  };
  const divergenciasEditingRef = useRef(false);
  const { data: motivos } = useMotivosCancelamento();
  const [localState, setLocalState] = useState(() => estadoDaEntrega(entrega));

  const lastSavedRef = useRef(localState);
  const initRef = useRef<number | null>(null);

  const syncAgendaCache = useCallback((field: keyof typeof localState, value: unknown) => {
    const normalizedValue = value === "" ? null : value;
    queryClient.setQueriesData({ queryKey: ["clientes-agendamento-mensal"] }, (oldData: unknown) => {
      if (!Array.isArray(oldData)) return oldData;

      return oldData.map((item) => {
        if (!item || typeof item !== "object" || !("id" in item) || (item as { id: number }).id !== entrega.id) return item;

        const nextItem = { ...item } as Record<string, unknown>;
        if (field === "checked") nextItem.checked = normalizedValue as Entrega["checked"];
        if (field === "obs") nextItem.obs = normalizedValue as string | null;
        if (field === "cliente") nextItem.cliente = String(normalizedValue ?? "");
        if (field === "hrs") nextItem.hrs = normalizedValue as string | null;
        return nextItem;
      });
    });
  }, [entrega.id, queryClient]);

  // o que veio da lista na última vez: quando um campo muda lá (S limpo pelo cabeçalho, carga
  // conjugada, outro PC), a linha mostra o valor novo; o que está sendo digitado e não mudou na lista fica
  const ultimaDaListaRef = useRef(estadoDaEntrega(entrega));
  useEffect(() => {
    const novo = estadoDaEntrega(entrega);
    if (initRef.current !== entrega.id) {
      initRef.current = entrega.id;
      ultimaDaListaRef.current = novo;
      setLocalState(novo);
      lastSavedRef.current = novo;
      return;
    }
    const antes = ultimaDaListaRef.current;
    ultimaDaListaRef.current = novo;
    const mudou = (Object.keys(novo) as (keyof typeof novo)[]).filter((k) => novo[k] !== antes[k]);
    if (!mudou.length) return;
    const parte = Object.fromEntries(mudou.map((k) => [k, novo[k]])) as Partial<typeof novo>;
    setLocalState((atual) => ({ ...atual, ...parte }));
    lastSavedRef.current = { ...lastSavedRef.current, ...parte };
  }, [entrega.id, entrega]);

  const saveField = useCallback((field: keyof typeof localState, value: unknown) => {
    if (lastSavedRef.current[field] === value) return;

    // sem internet ou com o servidor fora, o cliente da API guarda na fila e responde na hora
    setIsSaving(true);
    // cliente apagado vai como texto vazio: o banco não aceita entrega sem cliente (null dava erro 500
    // e o envio ficava preso na fila, travando a tela daquele PC)
    const updateData = { [field]: field === "cliente" ? String(value ?? "") : value === "" ? null : value };
    updateEntrega.mutate(
      { id: entrega.id, data: updateData },
      {
        onSuccess: () => {
          syncAgendaCache(field, value);
          queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date }) });
          queryClient.invalidateQueries({ queryKey: ["clientes-agendamento-mensal"] });
          queryClient.refetchQueries({ queryKey: ["clientes-agendamento-mensal"], type: "active" });
          queryClient.refetchQueries({ queryKey: getListEntregasQueryKey({ date }), type: "active" });
          lastSavedRef.current = { ...lastSavedRef.current, [field]: value } as typeof localState;
        },
        onSettled: () => setIsSaving(false),
      }
    );
  }, [entrega.id, date, updateEntrega, queryClient, syncAgendaCache]);

  const handleChange = (field: keyof typeof localState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalState(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleBlur = (field: keyof typeof localState) => () => {
    saveField(field, localState[field]);
  };

  const finishDivergenciasEdit = (value: string) => {
    if (!divergenciasEditingRef.current) return;
    divergenciasEditingRef.current = false;
    setEditingDivergencias(false);
    saveField("divergencias", value);
  };

  const handleNfcgCycle = (field: "nf" | "cg") => () => {
    const cur = localState[field];
    const next = cur === "none" ? "check" : cur === "check" ? "x" : "none";
    setLocalState(prev => ({ ...prev, [field]: next }));
    saveField(field, next);
  };

  const handleSCycle = () => {
    const next = localState.checked === "none" ? "filled" : localState.checked === "filled" ? "confirmed" : "none";
    setLocalState(prev => ({ ...prev, checked: next }));
    saveField("checked", next);
  };

  const handleVCycle = () => {
    const next = localState.v === "2A" ? null : "2A";
    setLocalState(prev => ({ ...prev, v: next }));
    saveField("v", next);
  };

  const handleUnidadeChange = (value: string) => {
    setLocalState(prev => ({ ...prev, unidade: value as EntregaUnidade }));
    saveField("unidade", value);
  };

  const handleDelete = () => {
    if (window.confirm("Deseja excluir esta entrega?")) {
      const queryKey = getListEntregasQueryKey({ date });
      const previous = queryClient.getQueryData<Entrega[]>(queryKey);
      queryClient.setQueryData<Entrega[]>(queryKey, (old) =>
        old?.filter((item) => item.id !== entrega.id) ?? []
      );

      deleteEntrega.mutate({ id: entrega.id }, {
        onError: () => queryClient.setQueryData(queryKey, previous),
      });
      // depois de recarregar, a tela volta para o dia desta entrega (e não para hoje)
      try { sessionStorage.setItem("ripack_dia_apos_recarregar", date); } catch { /* sem sessionStorage: volta para hoje */ }
      window.setTimeout(() => window.location.reload(), 1000);
    }
  };

  const handleFreteChange = (val: string) => {
    const next = (val === "" ? null : val) as FreteOption | null;
    setLocalState(prev => ({ ...prev, frete: next }));
    saveField("frete", next);
  };

  const isRipack    = localState.frete === "RIPACK";
  const obsUpper    = localState.obs?.toUpperCase() ?? "";
  const isCancelled  = obsUpper.startsWith("CANCELADA") || obsUpper.startsWith("CANCELADO");
  const isDevolution = obsUpper.startsWith("DEVOLUÇÃO");

  const template = gridTemplate(colWidths);

  const rowRef = useRef<HTMLDivElement>(null);

  const enableDrag  = () => { if (rowRef.current) rowRef.current.draggable = true; };
  const disableDrag = () => { if (rowRef.current && !conjugando) rowRef.current.draggable = false; };
  // linha marcada para conjugar: dá pra arrastar segurando em qualquer ponto dela
  useEffect(() => {
    if (rowRef.current) rowRef.current.draggable = !!conjugando;
  }, [conjugando]);

  return (
    <div
      ref={rowRef}
      onDragStart={onDragStart}
      onDragEnter={(e) => { e.preventDefault(); onDragEnter(); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { disableDrag(); onDragEnd(); }}
      className={cn(
        "delivery-row border-b border-slate-200 group hover:bg-slate-50 transition-colors items-stretch",
        acrylicEnabled && "app-acrylic-row",
        acrylicEnabled && (isRipack || isCancelled || isDevolution) && "app-acrylic-status-row",
        acrylicEnabled && isRipack && "delivery-row-status-ripack",
        acrylicEnabled && isCancelled && "delivery-row-status-cancelled",
        acrylicEnabled && isDevolution && !isCancelled && "delivery-row-status-devolution",
        rowThemeColor && "delivery-row-themed",
        isRipack    && (backgroundImageEnabled || acrylicEnabled ? "bg-green-100/75 hover:bg-green-200/80" : "bg-green-100 hover:bg-green-200"),
        isCancelled && (backgroundImageEnabled || acrylicEnabled ? "bg-red-100/75 hover:bg-red-200/80" : "bg-red-100 hover:bg-red-200"),
        isDevolution && !isCancelled && (backgroundImageEnabled || acrylicEnabled ? "bg-yellow-100/75 hover:bg-yellow-200/80" : "bg-yellow-100 hover:bg-yellow-200"),
        isDragging && "opacity-30 scale-[0.99]",
        isDragOver && !conjugarAtivo && "border-t-2 border-blue-500",
        isDragOver && conjugarAtivo && !conjugando && "ring-2 ring-inset ring-emerald-500 bg-emerald-50",
        conjugando && "ring-2 ring-inset ring-blue-600 bg-blue-100 cursor-grab",
      )}
      title={conjugando ? "Arraste esta linha para cima da carga com que ela vai ser conjugada (Esc cancela)" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: template,
        ...(rowThemeColor ? { "--delivery-row-theme": rowThemeColor } : {}),
      } as React.CSSProperties}
    >
      {/* S */}
      <div className="p-2 border-r border-slate-200 flex items-center justify-center overflow-hidden">
        <button
          onClick={handleSCycle}
          data-testid={`button-s-${entrega.id}`}
          className={cn(
            "w-5 h-5 rounded border flex-shrink-0 transition-colors",
            localState.checked === "none" && "border-slate-300 bg-white hover:bg-slate-100",
            localState.checked === "filled" && "border-slate-800 bg-slate-800",
            localState.checked === "confirmed" && "border-green-700 bg-green-700 text-white flex items-center justify-center",
          )}
        >
          {localState.checked === "confirmed" && (
            <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
            </svg>
          )}
        </button>
      </div>

      {/* # */}
      <div className="p-2 border-r border-slate-200 flex items-center justify-center overflow-hidden">
        <span className="text-xs font-bold text-slate-400 select-none">{rowIndex}</span>
      </div>

      {/* CLIENTE — botão direito abre a grade RQ C 008 filtrada por este cliente */}
      <div
        className="p-1 border-r border-slate-200 flex flex-col justify-center overflow-hidden"
        // botão direito não entra no campo (nem abre as sugestões): só o esquerdo edita
        onMouseDownCapture={(event) => {
          if (event.button === 2 && localState.cliente.trim()) event.preventDefault();
        }}
        onContextMenu={(event) => {
          if (!localState.cliente.trim()) return;
          event.preventDefault();
          abrirGradeComCliente(localState.cliente, { motorista: localState.motorista, placa: localState.placa });
        }}
        title={localState.cliente ? "Botão direito: ver este cliente na RQ C 008" : undefined}
      >
        <button
          type="button"
          onClick={(e) => { if (e.button === 0) setPopupAberto("cliente"); }}
          className="w-full min-h-8 px-2 py-1.5 text-left text-sm font-medium text-slate-800 bg-transparent rounded hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`input-cliente-${entrega.id}`}
        >
          <span className="block truncate">{localState.cliente}</span>
        </button>
      </div>
      <CampoPopup
        aberto={popupAberto === "cliente"}
        titulo="Cliente"
        opcoes={opcoesClientes}
        filtrar={filtrarCliente}
        textoDeBusca={segmentoCliente}
        semAutoSe={/[+(]/}
        placeholder={localState.cliente || "código ou nome"}
        dica="Digite o código ou parte do nome e aperte Enter · o + abre mais um cliente conjugado"
        avisoSemOpcao="Nenhum cliente cadastrado com esse nome."
        aoEscolher={(op, texto) => salvarCliente(replaceLastSegment(texto, op.rotulo))}
        completar={(op, texto) => replaceLastSegment(texto, op.rotulo)}
        aoTextoLivre={(texto) => {
          // só fica cliente cadastrado (o que não for some), igual a antes; sem a lista (offline), aceita
          const valor = !navigator.onLine || !podeConferirCliente ? texto.trim() : validateValue(texto, nomesClientes);
          if (valor) salvarCliente(valor);
        }}
        aoLimpar={() => salvarCliente("")}
        varios={{
          aoConcluir: (nomes) => salvarCliente(nomes.join(" + ")),
          validarLivre: (texto) => (!navigator.onLine || !podeConferirCliente ? texto.trim() : validateValue(texto, nomesClientes)),
        }}
        aoFechar={fecharPopup}
        linha={<LinhaResumo numero={rowIndex} estado={localState} editando="cliente" />}
        testId={`popup-cliente-${entrega.id}`}
      />

      {/* HRS */}
      <div className={cn(
        "p-1 border-r border-slate-200 flex flex-col justify-center transition-colors overflow-hidden",
        localState.hrs ? "bg-yellow-200" : ""
      )}>
        <button
          type="button"
          onClick={() => setHoraDigitada("")}
          title="Clique para digitar a hora"
          className="w-full min-h-8 px-2 py-1.5 text-sm font-bold text-center bg-transparent rounded hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
          data-testid={`input-hrs-${entrega.id}`}
        >
          <span className="block truncate">{localState.hrs}</span>
        </button>
      </div>
      <Dialog open={horaDigitada !== null} onOpenChange={(open) => { if (!open) setHoraDigitada(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Hora</DialogTitle>
          </DialogHeader>
          <LinhaResumo numero={rowIndex} estado={localState} editando="hrs" />
          <input
            autoFocus
            inputMode="numeric"
            value={horaDigitada ?? ""}
            placeholder={localState.hrs || "ex.: 7"}
            onChange={(e) => setHoraDigitada(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); salvarHora(e.currentTarget.value || localState.hrs); }
            }}
            className="w-full sm:max-w-xs sm:mx-auto rounded-md border border-slate-300 px-3 py-3 text-center text-3xl font-bold tracking-wider outline-none focus:ring-2 focus:ring-blue-500"
            data-testid={`popup-hrs-${entrega.id}`}
          />
          <p className="text-center text-sm text-slate-500">
            {horaDigitada ? <>Vai ficar <b className="text-slate-900">{normalizarHora(horaDigitada) || "(vazio)"}</b> · Enter para salvar</> : "Digite só a hora (7) ou hora e minutos (730) e aperte Enter"}
          </p>
          <div className="flex gap-2 sm:max-w-xs sm:mx-auto sm:w-full">
            <Button type="button" variant="outline" className="flex-1" onClick={() => salvarHora("")} data-testid={`popup-hrs-limpar-${entrega.id}`}>Limpar</Button>
            <Button type="button" className="flex-1" onClick={() => salvarHora(horaDigitada || localState.hrs)} data-testid={`popup-hrs-salvar-${entrega.id}`}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* OBS — select nativo de motivos quando começa com "cancelad" ou "devolução", senão input livre */}
      <div className="p-1 border-r border-slate-200 flex items-center gap-1">
        {(isCancelled || isDevolution) && (motivos?.length ?? 0) > 0 ? (
          <>
            <select
              value={localState.obs.replace(/^(?:CANCELAD[AO]|DEVOLUÇÃO)\s*-\s*/i, "")}
              onChange={(e) => {
                const motivo = e.target.value;
                const prefix = isDevolution
                  ? "DEVOLUÇÃO"
                  : (obsUpper.startsWith("CANCELADA") ? "CANCELADA" : "CANCELADO");
                const val = motivo === "" ? prefix : `${prefix} - ${motivo}`;
                setLocalState(prev => ({ ...prev, obs: val }));
                saveField("obs", val);
              }}
              className="flex-1 min-w-0 px-1 py-1 text-sm text-slate-700 bg-transparent border-0 outline-none rounded focus:ring-2 focus:ring-blue-500 focus:bg-white cursor-pointer"
              data-testid={`select-obs-${entrega.id}`}
            >
              <option value="">
                {isDevolution ? "DEVOLUÇÃO" : (obsUpper.startsWith("CANCELADA") ? "CANCELADA" : "CANCELADO")}
              </option>
              {motivos!.map((m) => (
                <option key={m.id} value={m.motivo}>{m.motivo}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setLocalState(prev => ({ ...prev, obs: "" }));
                saveField("obs", "");
              }}
              className="flex-shrink-0 text-slate-400 hover:text-red-500 text-base leading-none px-0.5"
              title="Limpar"
            >×</button>
          </>
        ) : (
          <input
            type="text"
            value={localState.obs}
            onChange={handleChange("obs")}
            onBlur={() => saveField("obs", localState.obs)}
            className="w-full px-2 py-1.5 text-sm text-slate-700 bg-transparent border-0 outline-none rounded focus:ring-2 focus:ring-blue-500 focus:bg-white"
            data-testid={`input-obs-${entrega.id}`}
          />
        )}
      </div>

      {/* MOTORISTA / PLACA */}
      <div className="p-1 border-r border-slate-200 flex items-center overflow-hidden">
        <button
          type="button"
          onClick={() => { setMotoristaDigitado(""); setPlacaLivre(""); setPopupAberto("motorista"); }}
          className="w-full min-h-8 flex items-center gap-1 px-2 py-1.5 text-left text-sm bg-transparent rounded hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`input-motorista-${entrega.id}`}
        >
          <span className={cn("min-w-0 flex-1 truncate font-medium", localState.motorista ? "text-slate-700" : "text-slate-400")}>{localState.motorista || "Motorista"}</span>
          <span className="text-slate-400 font-bold flex-shrink-0">•</span>
          <span className={cn("w-[90px] flex-shrink-0 truncate font-mono uppercase", localState.placa ? "text-slate-600" : "text-slate-400")} data-testid={`input-placa-${entrega.id}`}>{localState.placa || "Placa"}</span>
        </button>
      </div>
      <CampoPopup
        aberto={popupAberto === "motorista"}
        titulo="Motorista • Placa"
        opcoes={opcoesMotoristas}
        placeholder={localState.motorista || "nome ou placa"}
        dica="Digite o nome ou a placa"
        avisoSemOpcao="Motorista não cadastrado: confira o nome, digite a placa abaixo e aperte Enter."
        aoMudarTexto={setMotoristaDigitado}
        aoEscolher={(op) => {
          const m = motoristas.find((x) => String(x.id) === op.chave);
          salvarMotorista(op.rotulo, op.detalhe || "", m ? (m.frete ?? null) : undefined);
        }}
        aoTextoLivre={(texto) => salvarMotorista(texto.trim().toUpperCase(), placaLivre.trim().toUpperCase())}
        aoLimpar={() => salvarMotorista("", "")}
        aoFechar={fecharPopup}
        linha={<LinhaResumo numero={rowIndex} estado={localState} editando="motorista" />}
        testId={`popup-motorista-${entrega.id}`}
      >
        {motoristaDigitado.trim() && !opcoesMotoristas.some((op) => semAcento(op.rotulo).includes(semAcento(motoristaDigitado)) || semAcento(op.detalhe || "").includes(semAcento(motoristaDigitado))) && <input
          value={placaLivre}
          placeholder="Placa do motorista não cadastrado"
          autoComplete="off"
          onChange={(e) => setPlacaLivre(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && motoristaDigitado.trim()) { e.preventDefault(); salvarMotorista(motoristaDigitado.trim().toUpperCase(), placaLivre.trim().toUpperCase()); }
          }}
          className="w-full sm:max-w-md sm:mx-auto rounded-md border border-slate-300 px-3 py-2 text-center font-mono uppercase outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`popup-placa-${entrega.id}`}
        />}
      </CampoPopup>

      {/* FRETE */}
      <div className="border-r border-slate-200 flex items-center overflow-hidden px-1">
        <button
          type="button"
          onClick={() => setPopupAberto("frete")}
          className="w-full min-h-8 px-1 py-1 text-left text-xs font-semibold text-slate-700 bg-transparent rounded hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`select-frete-${entrega.id}`}
        >
          <span className="block truncate">{localState.frete || "—"}</span>
        </button>
      </div>
      <CampoPopup
        aberto={popupAberto === "frete"}
        titulo="Frete"
        opcoes={FRETE_OPTIONS.map((o) => ({ chave: o, rotulo: o }))}
        semDigitacao
        dica="Clique no frete"
        aoEscolher={(op) => { handleFreteChange(op.rotulo); fecharPopup(); }}
        aoLimpar={() => { handleFreteChange(""); fecharPopup(); }}
        aoFechar={fecharPopup}
        linha={<LinhaResumo numero={rowIndex} estado={localState} editando="frete" />}
        testId={`popup-frete-${entrega.id}`}
      />

      {/* V */}
      <div className="p-1 border-r border-slate-200 flex items-center justify-center overflow-hidden">
        <button
          onClick={handleVCycle}
          data-testid={`button-v-${entrega.id}`}
          className={cn(
            "w-full h-7 rounded text-xs font-semibold transition-colors border",
            localState.v !== "2A" && "bg-white border-slate-200 hover:border-slate-400",
            localState.v === "2A" && "bg-blue-200 border-blue-400 text-blue-800 hover:bg-blue-300"
          )}
        >
          {localState.v === "2A" && "2ª"}
        </button>
      </div>

      {/* UNIDADE */}
      <div className="p-1 border-r border-slate-200 flex flex-col justify-center overflow-hidden">
        <button
          type="button"
          onClick={() => setPopupAberto("unidade")}
          className="w-full h-8 px-3 text-left text-xs font-semibold text-slate-800 bg-transparent rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`select-unidade-${entrega.id}`}
        >
          <span className="block truncate">{localState.unidade}</span>
        </button>
      </div>
      <CampoPopup
        aberto={popupAberto === "unidade"}
        titulo="Unidade"
        opcoes={UNIDADE_OPTIONS.map((o) => ({ chave: o, rotulo: o }))}
        semDigitacao
        dica="Clique na unidade"
        aoEscolher={(op) => { handleUnidadeChange(op.rotulo); fecharPopup(); }}
        aoFechar={fecharPopup}
        linha={<LinhaResumo numero={rowIndex} estado={localState} editando="unidade" />}
        testId={`popup-unidade-${entrega.id}`}
      />

      {/* NF */}
      <div className={cn(
        "p-2 border-r border-slate-200 flex items-center justify-center transition-colors overflow-hidden",
        localState.nf === "check" ? "bg-green-300" : "",
        localState.nf === "x" ? "bg-red-200" : ""
      )}>
        <button
          onClick={handleNfcgCycle("nf")}
          data-testid={`button-nf-${entrega.id}`}
          className={cn(
            "w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
            localState.nf === "none" && "border-slate-300 bg-white hover:bg-slate-100",
            localState.nf === "x" && "border-red-500 bg-white",
            localState.nf === "check" && "border-green-700 bg-green-700 text-white",
          )}
        >
          {localState.nf === "x" && (
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-red-500">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          )}
          {localState.nf === "check" && (
            <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
            </svg>
          )}
        </button>
      </div>

      {/* CG */}
      <div className={cn(
        "p-2 border-r border-slate-200 flex items-center justify-center transition-colors overflow-hidden",
        localState.cg === "check" ? "bg-green-300" : "",
        localState.cg === "x" ? "bg-red-200" : ""
      )}>
        <button
          onClick={handleNfcgCycle("cg")}
          data-testid={`button-cg-${entrega.id}`}
          className={cn(
            "w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
            localState.cg === "none" && "border-slate-300 bg-white hover:bg-slate-100",
            localState.cg === "x" && "border-red-500 bg-white",
            localState.cg === "check" && "border-green-700 bg-green-700 text-white",
          )}
        >
          {localState.cg === "x" && (
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-red-500">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          )}
          {localState.cg === "check" && (
            <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
            </svg>
          )}
        </button>
      </div>

      {/* DIVERGENCIAS */}
      <div className="p-1 border-r border-slate-200">
        <button
          type="button"
          onClick={() => {
            divergenciasEditingRef.current = true;
            setEditingDivergencias(true);
          }}
          title={localState.divergencias}
          className="w-full min-h-8 overflow-hidden px-2 py-1.5 text-left text-sm text-slate-700"
          data-testid={`input-divergencias-${entrega.id}`}
        >
          <span className="block truncate">{localState.divergencias}</span>
        </button>
      </div>
      <Dialog
        open={editingDivergencias}
        onOpenChange={(open) => {
          if (!open) finishDivergenciasEdit(localState.divergencias);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar divergências</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            value={localState.divergencias}
            onChange={(e) => setLocalState(prev => ({ ...prev, divergencias: e.target.value }))}
            onBlur={(e) => finishDivergenciasEdit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                finishDivergenciasEdit(e.currentTarget.value);
              }
            }}
            className="min-h-40 resize-y text-sm text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid={`input-divergencias-${entrega.id}`}
          />
        </DialogContent>
      </Dialog>

      {/* Actions */}
      <div className="p-1 flex items-center justify-center gap-1 relative overflow-hidden">
        {selectionMode && (
          <label className="absolute left-1 z-10 flex items-center justify-center w-6 h-6 cursor-pointer print:hidden" title="Selecionar carga">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelection}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
              aria-label={`Selecionar carga ${entrega.cliente}`}
            />
          </label>
        )}
        <div className={cn("absolute right-0 inset-y-0 flex items-center justify-center gap-0.5 pl-7 pr-1 bg-white/90 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity print:hidden", conjugando && "opacity-100 pointer-events-auto")}>
          <div
            onMouseDown={enableDrag}
            onMouseUp={disableDrag}
            className="cursor-grab active:cursor-grabbing p-1 rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
            title="Arrastar para reordenar"
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <Button variant="ghost" size="icon" onClick={onConjugar} title={conjugando ? "Cancelar conjugar carga" : "Conjugar carga: marque esta linha e arraste para cima de outra"} className={cn("w-6 h-6 rounded", conjugando ? "text-blue-700 bg-blue-100" : "text-slate-400 hover:text-blue-600 hover:bg-blue-50")} data-testid={`button-conjugar-${entrega.id}`}>
            <Link2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDelete} className="w-6 h-6 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" data-testid={`button-delete-${entrega.id}`}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
        {isSaving && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 group-hover:hidden">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// New Delivery Row
// ----------------------------------------------------------------------

interface NewDeliveryRowProps {
  date: string;
  index: number;
  backgroundImageEnabled: boolean;
  acrylicEnabled: boolean;
}

function NewDeliveryRow({ date, index, backgroundImageEnabled, acrylicEnabled }: NewDeliveryRowProps) {
  const colWidths = useColWidths();
  const queryClient = useQueryClient();
  const createEntrega = useCreateEntrega();
  const [isCreating, setIsCreating] = useState(false);
  const [newCliente, setNewCliente] = useState("");
  const [popupNovo, setPopupNovo] = useState(false);
  const { opcoes: opcoesClientes, nomes: nomesClientes, podeConferir: podeConferirCliente } = useOpcoesClientes();

  const handleCreate = (validatedCliente?: string) => {
    const value = (validatedCliente ?? newCliente).trim();
    if (!value || isCreating) return;

    // sem internet ou com o servidor fora, o cliente da API guarda na fila e responde na hora
    setIsCreating(true);
    createEntrega.mutate(
      { data: { date, cliente: value, sortOrder: index, checked: "none", unidade: "MATRIZ", cg: "none" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date }) });
          setNewCliente("");
        },
        onSettled: () => setIsCreating(false),
      }
    );
  };

  const template = gridTemplate(colWidths);

  return (
    <div
      className={cn(
        "border-b border-slate-100 hover:bg-blue-50/30 transition-colors items-stretch opacity-60 hover:opacity-100",
        (backgroundImageEnabled || acrylicEnabled) && "bg-white/20",
        acrylicEnabled && "app-acrylic-row"
      )}
      style={{ display: "grid", gridTemplateColumns: template }}
    >
      <div className="p-2 border-r border-slate-100 flex items-center justify-center">
        <div className="w-5 h-5 rounded-sm border border-slate-300 bg-white/50" />
      </div>

      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* # */}

      <div className="p-1 border-r border-slate-100 flex flex-col justify-center relative overflow-hidden">
        <button
          type="button"
          onClick={() => setPopupNovo(true)}
          className="w-full min-h-8 px-2 py-1.5 text-left text-sm italic text-slate-400 bg-transparent rounded hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={`input-new-cliente-${index}`}
        >
          {newCliente || "Adicionar cliente..."}
        </button>
        <CampoPopup
          aberto={popupNovo}
          titulo="Adicionar cliente"
          opcoes={opcoesClientes}
          filtrar={filtrarCliente}
          textoDeBusca={segmentoCliente}
          semAutoSe={/[+(]/}
          placeholder="código ou nome"
          dica="Digite o código ou parte do nome e aperte Enter · o + abre mais um cliente conjugado"
          avisoSemOpcao="Nenhum cliente cadastrado com esse nome."
          aoEscolher={(op, texto) => { setPopupNovo(false); handleCreate(replaceLastSegment(texto, op.rotulo)); }}
          completar={(op, texto) => replaceLastSegment(texto, op.rotulo)}
          aoTextoLivre={(texto) => {
            const valor = !navigator.onLine || !podeConferirCliente ? texto.trim() : validateValue(texto, nomesClientes);
            if (valor) { setPopupNovo(false); handleCreate(valor); }
          }}
          varios={{
            aoConcluir: (nomes) => { setPopupNovo(false); handleCreate(nomes.join(" + ")); },
            validarLivre: (texto) => (!navigator.onLine || !podeConferirCliente ? texto.trim() : validateValue(texto, nomesClientes)),
          }}
          aoFechar={() => setPopupNovo(false)}
          testId={`popup-new-cliente-${index}`}
        />
        {isCreating && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          </div>
        )}
      </div>

      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* HRS */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* OBS */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* MOTORISTA•PLACA */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* RIPACK */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* V */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* UNIDADE */}
      <div className="p-2 border-r border-slate-100 overflow-hidden" />{/* NF */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* CG */}
      <div className="p-1 border-r border-slate-100 overflow-hidden" />{/* DIVERGÊNCIAS */}
      <div className="p-1 overflow-hidden" />{/* actions */}
    </div>
  );
}
