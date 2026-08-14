import { useState } from "react";
import { format, addDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2, Printer, WifiOff, RefreshCw, FolderDown, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListEntregas, getListEntregasQueryKey } from "@workspace/api-client-react";
import { DeliveryTable } from "@/components/delivery-table";
import { PrintView } from "@/components/print-view";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RelatorioModal } from "@/components/relatorio-modal";
import { OpcoesMenu } from "@/components/opcoes-menu";
import { useSavePdf } from "@/hooks/use-save-pdf";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export default function Home() {
  const [date, setDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const { savePdf, status: pdfStatus, resetLocation } = useSavePdf();
  const { canInstall, install } = usePwaInstall();

  const dateStr = format(date, "yyyy-MM-dd");

  const { data: entregas, isLoading, isError } = useListEntregas(
    { date: dateStr },
    { query: { queryKey: getListEntregasQueryKey({ date: dateStr }) } }
  );

  const goPreviousDay = () => setDate((d) => subDays(d, 1));
  const goNextDay = () => setDate((d) => addDays(d, 1));
  const goToToday = () => setDate(new Date());

  const handleRefresh = () => {
    window.location.reload();
  };

  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center">
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
              <p className="text-sm text-slate-500 font-medium">Controle Logístico Diário</p>
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
          {canInstall && (
            <Button variant="outline" size="sm" onClick={install} className="h-10 gap-2 text-blue-700 border-blue-300 hover:bg-blue-50" title="Instalar aplicativo">
              <Download className="w-5 h-5" />
              Instalar
            </Button>
          )}

          <OpcoesMenu />

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
          Sem conexão — exibindo dados salvos localmente. Edições serão perdidas.
        </div>
      )}

      {/* Screen table */}
      <main className="print-hidden w-full max-w-[1400px] flex-1 p-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {isLoading ? (
            <div className="w-full h-[400px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : isError ? (
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
            <DeliveryTable entregas={entregas || []} date={dateStr} />
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
