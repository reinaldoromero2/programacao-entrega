import { useEffect, useState } from "react";
import { BellRing, CalendarDays, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Reminder } from "@/lib/reminders";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  reminders: Reminder[];
  syncError: string | null;
  onAdd: (reminder: Omit<Reminder, "id">) => Promise<void>;
  onEdit: (id: string, reminder: Omit<Reminder, "id">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export function LembretesModal({ open, onOpenChange, selectedDate, reminders, syncError, onAdd, onEdit, onRemove }: Props) {
  const [date, setDate] = useState(selectedDate);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editText, setEditText] = useState("");
  const [updating, setUpdating] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDate(selectedDate);
      setText("");
      setEditingId(null);
    }
  }, [open, selectedDate]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedText = text.trim();
    if (!date || !trimmedText || saving) return;

    setSaving(true);
    setActionError(null);
    try {
      await onAdd({ date, text: trimmedText });
      onOpenChange(false);
    } catch {
      setActionError("Não foi possível salvar no servidor. Verifique a conexão e tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedText = editText.trim();
    if (!editingId || !editDate || !trimmedText || updating) return;

    setUpdating(true);
    setActionError(null);
    try {
      await onEdit(editingId, { date: editDate, text: trimmedText });
      setEditingId(null);
    } catch {
      setActionError("Não foi possível atualizar no servidor. Verifique a conexão e tente novamente.");
    } finally {
      setUpdating(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    setActionError(null);
    try {
      await onRemove(id);
    } catch {
      setActionError("Não foi possível excluir no servidor. Verifique a conexão e tente novamente.");
    } finally {
      setRemovingId(null);
    }
  };

  const orderedReminders = [...reminders].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-red-600" />
            Lembretes
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700" htmlFor="reminder-text">
            Recado
            <Textarea
              id="reminder-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ex.: Motorista José precisa sair às 17:00h"
              maxLength={240}
              required
              className="min-h-20 resize-y"
            />
          </label>

          <label className="block space-y-1.5 text-sm font-medium text-slate-700" htmlFor="reminder-date">
            Mostrar no dia
            <Input
              id="reminder-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
              className="max-w-56"
            />
          </label>

          <div className="flex justify-end">
            <Button type="submit" disabled={!text.trim() || !date || saving} className="gap-2 bg-red-600 text-white hover:bg-red-700">
              <Plus className="h-4 w-4" />
              {saving ? "Salvando..." : "Adicionar lembrete"}
            </Button>
          </div>
        </form>

        {(actionError || syncError) && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionError || syncError}
          </p>
        )}

        <div className="border-t border-slate-200 pt-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Recados cadastrados</h3>
          {orderedReminders.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">Nenhum lembrete cadastrado.</p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {orderedReminders.map((reminder) => (
                <li key={reminder.id} className="flex items-start gap-3 rounded-md border border-red-100 bg-red-50 p-3">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  {editingId === reminder.id ? (
                    <form onSubmit={handleEditSubmit} className="min-w-0 flex-1 space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        maxLength={240}
                        required
                        aria-label="Editar recado"
                        className="min-h-20 resize-y bg-white"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Input
                          type="date"
                          value={editDate}
                          onChange={(event) => setEditDate(event.target.value)}
                          required
                          aria-label="Data do recado"
                          className="max-w-48 bg-white"
                        />
                        <div className="flex gap-1">
                          <Button type="submit" size="sm" disabled={!editText.trim() || !editDate || updating} className="h-8 gap-1 bg-red-600 text-white hover:bg-red-700">
                            <Save className="h-4 w-4" />
                            {updating ? "Salvando..." : "Salvar"}
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => setEditingId(null)} aria-label="Cancelar edição" title="Cancelar edição" className="h-8 w-8">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-red-700">
                          {format(new Date(`${reminder.date}T12:00:00`), "dd/MM/yyyy (EEEE)", { locale: ptBR })}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{reminder.text}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingId(reminder.id);
                            setEditDate(reminder.date);
                            setEditText(reminder.text);
                            setActionError(null);
                          }}
                          aria-label="Editar lembrete"
                          title="Editar lembrete"
                          className="h-8 w-8 text-slate-600 hover:bg-red-100 hover:text-slate-900"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleRemove(reminder.id)}
                          disabled={removingId === reminder.id}
                          aria-label="Excluir lembrete"
                          title="Excluir lembrete"
                          className="h-8 w-8 text-red-600 hover:bg-red-100 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}