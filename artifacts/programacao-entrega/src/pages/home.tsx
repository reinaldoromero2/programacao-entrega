import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, addDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, Printer, WifiOff, RefreshCw, FolderDown, Download, BellRing, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListEntregas, useCreateEntrega, useUpdateEntrega, useDeleteEntrega, getListEntregasQueryKey, type Entrega } from "@workspace/api-client-react";
import { DeliveryTable } from "@/components/delivery-table";
import { PrintView } from "@/components/print-view";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RelatorioModal } from "@/components/relatorio-modal";
import { OpcoesMenu } from "@/components/opcoes-menu";
import { ClientesAgendamentoModal } from "@/components/clientes-agendamento-modal";
import { LembretesModal } from "@/components/lembretes-modal";
import { RomaneioButton } from "@/components/romaneio-button";
import { useSavePdf } from "@/hooks/use-save-pdf";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useBgColor } from "@/hooks/use-bg-color";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { getPendingDeliveries, removePendingDelivery } from "@/lib/offline-deliveries";
import { saveOfflineSnapshot, type OfflineSnapshot } from "@/lib/offline-snapshot";
import { getReminders, parseReminders, saveReminders, type Reminder } from "@/lib/reminders";

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");
// cópia geral do banco para o modo offline: no máximo a cada 10 min
const SNAPSHOT_EM_KEY = "sync-snapshot-em";
const SNAPSHOT_INTERVALO_MS = 10 * 60 * 1000;
const REMINDERS_MIGRATION_KEY = "programacao-entrega-reminders-shared-migrated";
const REMINDER_SYNC_ERROR = "Sem conexão com o servidor de recados. O conteúdo exibido é deste dispositivo e ainda não está compartilhado.";

async function fetchSharedReminders(): Promise<Reminder[]> {
  const response = await fetch(`${API_BASE}/api/lembretes`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseReminders(await response.json());
}

function getDeliveryCache(date: string): Entrega[] | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(`entregas-cache-${date}`) || "null");
    return Array.isArray(cached) ? cached as Entrega[] : undefined;
  } catch {
    return undefined;
  }
}

function saveDeliveryCache(date: string, deliveries: Entrega[]) {
  try { localStorage.setItem(`entregas-cache-${date}`, JSON.stringify(deliveries)); } catch {}
}

export default function Home() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [agendamentoOpen, setAgendamentoOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const backgroundSettings = useBgColor();
  const {
    color: bgColor,
    imageUrl: bgImage,
    themeRows,
    acrylic,
  } = backgroundSettings;
  const { savePdf, status: pdfStatus } = useSavePdf();
  const { canInstall, install } = usePwaInstall();
  const connectionStatus = useConnectionStatus();
  const isDesktopApp = window.location.protocol === "file:";
  const createEntrega = useCreateEntrega();
  const updateEntrega = useUpdateEntrega();
  const deleteEntrega = useDeleteEntrega();
  const syncingRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [movingDeliveries, setMovingDeliveries] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>(getReminders);
  const [reminderSyncError, setReminderSyncError] = useState<string | null>(null);

  const dateStr = format(date, "yyyy-MM-dd");
  const dayReminders = reminders.filter((reminder) => reminder.date === dateStr);

  useEffect(() => {
    saveReminders(reminders);
  }, [reminders]);

  const addReminder = async (reminder: Omit<Reminder, "id">) => {
    const response = await fetch(`${API_BASE}/api/lembretes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reminder),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const [created] = parseReminders([await response.json()]);
    if (!created) throw new Error("Resposta inválida do servidor");
    setReminders((current) => current.some((item) => item.id === created.id) ? current : [...current, created]);
    setReminderSyncError(null);
  };

  const editReminder = async (id: string, reminder: Omit<Reminder, "id">) => {
    const response = await fetch(`${API_BASE}/api/lembretes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reminder),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const [updated] = parseReminders([await response.json()]);
    if (!updated) throw new Error("Resposta inválida do servidor");
    setReminders((current) => current.map((item) => item.id === updated.id ? updated : item));
    setReminderSyncError(null);
  };

  const removeReminder = async (id: string) => {
    const response = await fetch(`${API_BASE}/api/lembretes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setReminders((current) => current.filter((reminder) => reminder.id !== id));
    setReminderSyncError(null);
  };

  useEffect(() => {
    let cancelled = false;
    let syncInProgress = false;

    const syncReminders = async () => {
      if (!isOnline) {
        setReminderSyncError(REMINDER_SYNC_ERROR);
        return;
      }
      if (syncInProgress) return;
      syncInProgress = true;

      try {
        let sharedReminders = await fetchSharedReminders();
        if (localStorage.getItem(REMINDERS_MIGRATION_KEY) !== "true") {
          for (const reminder of getReminders()) {
            const response = await fetch(`${API_BASE}/api/lembretes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date: reminder.date, text: reminder.text }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
          }
          localStorage.setItem(REMINDERS_MIGRATION_KEY, "true");
          sharedReminders = await fetchSharedReminders();
        }

        if (!cancelled) {
          setReminders(sharedReminders);
          setReminderSyncError(null);
        }
      } catch {
        if (!cancelled) setReminderSyncError(REMINDER_SYNC_ERROR);
      } finally {
        syncInProgress = false;
      }
    };

    void syncReminders();
    const interval = window.setInterval(() => void syncReminders(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isOnline]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [dateStr]);

  const { data: entregas, isLoading, isError } = useListEntregas(
    { date: dateStr },
    {
      query: {
        queryKey: getListEntregasQueryKey({ date: dateStr }),
        initialData: () => getDeliveryCache(dateStr) ?? [],
        enabled: isOnline,
        refetchOnReconnect: true,
      }
    }
  );

  useEffect(() => {
    if (!isOnline) return;
    // a cópia geral para o modo offline é pesada: no máximo a cada 10 min (não a cada troca de dia)
    const ultima = Number(localStorage.getItem(SNAPSHOT_EM_KEY) || 0);
    if (Date.now() - ultima < SNAPSHOT_INTERVALO_MS) return;
    localStorage.setItem(SNAPSHOT_EM_KEY, String(Date.now()));

    void fetch(`${API_BASE}/api/sync/snapshot`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<OfflineSnapshot> : Promise.reject(new Error("snapshot unavailable")))
      .then((snapshot) => {
        saveOfflineSnapshot(snapshot);
        const pending = getPendingDeliveries();
        const dates = new Set(snapshot.entregas.map((delivery) => delivery.date));
        pending.forEach((item) => dates.add(item.data.date));

        dates.forEach((date) => {
          const localPending = pending
            .filter((item) => item.data.date === date)
            .map((item): Entrega => ({
              id: item.temporaryId,
              date: item.data.date,
              agendamento: false,
              sortOrder: item.data.sortOrder ?? 0,
              checked: item.data.checked ?? "none",
              cliente: item.data.cliente,
              hrs: item.data.hrs ?? null,
              obs: item.data.obs ?? null,
              motorista: item.data.motorista ?? null,
              placa: item.data.placa ?? null,
              unidade: item.data.unidade,
              nf: item.data.nf ?? "none",
              cg: item.data.cg ?? "none",
              v: item.data.v ?? null,
              divergencias: item.data.divergencias ?? null,
              frete: item.data.frete ?? null,
              statusManual: null,
            }));
          const serverDeliveries = snapshot.entregas.filter((delivery) => delivery.date === date);
          const next = [...serverDeliveries, ...localPending];
          saveDeliveryCache(date, next);
          queryClient.setQueryData(getListEntregasQueryKey({ date }), next);
        });
      })
      .catch(() => {
        // sem a cópia geral, fica com o que já está guardado no aparelho. (Antes havia um plano B
        // que pedia dia por dia desde 2020 — ~2.500 pedidos — e fazia o Cloudflare bloquear a rede.)
      });
  }, [isOnline, queryClient, dateStr]);

  useEffect(() => {
    if (entregas) {
      try { localStorage.setItem(`entregas-cache-${dateStr}`, JSON.stringify(entregas)); } catch {}
    }
  }, [dateStr, entregas]);

  // a fila do que foi feito com o servidor fora terminou de subir: busca tudo de novo
  useEffect(() => {
    const aoEnviar = () => { void queryClient.invalidateQueries(); };
    window.addEventListener("api-fila-enviada", aoEnviar);
    return () => window.removeEventListener("api-fila-enviada", aoEnviar);
  }, [queryClient]);

  useEffect(() => {
    if (!isOnline || syncingRef.current) return;
    const pending = getPendingDeliveries();
    if (pending.length === 0) return;

    syncingRef.current = true;
    void (async () => {
      for (const item of pending) {
        try {
          const created = await createEntrega.mutateAsync({ data: item.data });
          removePendingDelivery(item.temporaryId);
          const queryKey = getListEntregasQueryKey({ date: item.data.date });
          queryClient.setQueryData<Entrega[]>(queryKey, (old) => [
            ...(old ?? []).filter((delivery) => delivery.id !== item.temporaryId),
            created,
          ]);
          await queryClient.invalidateQueries({ queryKey });
        } catch {
          break;
        }
      }
      syncingRef.current = false;
    })();
  }, [createEntrega, dateStr, isOnline]);

  const goPreviousDay = () => setDate((d) => subDays(d, 1));
  const goNextDay = () => setDate((d) => addDays(d, 1));
  const goToToday = () => setDate(new Date());

  const toggleSelection = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveSelectedDeliveries = async (targetDate: Date) => {
    const targetDateStr = format(targetDate, "yyyy-MM-dd");
    if (!isOnline || selectedIds.size === 0 || targetDateStr === dateStr || movingDeliveries) return;

    setMovingDeliveries(true);
    try {
      await Promise.all(Array.from(selectedIds, (id) => updateEntrega.mutateAsync({ id, data: { date: targetDateStr } })));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date: dateStr }) }),
        queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date: targetDateStr }) }),
      ]);
      setSelectedIds(new Set());
      setDate(targetDate);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      window.alert(`Não foi possível alterar o dia das cargas selecionadas.\n\n${message}`);
    } finally {
      setMovingDeliveries(false);
    }
  };

  const deleteSelectedDeliveries = async () => {
    if (!isOnline || selectedIds.size === 0 || movingDeliveries) return;

    const nomes = (entregas ?? []).filter((e) => selectedIds.has(e.id)).map((e) => `• ${e.cliente || "(sem cliente)"}`);
    const qtd = selectedIds.size;
    if (!window.confirm(`Excluir ${qtd} carga${qtd !== 1 ? "s" : ""} de ${format(date, "dd/MM/yyyy")}?\n\n${nomes.join("\n")}\n\nIsso não pode ser desfeito.`)) return;

    setMovingDeliveries(true);
    // uma de cada vez: se uma falhar, só as que faltam continuam selecionadas para tentar de novo
    const faltam = new Set(selectedIds);
    try {
      for (const id of selectedIds) {
        await deleteEntrega.mutateAsync({ id });
        faltam.delete(id);
      }
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      setSelectedIds(faltam);
      window.alert(`Não foi possível excluir ${faltam.size} das ${qtd} cargas (as que faltam continuam selecionadas).\n\n${message}`);
    } finally {
      await queryClient.invalidateQueries({ queryKey: getListEntregasQueryKey({ date: dateStr }) });
      setMovingDeliveries(false);
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  const handlePrint = () => {
    const electron = (window as any)?.require?.("electron");

    if (electron) {
      const { ipcRenderer } = electron;
      ipcRenderer.invoke("print-window");
      return;
    }

    window.print();
  };

  return (
    <div
      className={cn("app-shell min-h-screen flex flex-col items-center", acrylic && "app-acrylic")}
      style={{
        backgroundColor: bgColor,
        backgroundImage: bgImage ? `url("${bgImage}")` : undefined,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
      }}
    >
      {/* Screen header — hidden when printing */}
      <header
        className="app-acrylic-surface print-hidden w-full border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm"
        style={{
          backgroundColor: acrylic || bgImage ? "rgba(255, 255, 255, 0.42)" : bgColor,
          backdropFilter: acrylic || bgImage ? "blur(16px) saturate(1.3)" : undefined,
          WebkitBackdropFilter: acrylic || bgImage ? "blur(16px) saturate(1.3)" : undefined,
        }}
      >
        {/* LEFT — título + navegação de data */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-slate-800">
            <div className="bg-blue-600 text-white p-2 rounded flex items-center justify-center">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">PROGRAMAÇÃO DE ENTREGA</h1>
              <p className="text-sm text-slate-500 font-medium">
                Controle Logístico Diário <span className="text-xs text-slate-400">v{import.meta.env.VITE_APP_VERSION}</span>
              </p>
            </div>
          </div>

          <div className="w-px h-10 bg-slate-200" />

          {/* Date navigator */}
          <div className="app-acrylic-surface flex items-center bg-slate-100 rounded-md p-1 border border-slate-200">
            <Button variant="ghost" size="icon" onClick={goPreviousDay} className="h-8 w-8 text-slate-600 hover:text-slate-900 hover:bg-white rounded" data-testid="button-prev-day">
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  className="px-4 flex flex-col items-center justify-center min-w-[130px] rounded-md hover:bg-white transition-colors cursor-pointer py-1 group"
                  data-testid="button-open-calendar"
                >
                  <span className="text-sm font-bold text-slate-800 uppercase tabular-nums group-hover:text-blue-600 transition-colors">
                    {format(date, "dd/MM/yyyy")}
                  </span>
                  <span className="text-xs text-slate-500 capitalize group-hover:text-blue-400 transition-colors">
                    {format(date, "EEEE", { locale: ptBR })}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
                <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Selecionar data</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { goToToday(); setCalendarOpen(false); }}
                    className="h-6 text-xs text-blue-600 hover:text-blue-700 font-semibold px-2"
                  >
                    Hoje
                  </Button>
                </div>
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => { if (d) { setDate(d); setCalendarOpen(false); } }}
                  captionLayout="dropdown"
                  locale={ptBR}
                  fromYear={2020}
                  toYear={2035}
                  defaultMonth={date}
                  classNames={{ day: "group/day relative aspect-square h-full w-full select-none p-0 text-center" }}
                />
              </PopoverContent>
            </Popover>

            <Button variant="ghost" size="icon" onClick={goNextDay} className="h-8 w-8 text-slate-600 hover:text-slate-900 hover:bg-white rounded" data-testid="button-next-day">
              <ChevronRight className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-slate-300 mx-2" />

            <Button variant="ghost" size="sm" onClick={goToToday} className="h-8 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-white rounded px-3" data-testid="button-today">
              HOJE
            </Button>
          </div>
        </div>

        {dayReminders.length > 0 && (
          <div className="mx-3 min-w-0 max-w-[300px] flex-1">
            <div role="status" className="flex items-start gap-2 rounded-md border border-red-700 bg-red-600 px-3 py-2 text-white shadow-md">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="max-h-12 min-w-0 flex-1 list-disc space-y-1 overflow-y-auto pl-4 text-xs font-semibold leading-4 marker:text-white">
                {dayReminders.map((reminder) => (
                  <li key={reminder.id} className="break-words">{reminder.text}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* RIGHT — ações */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "w-3 h-3 rounded-full border border-white shadow-sm",
              connectionStatus === "ok" && "bg-emerald-500",
              connectionStatus === "error" && "bg-red-500",
              connectionStatus === "checking" && "bg-amber-400"
            )}
            title={
              connectionStatus === "ok"
                ? isDesktopApp ? "Render funcionando" : "Vercel e Render funcionando"
                : connectionStatus === "error"
                  ? isDesktopApp ? "Falha na API Render" : "Falha no Vercel ou Render"
                  : "Verificando Vercel e Render"
            }
            aria-label={
              connectionStatus === "ok"
                ? isDesktopApp ? "Render funcionando" : "Vercel e Render funcionando"
                : connectionStatus === "error"
                  ? isDesktopApp ? "Falha na API Render" : "Falha no Vercel ou Render"
                  : "Verificando Vercel e Render"
            }
          />

          {canInstall && (
            <Button variant="outline" size="sm" onClick={install} className="h-10 gap-2 text-blue-700 border-blue-300 hover:bg-blue-50" title="Instalar aplicativo">
              <Download className="w-5 h-5" />
              Instalar
            </Button>
          )}

          <OpcoesMenu backgroundSettings={backgroundSettings} />

          <Button
            variant="outline"
            size="icon"
            onClick={() => setRemindersOpen(true)}
            className="h-10 w-10 border-red-700 bg-red-600 text-white hover:bg-red-700 hover:text-white"
            title="Lembretes"
            aria-label="Lembretes"
            data-testid="button-reminders"
          >
            <BellRing className="h-4 w-4" />
          </Button>
          <LembretesModal
            open={remindersOpen}
            onOpenChange={setRemindersOpen}
            selectedDate={dateStr}
            reminders={reminders}
            syncError={reminderSyncError}
            onAdd={addReminder}
            onEdit={editReminder}
            onRemove={removeReminder}
          />

          <Button
            variant="outline"
            size="icon"
            onClick={() => setAgendamentoOpen(true)}
            className="h-10 w-10 border-amber-500 bg-amber-400 text-amber-950 hover:bg-amber-500 hover:text-amber-950"
            title="Agendamentos"
            aria-label="Agendamentos"
            data-testid="button-agendamentos"
          >
            <span className="text-sm font-bold">A</span>
          </Button>
          <ClientesAgendamentoModal open={agendamentoOpen} onOpenChange={setAgendamentoOpen} />

          {selectionMode && selectedIds.size > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!isOnline || movingDeliveries}
                  className="h-10 w-10 border-orange-700 bg-orange-600 text-white hover:bg-orange-700 hover:text-white disabled:opacity-50"
                  title={`Escolher novo dia para ${selectedIds.size} carga${selectedIds.size !== 1 ? "s" : ""}`}
                  aria-label={`Escolher novo dia para ${selectedIds.size} carga${selectedIds.size !== 1 ? "s" : ""}`}
                  data-testid="button-change-delivery-day"
                >
                  {movingDeliveries ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <div className="p-3 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Novo dia das cargas</p>
                  <p className="text-xs text-slate-400 mt-1">{selectedIds.size} carga{selectedIds.size !== 1 ? "s" : ""} selecionada{selectedIds.size !== 1 ? "s" : ""}</p>
                </div>
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(targetDate) => { if (targetDate) void moveSelectedDeliveries(targetDate); }}
                  captionLayout="dropdown"
                  locale={ptBR}
                  fromYear={2020}
                  toYear={2035}
                  defaultMonth={date}
                />
                <div className="p-3 border-t border-slate-100">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isOnline || movingDeliveries}
                    onClick={() => void deleteSelectedDeliveries()}
                    className="w-full gap-2 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                    data-testid="button-delete-selected"
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir {selectedIds.size} selecionada{selectedIds.size !== 1 ? "s" : ""}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="icon"
              disabled={!isOnline || movingDeliveries}
              onClick={() => {
                if (selectionMode) {
                  setSelectedIds(new Set());
                  setSelectionMode(false);
                } else {
                  setSelectionMode(true);
                }
              }}
              className={cn(
                "h-10 w-10 border-orange-700 bg-orange-600 text-white hover:bg-orange-700 hover:text-white disabled:opacity-50",
                selectionMode && "ring-2 ring-orange-200"
              )}
              title={selectionMode ? "Cancelar seleção" : "Selecionar cargas para alterar o dia"}
              aria-label={selectionMode ? "Cancelar seleção" : "Selecionar cargas para alterar o dia"}
              aria-pressed={selectionMode}
              data-testid="button-change-delivery-day"
            >
              {movingDeliveries ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
            </Button>
          )}

          <RomaneioButton />

          <RelatorioModal onNavigateDate={(d) => setDate(new Date(d + "T12:00:00"))} />

          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={!isOnline}
            className="h-10 w-10 border-pink-700 bg-pink-600 text-white hover:bg-pink-700 hover:text-white disabled:opacity-50"
            data-testid="button-refresh"
            title={!isOnline ? "Sem conexão" : "Atualizar"}
          >
            <RefreshCw className="w-5 h-5" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => savePdf(entregas || [], dateStr)}
            disabled={pdfStatus === "saving"}
            className={cn(
              "h-10 w-10",
              pdfStatus === "error"
                ? "border-red-700 bg-red-600 text-white hover:bg-red-700 hover:text-white"
                : "border-teal-700 bg-teal-600 text-white hover:bg-teal-700 hover:text-white"
            )}
            title={pdfStatus === "error" ? "Erro ao salvar PDF" : "Salvar PDF"}
            data-testid="button-save-pdf"
          >
            {pdfStatus === "saving" ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderDown className="w-5 h-5" />}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={handlePrint}
            className="h-10 w-10 border-blue-700 bg-blue-600 text-white hover:bg-blue-700 hover:text-white"
            data-testid="button-print"
            title="Imprimir"
          >
            <Printer className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="print-hidden w-full bg-amber-500 text-white px-6 py-2 flex items-center justify-center gap-2 text-sm font-medium">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          Sem conexão — exibindo dados salvos localmente. Edições serão sincronizadas quando a conexão voltar.
        </div>
      )}

      {/* Screen table */}
      <main className="print-hidden w-full max-w-[1400px] flex-1 p-6">
        <div className={cn(
          "app-acrylic-surface rounded-lg shadow-sm border border-slate-200 overflow-hidden",
          acrylic ? "bg-white/35 backdrop-blur-xl" : bgImage ? "bg-white/70 backdrop-blur-[1px]" : "bg-white"
        )}>
          {isLoading ? (
            <div className="w-full h-[400px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : isError && !entregas ? (
            <div className="w-full h-[400px] flex flex-col items-center justify-center gap-3 text-slate-500">
              <p className="text-sm font-medium">Erro ao carregar entregas. Verifique a conexão e tente novamente.</p>
              <button
                onClick={handleRefresh}
                className="text-xs text-blue-600 hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <DeliveryTable
              entregas={entregas || []}
              date={dateStr}
              backgroundImageEnabled={Boolean(bgImage)}
              rowThemeColor={themeRows ? bgColor : null}
              acrylicEnabled={acrylic}
              selectedIds={selectedIds}
              selectionMode={selectionMode}
              onToggleSelection={toggleSelection}
            />
          )}
        </div>
      </main>

      {/* Print-only view */}
      <div className="print-only">
        <PrintView entregas={entregas || []} date={dateStr} />
      </div>
    </div>
  );
}
