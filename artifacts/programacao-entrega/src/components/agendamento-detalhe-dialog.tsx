import { useEffect, useState } from "react";
import { CalendarDays, Check, Clock3, Loader2, Paperclip, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Um agendamento aberto pelo calendário: status, foto do ticket, editar, excluir e ir para o dia.

export interface ItemDetalhe {
  id: number;
  date: string;
  cliente: string;
  hrs: string | null;
}

interface Props<T extends ItemDetalhe> {
  item: T | null;
  temFoto: boolean;
  status: { label: string; color: string } | null;
  ocupado: boolean;
  onOpenChange: (open: boolean) => void;
  onStatus: (item: T) => void;
  onFoto: (item: T) => void;
  onSalvar: (item: T, date: string, hrs: string) => Promise<boolean>;
  onExcluir: (item: T) => Promise<boolean>;
  onIrParaDia?: (date: string) => void;
}

export function AgendamentoDetalheDialog<T extends ItemDetalhe>({ item, temFoto, status, ocupado, onOpenChange, onStatus, onFoto, onSalvar, onExcluir, onIrParaDia }: Props<T>) {
  const [editando, setEditando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");

  useEffect(() => {
    setEditando(false);
    setConfirmar(false);
    setData(item?.date ?? "");
    setHora(item?.hrs ?? "");
  }, [item?.id]);

  const dataBr = item ? item.date.split("-").reverse().join("/") : "";

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-slate-800">{item?.cliente}</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="flex flex-col gap-3">
            {editando ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-9 w-[150px]" aria-label="Nova data" />
                <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-9 w-[110px]" aria-label="Novo horário" />
                <Button
                  type="button" size="sm" disabled={ocupado || !data || !hora}
                  onClick={async () => { if (await onSalvar(item, data, hora)) setEditando(false); }}
                  className="h-9 gap-1 bg-blue-600 text-white hover:bg-blue-700"
                >
                  {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(false)} className="h-9">Cancelar</Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm text-slate-700">
                <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-blue-600" /> {dataBr}</span>
                <span className="flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-blue-600" /> {item.hrs || "sem horário"}</span>
              </div>
            )}

            {status && (
              <button
                type="button"
                onClick={() => onStatus(item)}
                title="Clique para alterar"
                className="flex w-fit items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${status.color}`} /> {status.label}
                <span className="text-xs text-slate-400">(clique para alterar)</span>
              </button>
            )}

            {confirmar ? (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm">
                <span className="font-medium text-red-700">Excluir este agendamento?</span>
                <Button type="button" size="sm" disabled={ocupado} onClick={() => void onExcluir(item)} className="h-8 bg-red-600 text-white hover:bg-red-700">
                  {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sim, excluir"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmar(false)} className="h-8">Não</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onFoto(item)} className="gap-1.5">
                  <Paperclip className="h-4 w-4" /> {temFoto ? "Ver ticket" : "Colar ticket"}
                </Button>
                {onIrParaDia && (
                  <Button type="button" variant="outline" size="sm" onClick={() => onIrParaDia(item.date)} className="gap-1.5">
                    <CalendarDays className="h-4 w-4" /> Ir para o dia
                  </Button>
                )}
                {!editando && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)} className="gap-1.5">
                    <Pencil className="h-4 w-4" /> Editar
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => { setEditando(false); setConfirmar(true); }} className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700">
                  <Trash2 className="h-4 w-4" /> Excluir
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
