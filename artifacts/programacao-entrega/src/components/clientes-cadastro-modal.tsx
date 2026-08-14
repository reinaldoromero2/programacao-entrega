import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_URL || "https://data-fill-tool.onrender.com").replace(/\/+$/, "");

export interface ClienteCadastroItem { id: number; nome: string; }

export const CLIENTES_CADASTRO_KEY = ["clientes-cadastro"];

async function fetchClientesCadastro(): Promise<ClienteCadastroItem[]> {
  const res = await fetch(`${API_BASE}/api/clientes-cadastro`);
  if (!res.ok) return [];
  return res.json();
}

export function useClientesCadastro() {
  return useQuery({
    queryKey: CLIENTES_CADASTRO_KEY,
    queryFn: fetchClientesCadastro,
    staleTime: 60_000,
  });
}

interface ClientesCadastroModalProps {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}

export function ClientesCadastroModal({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ClientesCadastroModalProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;

  const queryClient = useQueryClient();
  const { data: clientes = [] } = useClientesCadastro();

  const [newNome, setNewNome] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: CLIENTES_CADASTRO_KEY });

  const handleAdd = async () => {
    const nome = newNome.trim().toUpperCase();
    if (!nome) return;
    if (clientes.some((c) => c.nome === nome)) {
      toast({ title: "Cliente já cadastrado", description: `"${nome}" já existe na lista.`, variant: "destructive" });
      return;
    }
    setIsAdding(true);
    try {
      const res = await fetch(`${API_BASE}/api/clientes-cadastro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      refresh();
      setNewNome("");
    } catch (err) {
      toast({ title: "Erro ao adicionar cliente", description: String(err), variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: number, nome: string) => {
    if (!window.confirm(`Excluir cliente "${nome}" do cadastro?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/clientes-cadastro/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      refresh();
    } catch (err) {
      toast({ title: "Erro ao excluir cliente", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Building2 className="w-5 h-5 text-blue-600" />
            Cadastro de Clientes
          </DialogTitle>
        </DialogHeader>

        {/* Add new */}
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Nome do cliente"
            value={newNome}
            onChange={(e) => setNewNome(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 text-sm uppercase"
            autoFocus
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={isAdding || !newNome.trim()}
            className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Adicionar
          </Button>
        </div>

        {/* List */}
        <div className="mt-3 flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
          {clientes.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8 italic">
              Nenhum cliente cadastrado ainda.
            </p>
          )}
          {clientes.map((c) => (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border",
                "border-slate-100 bg-slate-50 hover:bg-white transition-colors"
              )}
            >
              <span className="flex-1 text-sm font-medium text-slate-800 truncate">{c.nome}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleDelete(c.id, c.nome)}
                className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 mt-1">
          {clientes.length} cliente{clientes.length !== 1 ? "s" : ""} cadastrado{clientes.length !== 1 ? "s" : ""} · use <span className="font-mono bg-slate-100 px-1 rounded">+</span> na tabela para múltiplos clientes na mesma linha
        </p>
      </DialogContent>
    </Dialog>
  );
}
