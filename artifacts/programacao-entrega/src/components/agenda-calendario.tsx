import { addDays, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Paperclip, Plus } from "lucide-react";
import { feriado } from "@/lib/feriados";

// Agenda do mês em calendário (como o do Outlook): uma célula por dia, de domingo a sábado, com os
// agendamentos do dia em ordem de horário. Hoje fica em azul; o próximo dia útil, com borda.

export interface ItemCalendario {
  id: number;
  date: string;
  cliente: string;
  hrs: string | null;
}

interface Props<T extends ItemCalendario> {
  month: Date;
  itens: T[];
  hojeIso: string;
  destaqueIso: string;
  idsComFoto: number[];
  corDoStatus: (item: T) => { label: string; color: string };
  onAbrir: (item: T) => void;
  onNovoNoDia: (date: string) => void;
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function AgendaCalendario<T extends ItemCalendario>({ month, itens, hojeIso, destaqueIso, idsComFoto, corDoStatus, onAbrir, onNovoNoDia }: Props<T>) {
  const inicio = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const fim = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const dias: Date[] = [];
  for (let d = inicio; d <= fim; d = addDays(d, 1)) dias.push(d);
  const porDia = itens.reduce<Record<string, T[]>>((acc, item) => {
    (acc[item.date] = acc[item.date] || []).push(item);
    return acc;
  }, {});
  Object.values(porDia).forEach((lista) => lista.sort((a, b) => (a.hrs || "99").localeCompare(b.hrs || "99") || a.cliente.localeCompare(b.cliente)));
  const semanas = dias.length / 7;

  return (
    // no celular a grade não espreme: rola para o lado
    <div className="flex min-h-0 flex-1 overflow-x-auto rounded-md border border-slate-200 bg-white">
    <div className="flex min-w-[760px] flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {DIAS.map((nome, i) => (
          <div key={nome} className={`px-2 py-1.5 text-xs font-semibold capitalize ${i === 0 || i === 6 ? "text-slate-400" : "text-slate-600"}`}>{nome}</div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${semanas}, minmax(110px, 1fr))` }}>
        {dias.map((dia) => {
          const iso = format(dia, "yyyy-MM-dd");
          const doMes = isSameMonth(dia, month);
          const hoje = iso === hojeIso;
          const destaque = iso === destaqueIso && doMes;
          const nomeFeriado = feriado(dia);
          const fimDeSemana = dia.getDay() === 0 || dia.getDay() === 6 || !!nomeFeriado;
          const lista = doMes ? porDia[iso] || [] : [];
          return (
            <div
              key={iso}
              className={`group relative flex min-w-0 flex-col gap-1 border-b border-r border-slate-200 p-1.5 ${destaque ? "bg-blue-100" : !doMes ? "bg-slate-50/70" : fimDeSemana ? "bg-slate-50/40" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-sm ${hoje ? "bg-blue-600 font-bold text-white" : doMes ? "font-medium text-slate-700" : "text-slate-400"}`}
                >
                  {dia.getDate() === 1 ? format(dia, "d 'de' MMM", { locale: ptBR }) : dia.getDate()}
                </span>
                {destaque && <span className="text-[10px] font-semibold text-blue-700">próximo dia útil</span>}
                {nomeFeriado && doMes && <span className="min-w-0 truncate text-[10px] font-semibold text-red-600" title={nomeFeriado}>feriado · {nomeFeriado}</span>}
                {doMes && (
                  <button
                    type="button"
                    onClick={() => onNovoNoDia(iso)}
                    title={`Inserir agendamento em ${format(dia, "dd/MM")}`}
                    aria-label={`Inserir agendamento em ${format(dia, "dd/MM")}`}
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-blue-50 hover:text-blue-700 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
                {lista.map((item) => {
                  const st = corDoStatus(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onAbrir(item)}
                      title={`${item.hrs || "sem horário"} · ${item.cliente} · ${st.label}`}
                      // no dia em destaque (fundo azul) o agendamento fica branco, para não sumir no fundo
                      className={`flex w-full min-w-0 items-center gap-1.5 rounded border-l-[3px] border-blue-500 px-1.5 py-1 text-left text-[11.5px] leading-tight text-slate-800 ${destaque ? "bg-white hover:bg-blue-50" : "bg-blue-50 hover:bg-blue-100"}`}
                    >
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${st.color}`} />
                      <span className="shrink-0 font-semibold tabular-nums text-slate-600">{item.hrs || "—"}</span>
                      <span className="min-w-0 truncate font-medium">{item.cliente}</span>
                      {idsComFoto.includes(item.id) && <Paperclip aria-label="tem foto do ticket" className="h-3 w-3 shrink-0 text-blue-600" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
