import { useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, CalendarPlus, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, List, ListPlus, Loader2, Paperclip, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getListEntregasQueryKey, useCreateEntrega, useDeleteEntrega, useUpdateEntrega, type Entrega } from "@workspace/api-client-react";
import { useClientesCadastro } from "@/components/clientes-cadastro-modal";
import { toast } from "@/hooks/use-toast";
import { AgendamentoFotoDialog, buscarIdsComFoto } from "@/components/agendamento-foto-dialog";
import { AgendamentoFotosLote } from "@/components/agendamento-fotos-lote";
import { AgendaCalendario } from "@/components/agenda-calendario";
import { AgendamentoDetalheDialog } from "@/components/agendamento-detalhe-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");

interface AgendamentoRascunho {
  id: number;
  date: string;
  hrs: string;
}

interface AgendamentoMensalItem {
  id: number;
  date: string;
  cliente: string;
  hrs: string | null;
  unidade: Entrega["unidade"];
  cg: Entrega["cg"];
  statusManual: Entrega["statusManual"];
  agendamento: boolean;
}

async function fetchAgendamentosDoMes(month: Date): Promise<AgendamentoMensalItem[]> {
  const from = format(startOfMonth(month), "yyyy-MM-dd");
  const to = format(endOfMonth(month), "yyyy-MM-dd");
  const response = await fetch(`${API_BASE}/api/entregas?from=${from}&to=${to}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Não foi possível carregar a programação de ${format(month, "MMMM yyyy", { locale: ptBR })}.`);
  const deliveries = await response.json() as Entrega[];

  return deliveries
    .map(({ id, date, cliente, hrs, unidade, cg, statusManual, agendamento }) => ({
      id,
      date,
      cliente,
      hrs,
      unidade,
      cg,
      statusManual,
      agendamento: agendamento ?? false,
    }))
    .sort((first, second) => first.date.localeCompare(second.date) || first.cliente.localeCompare(second.cliente));
}

function getAppointmentStatus(item: AgendamentoMensalItem) {
  if (item.statusManual) {
    const manualStatus = {
      green: { label: "CG conferido", color: "bg-green-500" },
      red: { label: "CG com pendência", color: "bg-red-500" },
      yellow: { label: "CG não conferido", color: "bg-yellow-400" },
    };
    return manualStatus[item.statusManual];
  }
  if (item.cg === "check") {
    return { label: "CG conferido", color: "bg-green-500" };
  }
  if (item.cg === "x") {
    return { label: "CG com pendência", color: "bg-red-500" };
  }
  return { label: "CG não conferido", color: "bg-yellow-400" };
}

interface ClientesAgendamentoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Ir para o dia": a Programação de Entrega abre naquele dia */
  onIrParaDia?: (date: string) => void;
}

// próximo dia útil depois de hoje (segunda a sexta; feriado não entra na conta)
function proximoDiaUtil(hoje: Date): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}

export function ClientesAgendamentoModal({ open, onOpenChange, onIrParaDia }: ClientesAgendamentoModalProps) {
  const queryClient = useQueryClient();
  const createEntrega = useCreateEntrega();
  const updateEntrega = useUpdateEntrega();
  const deleteEntrega = useDeleteEntrega();
  const { data: clientesCadastrados = [] } = useClientesCadastro();
  const [cliente, setCliente] = useState("");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [nextDraftId, setNextDraftId] = useState(1);
  const [drafts, setDrafts] = useState<AgendamentoRascunho[]>([
    { id: 0, date: format(new Date(), "yyyy-MM-dd"), hrs: "" },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showImportPicker, setShowImportPicker] = useState(false);
  const [importDate, setImportDate] = useState("");
  const [importingId, setImportingId] = useState<number | null>(null);
  const monthKey = format(month, "yyyy-MM");
  const { data: monthlyDeliveries = [], isLoading: isLoadingMonth, isError: isMonthError } = useQuery({
    queryKey: ["clientes-agendamento-mensal", monthKey],
    queryFn: () => fetchAgendamentosDoMes(month),
    enabled: open,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  // quais agendamentos do mês têm foto do ticket (só os ids; a imagem desce ao abrir)
  const { data: idsComFoto = [] } = useQuery({
    queryKey: ["agendamento-fotos", monthKey],
    queryFn: () => buscarIdsComFoto(format(startOfMonth(month), "yyyy-MM-dd"), format(endOfMonth(month), "yyyy-MM-dd")),
    enabled: open,
    staleTime: 60_000,
  });
  const [fotoDe, setFotoDe] = useState<AgendamentoMensalItem | null>(null);
  const [mostrarAnteriores, setMostrarAnteriores] = useState(false);
  const [loteAberto, setLoteAberto] = useState(false);
  const [editando, setEditando] = useState<{ id: number; date: string; hrs: string } | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState<number | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);
  const hojeIso = format(new Date(), "yyyy-MM-dd");
  const destaqueIso = proximoDiaUtil(new Date());

  const atualizarDepois = async (datas: string[]) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["clientes-agendamento-mensal"] }),
      queryClient.invalidateQueries({ queryKey: ["agendamento-fotos"] }),
      ...datas.map((date) => queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date }) })),
    ]);
  };

  const dataBr = (iso: string) => iso.split("-").reverse().join("/");

  // muda data e horário (lista e calendário); true se gravou
  const salvarDataHora = async (item: AgendamentoMensalItem, date: string, hrs: string): Promise<boolean> => {
    if (!date || !hrs) return false;
    setOcupadoId(item.id);
    try {
      await updateEntrega.mutateAsync({ id: item.id, data: { date, hrs } });
      await atualizarDepois([item.date, date]);
      toast({ title: "Agendamento alterado", description: `${item.cliente} · ${dataBr(date)} · ${hrs}` });
      return true;
    } catch (error) {
      toast({ title: "Não foi possível alterar o agendamento.", description: error instanceof Error ? error.message : "Tente de novo.", variant: "destructive" });
      return false;
    } finally {
      setOcupadoId(null);
    }
  };

  const salvarEdicao = async (item: AgendamentoMensalItem) => {
    if (!editando) return;
    if (await salvarDataHora(item, editando.date, editando.hrs)) setEditando(null);
  };

  const excluirAgendamento = async (item: AgendamentoMensalItem): Promise<boolean> => {
    setOcupadoId(item.id);
    try {
      await deleteEntrega.mutateAsync({ id: item.id });
      setConfirmarExclusao(null);
      setDetalheId(null);
      await atualizarDepois([item.date]);
      toast({ title: "Agendamento excluído", description: `${item.cliente} · ${dataBr(item.date)}` });
      return true;
    } catch (error) {
      toast({ title: "Não foi possível excluir o agendamento.", description: error instanceof Error ? error.message : "Tente de novo.", variant: "destructive" });
      return false;
    } finally {
      setOcupadoId(null);
    }
  };

  // calendário ou lista: fica a última escolha neste aparelho
  const [vista, setVista] = useState<"calendario" | "lista">(() => {
    try { return localStorage.getItem("agenda-vista") === "lista" ? "lista" : "calendario"; } catch { return "calendario"; }
  });
  const escolherVista = (v: "calendario" | "lista") => {
    setVista(v);
    try { localStorage.setItem("agenda-vista", v); } catch { /* sem armazenamento: vale só agora */ }
  };
  const [formAberto, setFormAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const abrirInserir = (date?: string) => {
    if (date) {
      setDrafts([{ id: nextDraftId, date, hrs: "" }]);
      setNextDraftId((n) => n + 1);
    }
    setFormAberto(true);
  };
  const monthlyAgendamentos = monthlyDeliveries.filter((item) => item.agendamento);
  const detalhe = detalheId != null ? monthlyAgendamentos.find((item) => item.id === detalheId) ?? null : null;
  const availableImportDates = Array.from(new Set(
    monthlyDeliveries.filter((item) => !item.agendamento).map((item) => item.date)
  )).sort();
  const activeImportDate = availableImportDates.includes(importDate)
    ? importDate
    : availableImportDates[0] ?? "";
  const deliveriesToImport = monthlyDeliveries.filter((item) => !item.agendamento && item.date === activeImportDate);

  const refreshAgenda = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: ["clientes-agendamento-mensal", monthKey], type: "active" });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleImportDelivery = async (item: AgendamentoMensalItem) => {
    if (item.agendamento || importingId !== null) return;

    const monthlyQueryKey = ["clientes-agendamento-mensal", monthKey];
    const dailyQueryKey = getListEntregasQueryKey({ date: item.date });
    setImportingId(item.id);
    queryClient.setQueryData<AgendamentoMensalItem[]>(monthlyQueryKey, (items) =>
      items?.map((delivery) => delivery.id === item.id ? { ...delivery, agendamento: true } : delivery)
    );
    queryClient.setQueryData<Entrega[]>(dailyQueryKey, (deliveries) =>
      deliveries?.map((delivery) => delivery.id === item.id ? { ...delivery, agendamento: true } : delivery)
    );

    try {
      await updateEntrega.mutateAsync({ id: item.id, data: { agendamento: true } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: monthlyQueryKey }),
        queryClient.invalidateQueries({ queryKey: dailyQueryKey }),
      ]);
      toast({ title: "Carga importada para a agenda", description: `${item.cliente} · ${item.hrs || "sem horário"}` });
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: monthlyQueryKey });
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      toast({
        title: "Não foi possível importar a carga.",
        description: error instanceof Error ? error.message : "Verifique a conexão e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setImportingId(null);
    }
  };

  const handleStatusClick = (item: AgendamentoMensalItem) => {
    const queryKey = ["clientes-agendamento-mensal", monthKey];
    const current = queryClient.getQueryData<AgendamentoMensalItem[]>(queryKey)?.find((entry) => entry.id === item.id) ?? item;
    const currentStatus = current.statusManual ?? (
      current.cg === "check" ? "green" : current.cg === "x" ? "red" : "yellow"
    );
    const nextStatus = currentStatus === "green"
      ? "red"
      : currentStatus === "red"
        ? "yellow"
        : "green";

    queryClient.setQueryData<AgendamentoMensalItem[]>(queryKey, (items) =>
      items?.map((entry) => entry.id === item.id ? { ...entry, statusManual: nextStatus } : entry)
    );
    updateEntrega.mutate(
      { id: item.id, data: { statusManual: nextStatus } },
      {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
        onError: (error) => {
          void queryClient.invalidateQueries({ queryKey });
          toast({
            title: "Não foi possível alterar o status.",
            description: error instanceof Error ? error.message : "Verifique a conexão e tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const updateDraft = (id: number, changes: Partial<Pick<AgendamentoRascunho, "date" | "hrs">>) => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...changes } : draft));
  };

  const addDraft = () => {
    setDrafts((current) => [...current, { id: nextDraftId, date: format(new Date(), "yyyy-MM-dd"), hrs: "" }]);
    setNextDraftId((current) => current + 1);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nome = cliente.trim().toUpperCase();
    if (!nome || drafts.length === 0 || drafts.some((draft) => !draft.date || !draft.hrs) || isSaving) return;

    setIsSaving(true);
    const results: PromiseSettledResult<Entrega>[] = [];
    for (const draft of drafts) {
      try {
        const created = await createEntrega.mutateAsync({
          data: { date: draft.date, cliente: nome, hrs: draft.hrs, unidade: "MATRIZ", agendamento: true },
        });
        results.push({ status: "fulfilled", value: created });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
    }

    const successfulCount = results.filter((result) => result.status === "fulfilled").length;
    const failedDrafts = drafts.filter((_, index) => results[index]?.status === "rejected");
    const datesToRefresh = new Set(drafts.map((draft) => draft.date));
    try {
      await Promise.all([
        ...Array.from(datesToRefresh, (date) => queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date }) })),
        queryClient.invalidateQueries({ queryKey: ["clientes-agendamento-mensal"] }),
      ]);
    } catch {
      // The saved deliveries are still valid even if refreshing the view fails.
    }

    if (failedDrafts.length === 0) {
      toast({ title: "Agendamentos incluídos na programação", description: `${nome} · ${drafts.length} data${drafts.length !== 1 ? "s" : ""}` });
      const nextId = nextDraftId;
      setDrafts([{ id: nextId, date: format(new Date(), "yyyy-MM-dd"), hrs: "" }]);
      setFormAberto(false);
      setNextDraftId(nextId + 1);
    } else {
      const firstFailure = results.find((result) => result.status === "rejected");
      const failureMessage = firstFailure?.status === "rejected" && firstFailure.reason instanceof Error
        ? firstFailure.reason.message
        : "Verifique a conexão e tente novamente.";
      toast({
        title: `${successfulCount} de ${results.length} agendamento${results.length !== 1 ? "s" : ""} salvo${results.length !== 1 ? "s" : ""}`,
        description: `${failureMessage} Os itens já salvos foram removidos do lote para evitar duplicidade.`,
        variant: "destructive",
      });
      setDrafts(failedDrafts);
    }
    setIsSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(aberto) => {
      // com a foto do ticket aberta, fechar só volta para a agenda
      if (!aberto && fotoDe) { setFotoDe(null); return; }
      if (!aberto && loteAberto) { setLoteAberto(false); return; }
      if (!aberto && detalheId != null) { setDetalheId(null); return; }
      if (!aberto && formAberto) { setFormAberto(false); return; }
      onOpenChange(aberto);
    }}>
      {/* tela cheia pelas bordas (inset-0): com o zoom do app, 100vw/100dvh ficariam menores que a tela */}
      <DialogContent className="inset-0 flex h-auto max-h-none w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-y-auto rounded-none p-4 sm:rounded-none sm:p-6 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <CalendarPlus className="h-5 w-5 text-blue-600" />
            Clientes c/ Agendamento
          </DialogTitle>
        </DialogHeader>

        {/* "Inserir agendamento": janela à parte, por cima da agenda */}
        <Dialog open={formAberto} onOpenChange={setFormAberto}>
          <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-800">
                <CalendarPlus className="h-5 w-5 text-blue-600" />
                Inserir agendamento
              </DialogTitle>
            </DialogHeader>
          <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Cliente
              <Input
                autoFocus
                required
                list="clientes-agendamento-sugestoes"
                value={cliente}
                onChange={(event) => setCliente(event.target.value.toUpperCase())}
                placeholder="Selecione ou digite um cliente"
                className="uppercase"
              />
              <datalist id="clientes-agendamento-sugestoes">
                {clientesCadastrados.map((item) => (
                  <option key={item.id} value={item.nome} />
                ))}
              </datalist>
            </label>

            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Datas e horários</h3>
              <Button type="button" variant="outline" size="sm" onClick={addDraft} className="h-8 gap-1.5">
                <Plus className="h-4 w-4" />
                Adicionar data
              </Button>
            </div>

            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {drafts.map((draft, index) => (
                <div key={draft.id} className="grid grid-cols-[minmax(0,1fr)_minmax(110px,0.65fr)_36px] items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
                    Data {index + 1}
                    <Input
                      aria-label={`Data do agendamento ${index + 1}`}
                      type="date"
                      required
                      value={draft.date}
                      onChange={(event) => updateDraft(draft.id, { date: event.target.value })}
                      className="bg-white text-sm"
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
                    Horário HRS
                    <Input
                      aria-label={`Horário HRS do agendamento ${index + 1}`}
                      type="time"
                      required
                      value={draft.hrs}
                      onChange={(event) => updateDraft(draft.id, { hrs: event.target.value })}
                      className="bg-white text-sm"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover data ${index + 1}`}
                    title="Remover data"
                    disabled={drafts.length === 1}
                    onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}
                    className="h-9 w-9 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1.5 rounded-md border border-blue-200 bg-blue-50 p-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLoteAberto(true)}
                className="gap-2 border-blue-300 bg-white text-blue-700 hover:bg-blue-100"
              >
                <Camera className="h-4 w-4" />
                Criar pelas fotos dos tickets
              </Button>
              <span className="text-xs text-slate-600">Cole as fotos dos tickets: o app reconhece o cliente pelo modelo e lê a data e o horário de cada um.</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <span className="text-xs text-slate-500">{drafts.length} data{drafts.length !== 1 ? "s" : ""} no lote</span>
              <Button
                type="submit"
                disabled={isSaving || !cliente.trim() || drafts.some((draft) => !draft.date || !draft.hrs)}
                className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                Confirmar e salvar lote
              </Button>
            </div>
          </form>
          </DialogContent>
        </Dialog>

          <section className="flex min-h-[340px] min-w-0 flex-1 flex-col rounded-md border border-slate-200 bg-white" aria-label="Agendamentos salvos do mês">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                <Button type="button" size="sm" onClick={() => abrirInserir()} className="h-8 gap-1.5 bg-blue-600 text-white hover:bg-blue-700">
                  <Plus className="h-4 w-4" /> Inserir agendamento
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setLoteAberto(true)} className="h-8 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50">
                  <Camera className="h-4 w-4" /> Criar pelas fotos
                </Button>
                {/* calendário ou lista */}
                <div role="group" aria-label="Forma de ver a agenda" className="ml-1 flex overflow-hidden rounded-md border border-slate-200">
                  <button
                    type="button" aria-pressed={vista === "calendario"} onClick={() => escolherVista("calendario")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold ${vista === "calendario" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> Calendário
                  </button>
                  <button
                    type="button" aria-pressed={vista === "lista"} onClick={() => escolherVista("lista")}
                    className={`flex items-center gap-1.5 border-l border-slate-200 px-2.5 py-1 text-xs font-semibold ${vista === "lista" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    <List className="h-3.5 w-3.5" /> Lista
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => setMonth((current) => subMonths(current, 1))} className="h-7 w-7">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-28 text-center text-sm font-medium capitalize text-slate-700">
                  {format(month, "MMMM yyyy", { locale: ptBR })}
                </span>
                <Button type="button" variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => setMonth((current) => addMonths(current, 1))} className="h-7 w-7">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={showImportPicker ? "secondary" : "outline"}
                  size="icon"
                  aria-label="Importar carga da programação"
                  aria-expanded={showImportPicker}
                  title="Importar carga da programação"
                  onClick={() => {
                    // a importação aparece na lista
                    if (vista === "calendario") { escolherVista("lista"); setShowImportPicker(true); return; }
                    setShowImportPicker((current) => !current);
                  }}
                  className="h-7 w-7"
                >
                  <ListPlus className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={refreshAgenda} disabled={isRefreshing} className="h-7 gap-1 px-2 text-xs">
                  {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Atualizar
                </Button>
              </div>
            </div>

            <div className={`flex flex-1 flex-col p-2 ${vista === "calendario" ? "min-h-[640px]" : "overflow-y-auto"}`}>
              {isLoadingMonth ? (
                <div className="flex h-full min-h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
              ) : isMonthError ? (
                <p className="py-8 text-center text-sm text-red-600">Não foi possível carregar a agenda deste mês.</p>
              ) : vista === "calendario" ? (
                <AgendaCalendario
                  month={month}
                  itens={monthlyAgendamentos}
                  hojeIso={hojeIso}
                  destaqueIso={destaqueIso}
                  idsComFoto={idsComFoto}
                  corDoStatus={getAppointmentStatus}
                  onAbrir={(item) => setDetalheId(item.id)}
                  onNovoNoDia={(date) => abrirInserir(date)}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {monthlyAgendamentos.length === 0 && !showImportPicker ? (
                    <p className="py-8 text-center text-sm text-slate-500">Nenhum agendamento salvo neste mês.</p>
                  ) : (
                    (() => {
                      const porDia = Object.entries(
                        monthlyAgendamentos.reduce<Record<string, AgendamentoMensalItem[]>>((acc, item) => {
                          acc[item.date] = acc[item.date] ? [...acc[item.date], item] : [item];
                          return acc;
                        }, {})
                      );
                      const anteriores = porDia.filter(([date]) => date < hojeIso);
                      const proximos = porDia.filter(([date]) => date >= hojeIso);
                      const nAnteriores = anteriores.reduce((n, [, items]) => n + items.length, 0);
                      const renderDia = ([date, items]: [string, AgendamentoMensalItem[]]) => {
                        const destaque = date === destaqueIso;
                        return (
                          <div key={date} className={`overflow-hidden rounded-md bg-slate-50 ${destaque ? "border-2 border-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.18)]" : "border border-slate-200"}`}>
                            <div className={`flex items-center justify-between border-b px-2 py-1.5 ${destaque ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-100"}`}>
                              <span className={`text-[11px] font-semibold uppercase tracking-wide ${destaque ? "text-blue-700" : "text-slate-600"}`}>
                                {format(new Date(`${date}T12:00:00`), "EEE dd/MM", { locale: ptBR })}
                                {destaque && <span className="ml-2 normal-case tracking-normal">· próximo dia útil</span>}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="text-[10px] font-medium text-slate-500">{items.length} agendamento{items.length !== 1 ? "s" : ""}</span>
                                {onIrParaDia && (
                                  <button
                                    type="button"
                                    onClick={() => onIrParaDia(date)}
                                    title="Abrir este dia na Programação de Entrega"
                                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                  >
                                    <CalendarDays className="h-3.5 w-3.5" /> Ir para o dia
                                  </button>
                                )}
                              </span>
                            </div>

                            <div className="flex flex-col">
                              {items.map((item) => editando?.id === item.id ? (
                                <div key={item.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-2 py-2 last:border-0">
                                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{item.cliente}</span>
                                  <Input type="date" value={editando.date} onChange={(e) => setEditando({ ...editando, date: e.target.value })} className="h-8 w-[140px] bg-white text-sm" aria-label="Nova data" />
                                  <Input type="time" value={editando.hrs} onChange={(e) => setEditando({ ...editando, hrs: e.target.value })} className="h-8 w-[100px] bg-white text-sm" aria-label="Novo horário" />
                                  <Button type="button" size="sm" disabled={ocupadoId === item.id || !editando.date || !editando.hrs} onClick={() => void salvarEdicao(item)} className="h-8 gap-1 bg-blue-600 px-2 text-xs text-white hover:bg-blue-700">
                                    {ocupadoId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm" aria-label="Cancelar edição" onClick={() => setEditando(null)} className="h-8 px-2 text-xs"><X className="h-3.5 w-3.5" /></Button>
                                </div>
                              ) : (
                                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-slate-100 px-2 py-2 last:border-0">
                                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800" title={item.cliente}>
                                    <button
                                      type="button"
                                      onClick={() => handleStatusClick(item)}
                                      aria-label={`Alterar status de ${item.cliente}: ${getAppointmentStatus(item).label}`}
                                      title={`${getAppointmentStatus(item).label} (clique para alterar)`}
                                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                    >
                                      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${getAppointmentStatus(item).color}`} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setFotoDe(item)}
                                      title={idsComFoto.includes(item.id) ? "Ver a foto do ticket" : "Colar a foto do ticket"}
                                      className="flex min-w-0 items-center gap-1.5 rounded text-left hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                    >
                                      <span className="truncate">{item.cliente}</span>
                                      {idsComFoto.includes(item.id) && <Paperclip aria-label="tem foto do ticket" className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                                    </button>
                                  </span>
                                  <span className="flex items-center justify-end gap-1 whitespace-nowrap text-xs font-semibold text-slate-600">
                                    <Clock3 className="h-3.5 w-3.5 text-blue-600" />
                                    {item.hrs || "—"}
                                  </span>
                                  {confirmarExclusao === item.id ? (
                                    <span className="flex items-center gap-1">
                                      <span className="text-xs font-medium text-red-600">Excluir?</span>
                                      <Button type="button" size="sm" disabled={ocupadoId === item.id} onClick={() => void excluirAgendamento(item)} className="h-7 bg-red-600 px-2 text-xs text-white hover:bg-red-700">
                                        {ocupadoId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sim"}
                                      </Button>
                                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmarExclusao(null)} className="h-7 px-2 text-xs">Não</Button>
                                    </span>
                                  ) : (
                                    <span className="flex items-center">
                                      <Button
                                        type="button" variant="ghost" size="icon" title="Editar data e horário" aria-label={`Editar agendamento de ${item.cliente}`}
                                        onClick={() => { setConfirmarExclusao(null); setEditando({ id: item.id, date: item.date, hrs: item.hrs || "" }); }}
                                        className="h-7 w-7 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        type="button" variant="ghost" size="icon" title="Excluir agendamento" aria-label={`Excluir agendamento de ${item.cliente}`}
                                        onClick={() => { setEditando(null); setConfirmarExclusao(item.id); }}
                                        className="h-7 w-7 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      };
                      return (
                        <>
                          {anteriores.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setMostrarAnteriores((v) => !v)}
                              aria-expanded={mostrarAnteriores}
                              className="flex items-center justify-between rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <span>Anteriores ({nAnteriores})</span>
                              <ChevronDown className={`h-4 w-4 transition-transform ${mostrarAnteriores ? "rotate-180" : ""}`} />
                            </button>
                          )}
                          {mostrarAnteriores && anteriores.map(renderDia)}
                          {proximos.length === 0 && (
                            <p className="py-6 text-center text-sm text-slate-500">Nenhum agendamento daqui para frente neste mês.</p>
                          )}
                          {proximos.map(renderDia)}
                        </>
                      );
                    })()
                  )}

                  {showImportPicker && (
                    <div className="border-t border-slate-200 pt-3">
                      <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">
                        Dia da programação
                        <select
                          value={activeImportDate}
                          onChange={(event) => setImportDate(event.target.value)}
                          className="h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-700"
                        >
                          <option value="">Nenhuma carga disponível</option>
                          {availableImportDates.map((date) => (
                            <option key={date} value={date}>
                              {format(new Date(`${date}T12:00:00`), "EEE dd/MM", { locale: ptBR })}
                              {` · ${monthlyDeliveries.filter((item) => !item.agendamento && item.date === date).length} cargas`}
                            </option>
                          ))}
                        </select>
                      </label>
                      {deliveriesToImport.length === 0 ? (
                        <p className="py-4 text-center text-sm text-slate-500">Não há cargas para importar neste dia.</p>
                      ) : (
                        <div className="mt-2 flex flex-col divide-y divide-slate-100">
                          {deliveriesToImport.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">{item.cliente}</p>
                                <p className="text-xs text-slate-500">{item.hrs || "Sem horário"} · {item.unidade}</p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void handleImportDelivery(item)}
                                disabled={importingId !== null}
                                className="h-8 shrink-0 gap-1 px-2 text-xs"
                              >
                                {importingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                Importar
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
              {monthlyAgendamentos.length} agendamento{monthlyAgendamentos.length !== 1 ? "s" : ""} no mês
            </div>
          </section>
        <AgendamentoDetalheDialog
          item={detalhe}
          temFoto={detalhe ? idsComFoto.includes(detalhe.id) : false}
          status={detalhe ? getAppointmentStatus(detalhe) : null}
          ocupado={detalhe ? ocupadoId === detalhe.id : false}
          onOpenChange={(aberto) => { if (!aberto) setDetalheId(null); }}
          onStatus={handleStatusClick}
          onFoto={(item) => setFotoDe(item)}
          onSalvar={salvarDataHora}
          onExcluir={excluirAgendamento}
          onIrParaDia={onIrParaDia}
        />
        {/* dentro do modal da agenda: fechar a foto volta para a agenda, sem fechar tudo */}
        <AgendamentoFotoDialog
          entrega={fotoDe}
          temFoto={fotoDe ? idsComFoto.includes(fotoDe.id) : false}
          onOpenChange={(aberto) => { if (!aberto) setFotoDe(null); }}
          onMudou={() => void queryClient.invalidateQueries({ queryKey: ["agendamento-fotos", monthKey] })}
        />
        <AgendamentoFotosLote
          open={loteAberto}
          cliente={cliente}
          clientes={clientesCadastrados.map((item) => item.nome)}
          onOpenChange={setLoteAberto}
          criar={({ date, hrs, cliente: nome }) => createEntrega.mutateAsync({
            data: { date, cliente: nome, hrs, unidade: "MATRIZ", agendamento: true },
          })}
          onCriados={(datas) => void atualizarDepois(Array.from(new Set(datas)))}
        />
      </DialogContent>
    </Dialog>
  );
}