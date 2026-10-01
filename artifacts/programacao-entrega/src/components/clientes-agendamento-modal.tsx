import { useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock3, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getListEntregasQueryKey, useCreateEntrega, useUpdateEntrega, type Entrega } from "@workspace/api-client-react";
import { useClientesCadastro } from "@/components/clientes-cadastro-modal";
import { toast } from "@/hooks/use-toast";
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
  cg: Entrega["cg"];
  statusManual: Entrega["statusManual"];
}

async function fetchAgendamentosDoMes(month: Date): Promise<AgendamentoMensalItem[]> {
  const from = format(startOfMonth(month), "yyyy-MM-dd");
  const to = format(endOfMonth(month), "yyyy-MM-dd");
  const response = await fetch(`${API_BASE}/api/entregas?from=${from}&to=${to}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Não foi possível carregar a programação de ${format(month, "MMMM yyyy", { locale: ptBR })}.`);
  const deliveries = await response.json() as Entrega[];

  return deliveries
    .filter((delivery) => delivery.agendamento)
    .map(({ id, date, cliente, hrs, cg, statusManual }) => ({ id, date, cliente, hrs, cg, statusManual }))
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
}

export function ClientesAgendamentoModal({ open, onOpenChange }: ClientesAgendamentoModalProps) {
  const queryClient = useQueryClient();
  const createEntrega = useCreateEntrega();
  const updateEntrega = useUpdateEntrega();
  const { data: clientesCadastrados = [] } = useClientesCadastro();
  const [cliente, setCliente] = useState("");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [nextDraftId, setNextDraftId] = useState(1);
  const [drafts, setDrafts] = useState<AgendamentoRascunho[]>([
    { id: 0, date: format(new Date(), "yyyy-MM-dd"), hrs: "" },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const monthKey = format(month, "yyyy-MM");
  const { data: monthlyAgendamentos = [], isLoading: isLoadingMonth, isError: isMonthError } = useQuery({
    queryKey: ["clientes-agendamento-mensal", monthKey],
    queryFn: () => fetchAgendamentosDoMes(month),
    enabled: open,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const refreshAgenda = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: ["clientes-agendamento-mensal", monthKey], type: "active" });
    } finally {
      setIsRefreshing(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <CalendarPlus className="h-5 w-5 text-blue-600" />
            Clientes c/ Agendamento
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)]">
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

          <section className="flex min-h-[340px] min-w-0 flex-col rounded-md border border-slate-200 bg-white" aria-label="Agendamentos salvos do mês">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                Agenda do mês
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
                <Button type="button" variant="outline" size="sm" onClick={refreshAgenda} disabled={isRefreshing} className="h-7 gap-1 px-2 text-xs">
                  {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Atualizar
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {isLoadingMonth ? (
                <div className="flex h-full min-h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
              ) : isMonthError ? (
                <p className="py-8 text-center text-sm text-red-600">Não foi possível carregar a agenda deste mês.</p>
              ) : monthlyAgendamentos.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">Nenhum agendamento salvo neste mês.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {Object.entries(
                    monthlyAgendamentos.reduce<Record<string, AgendamentoMensalItem[]>>((acc, item) => {
                      const key = item.date;
                      acc[key] = acc[key] ? [...acc[key], item] : [item];
                      return acc;
                    }, {})
                  ).map(([date, items]) => (
                    <div key={date} className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-2 py-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {format(new Date(`${date}T12:00:00`), "EEE dd/MM", { locale: ptBR })}
                        </span>
                        <span className="text-[10px] font-medium text-slate-500">{items.length} agendamento{items.length !== 1 ? "s" : ""}</span>
                      </div>

                      <div className="flex flex-col">
                        {items.map((item) => (
                          <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_58px] items-center gap-2 border-b border-slate-100 px-2 py-2 last:border-0">
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
                              <span className="truncate">{item.cliente}</span>
                            </span>
                            <span className="flex items-center justify-end gap-1 whitespace-nowrap text-xs font-semibold text-slate-600">
                              <Clock3 className="h-3.5 w-3.5 text-blue-600" />
                              {item.hrs || "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
              {monthlyAgendamentos.length} entrega{monthlyAgendamentos.length !== 1 ? "s" : ""} no mês
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}