import { useState, useEffect } from "react";
import { Trash2, Pencil, Plus, Check, X, Ban } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL || "https://data-fill-tool.onrender.com").replace(/\/+$/, "");

interface Motivo { id: number; motivo: string; }

async function fetchMotivos(): Promise<Motivo[]> {
  const res = await fetch(`${API_BASE}/api/motivos-cancelamento`);
  if (!res.ok) throw new Error("Erro ao carregar motivos");
  return res.json();
}

interface MotivosCancelamentoModalProps {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}

export function MotivosCancelamentoModal({ open: controlledOpen, onOpenChange: controlledOnOpenChange }: MotivosCancelamentoModalProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const isControlled = controlledOnOpenChange !== undefined;
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [newMotivo, setNewMotivo] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<Motivo | null>(null);

  const refresh = () => fetchMotivos().then(setMotivos).catch(() => {});

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleAdd = async () => {
    if (!newMotivo.trim()) return;
    setIsAdding(true);
    try {
      const res = await fetch(`${API_BASE}/api/motivos-cancelamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: newMotivo.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewMotivo("");
      await refresh();
    } catch {
      toast({ title: "Erro ao adicionar motivo", variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing || !editing.motivo.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/motivos-cancelamento/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: editing.motivo.trim() }),
      });
      if (!res.ok) throw new Error();
      setEditing(null);
      await refresh();
    } catch {
      toast({ title: "Erro ao salvar motivo", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number, motivo: string) => {
    if (!window.confirm(`Excluir motivo "${motivo}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/motivos-cancelamento/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await refresh();
    } catch {
      toast({ title: "Erro ao excluir motivo", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-slate-700 border-slate-300 hover:bg-slate-100"
            data-testid="button-motivos-cancelamento"
          >
            <Ban className="w-4 h-4" />
            Motivos Cancelamento
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Ban className="w-5 h-5 text-red-500" />
            Motivos de Cancelamento
          </DialogTitle>
        </DialogHeader>

        {/* Add new */}
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Descreva o motivo (ex: quebra de caminhão)"
            value={newMotivo}
            onChange={(e) => setNewMotivo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 text-sm"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={isAdding || !newMotivo.trim()}
            className="gap-1 bg-red-600 hover:bg-red-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Adicionar
          </Button>
        </div>

        {/* List */}
        <div className="mt-3 flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
          {motivos.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8 italic">
              Nenhum motivo cadastrado ainda.
            </p>
          )}
          {motivos.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border transition-colors",
                editing?.id === m.id
                  ? "border-red-300 bg-red-50"
                  : "border-slate-100 bg-slate-50 hover:bg-white"
              )}
            >
              {editing?.id === m.id ? (
                <>
                  <Input
                    value={editing.motivo}
                    onChange={(e) => setEditing({ ...editing, motivo: e.target.value })}
                    className="flex-1 h-7 text-sm"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                  />
                  <Button size="icon" variant="ghost" onClick={handleSaveEdit}
                    className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50">
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing(null)}
                    className="h-7 w-7 text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-slate-800">{m.motivo}</span>
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ ...m })}
                    className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(m.id, m.motivo)}
                    className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
