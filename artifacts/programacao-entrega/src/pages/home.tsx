import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, addDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, Printer, WifiOff, RefreshCw, FolderDown, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListEntregas, useCreateEntrega, useUpdateEntrega, getListEntregasQueryKey, type Entrega } from "@workspace/api-client-react";
import { DeliveryTable } from "@/components/delivery-table";
import { PrintView } from "@/components/print-view";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RelatorioModal } from "@/components/relatorio-modal";
import { OpcoesMenu } from "@/components/opcoes-menu";
import { useSavePdf } from "@/hooks/use-save-pdf";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useBgColor } from "@/hooks/use-bg-color";
import { useConnectionStatus } from "@/hooks/use-connection-status";
import { getPendingDeliveries, removePendingDelivery } from "@/lib/offline-deliveries";
import { saveOfflineSnapshot, type OfflineSnapshot } from "@/lib/offline-snapshot";

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const FULL_SYNC_KEY = "entregas-full-sync-date";

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

function dateRangeFromFirstDay() {
  const dates: string[] = [];
  const cursor = new Date("2020-01-01T12:00:00");
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  while (cursor <= today) {
    dates.push(format(cursor, "yyyy-MM-dd"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function fetchAllDeliveriesByDate() {
  const dates = dateRangeFromFirstDay();
  const pending = getPendingDeliveries();
  const batches: string[][] = [];
  for (let index = 0; index < dates.length; index += 10) batches.push(dates.slice(index, index + 10));

  for (const batch of batches) {
    const results = await Promise.all(batch.map(async (date) => {
      try {
        const response = await fetch(`${API_BASE}/api/entregas?date=${date}`, { cache: "no-store" });
        return response.ok ? { date, deliveries: await response.json() as Entrega[] } : null;
      } catch {
        return null;
      }
    }));
    results.forEach((result) => {
      if (result) {
        const localPending = pending
          .filter((item) => item.data.date === result.date)
          .map((item) => ({
            ...item.data,
            id: item.temporaryId,
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
          } as Entrega));
        saveDeliveryCache(result.date, [...result.deliveries, ...localPending]);
      }
    });
  }
  localStorage.setItem(FULL_SYNC_KEY, new Date().toISOString().slice(0, 10));
}
export default function Home() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const { color: bgColor } = useBgColor();
  const { savePdf, status: pdfStatus, resetLocation } = useSavePdf();
  const { canInstall, install } = usePwaInstall();
  const connectionStatus = useConnectionStatus();
  const createEntrega = useCreateEntrega();
  const updateEntrega = useUpdateEntrega();
  const syncingRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [movingDeliveries, setMovingDeliveries] = useState(false);

  const dateStr = format(date, "yyyy-MM-dd");

  useEffect(() => {
    setSelectedIds(new Set());
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
            }));
          const serverDeliveries = snapshot.entregas.filter((delivery) => delivery.date === date);
          const next = [...serverDeliveries, ...localPending];
          saveDeliveryCache(date, next);
          queryClient.setQueryData(getListEntregasQueryKey({ date }), next);
        });
      })
      .catch(async () => {
        if (localStorage.getItem(FULL_SYNC_KEY) === new Date().toISOString().slice(0, 10)) return;
        await fetchAllDeliveriesByDate();
        queryClient.setQueryData(
          getListEntregasQueryKey({ date: dateStr }),
          getDeliveryCache(dateStr) ?? []
        );
      });
  }, [isOnline, queryClient, dateStr]);

  useEffect(() => {
    if (entregas) {
      try { localStorage.setItem(`entregas-cache-${dateStr}`, JSON.stringify(entregas)); } catch {}
    }
  }, [dateStr, entregas]);

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
    <div className="min-h-screen flex flex-col items-center" style={{ backgroundColor: bgColor }}>
      {/* Screen header — hidden when printing */}
      <header className="print-hidden w-full bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-sm">
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
          <div className="flex items-center bg-slate-100 rounded-md p-1 border border-slate-200">
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
                ? "Vercel e Render funcionando"
                : connectionStatus === "error"
                  ? "Falha no Vercel ou Render"
                  : "Verificando Vercel e Render"
            }
            aria-label={
              connectionStatus === "ok"
                ? "Vercel e Render funcionando"
                : connectionStatus === "error"
                  ? "Falha no Vercel ou Render"
                  : "Verificando Vercel e Render"
            }
          />

          {canInstall && (
            <Button variant="outline" size="sm" onClick={install} className="h-10 gap-2 text-blue-700 border-blue-300 hover:bg-blue-50" title="Instalar aplicativo">
              <Download className="w-5 h-5" />
              Instalar
            </Button>
          )}

          <OpcoesMenu />

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!isOnline || selectedIds.size === 0 || movingDeliveries}
                className="h-10 gap-2 text-blue-700 border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                title={selectedIds.size === 0 ? "Selecione uma ou mais cargas" : "Escolher novo dia para as cargas"}
              >
                {movingDeliveries ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
                Alterar dia{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
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
            </PopoverContent>
          </Popover>

          <RelatorioModal onNavigateDate={(d) => setDate(new Date(d + "T12:00:00"))} />

          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={!isOnline}
            className="h-10 w-10 text-slate-700 border-slate-300 hover:bg-slate-100 disabled:opacity-50"
            data-testid="button-refresh"
            title={!isOnline ? "Sem conexão" : "Atualizar"}
          >
            <RefreshCw className="w-5 h-5" />
          </Button>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => savePdf(entregas || [], dateStr)}
              disabled={pdfStatus === "saving"}
              className={cn(
                "h-10 w-10 border-slate-300 hover:bg-slate-100",
                pdfStatus === "error" ? "text-red-600 border-red-300" : "text-slate-700"
              )}
              title={pdfStatus === "error" ? "Erro ao salvar PDF" : "Salvar PDF"}
              data-testid="button-save-pdf"
            >
              {pdfStatus === "saving" ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderDown className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={resetLocation}
              className="h-10 w-10 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              title="Redefinir pasta de destino"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={handlePrint}
            className="h-10 w-10 text-slate-700 border-slate-300 hover:bg-slate-100"
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
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
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
              selectedIds={selectedIds}
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
