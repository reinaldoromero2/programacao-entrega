import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Pencil, Plus, Check, X, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useListMotoristas,
  useCreateMotorista,
  useUpdateMotorista,
  useDeleteMotorista,
  getListMotoristasQueryKey,
  type MotoristasInputFrete,
} from "@workspace/api-client-react";
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
import { getOfflineSnapshot } from "@/lib/offline-snapshot";

interface EditState {
  id: number;
  nome: string;
  placa: string;
  frete: string;
}

const FRETE_OPTIONS = ["RIPACK", "TRANSPORTADORA", "3º", "COLETA"] as const;

function parseFrete(value: string): MotoristasInputFrete {
  return value === "" ? null : value as MotoristasInputFrete;
}

interface MotoristasModalProps {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}

export function MotoristasModal({ open: controlledOpen, onOpenChange: controlledOnOpenChange }: MotoristasModalProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const isControlled = controlledOnOpenChange !== undefined;

  const queryClient = useQueryClient();
  const { data: motoristas = [] } = useListMotoristas({
    query: {
      queryKey: getListMotoristasQueryKey(),
      initialData: () => getOfflineSnapshot()?.motoristas ?? [],
    },
  });
  const createMotorista = useCreateMotorista();
  const updateMotorista = useUpdateMotorista();
  const deleteMotorista = useDeleteMotorista();

  const [newNome, setNewNome] = useState("");
  const [newPlaca, setNewPlaca] = useState("");
  const [newFrete, setNewFrete] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListMotoristasQueryKey() });

  const handleAdd = () => {
    if (!newNome.trim() || !newPlaca.trim()) return;
    setIsAdding(true);
    createMotorista.mutate(
      { data: { nome: newNome.trim(), placa: newPlaca.trim().toUpperCase(), frete: parseFrete(newFrete) } },
      {
        onSuccess: () => {
          refresh();
          setNewNome("");
          setNewPlaca("");
          setNewFrete("");
        },
        onError: () => {
          toast({ title: "Erro ao adicionar motorista", description: "Servidor indisponível. Verifique se o backend está rodando.", variant: "destructive" });
        },
        onSettled: () => setIsAdding(false),
      }
    );
  };

  const handleSaveEdit = () => {
    if (!editing || !editing.nome.trim() || !editing.placa.trim()) return;
    updateMotorista.mutate(
      {
        id: editing.id,
        data: { nome: editing.nome.trim(), placa: editing.placa.trim().toUpperCase(), frete: parseFrete(editing.frete) },
      },
      {
        onSuccess: () => {
          refresh();
          setEditing(null);
        },
        onError: () => {
          toast({ title: "Erro ao salvar motorista", description: "Servidor indisponível.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: number, nome: string) => {
    if (!window.confirm(`Excluir motorista "${nome}"?`)) return;
    deleteMotorista.mutate(
      { id },
      {
        onSuccess: refresh,
        onError: () => {
          toast({ title: "Erro ao excluir motorista", description: "Servidor indisponível.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 text-slate-700 border-slate-300 hover:bg-slate-100"
            data-testid="button-motoristas"
          >
            <Users className="w-4 h-4" />
            Motoristas
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Users className="w-5 h-5 text-blue-600" />
            Cadastro de Motoristas
          </DialogTitle>
        </DialogHeader>

        {/* Add new */}
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Nome do motorista"
            value={newNome}
            onChange={(e) => setNewNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 text-sm"
          />
          <Input
            placeholder="Placa"
            value={newPlaca}
            onChange={(e) => setNewPlaca(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="w-28 text-sm font-mono uppercase"
            maxLength={8}
          />
          <select
            value={newFrete}
            onChange={(e) => setNewFrete(e.target.value)}
            className="w-36 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
            aria-label="Frete padrão do motorista"
            data-testid="select-frete-motorista"
          >
            <option value="">Transportadora/Frete</option>
            {FRETE_OPTIONS.map((frete) => <option key={frete} value={frete}>{frete}</option>)}
          </select>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={isAdding || !newNome.trim() || !newPlaca.trim()}
            className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4" />
            Adicionar
          </Button>
        </div>

        {/* List */}
        <div className="mt-3 flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
          {motoristas.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8 italic">
              Nenhum motorista cadastrado ainda.
            </p>
          )}
          {motoristas.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border transition-colors",
                editing?.id === m.id
                  ? "border-blue-300 bg-blue-50"
                  : "border-slate-100 bg-slate-50 hover:bg-white"
              )}
            >
              {editing?.id === m.id ? (
                <>
                  <Input
                    value={editing.nome}
                    onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                    className="flex-1 h-7 text-sm"
                    autoFocus
                  />
                  <Input
                    value={editing.placa}
                    onChange={(e) =>
                      setEditing({ ...editing, placa: e.target.value.toUpperCase() })
                    }
                    className="w-24 h-7 text-sm font-mono uppercase"
                    maxLength={8}
                  />
                  <select
                    value={editing.frete}
                    onChange={(e) => setEditing({ ...editing, frete: e.target.value })}
                    className="w-32 h-7 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
                    aria-label="Frete padrão do motorista"
                  >
                    <option value="">Sem frete</option>
                    {FRETE_OPTIONS.map((frete) => <option key={frete} value={frete}>{frete}</option>)}
                  </select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSaveEdit}
                    className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing(null)}
                    className="h-7 w-7 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-slate-800 truncate">
                    {m.nome}
                  </span>
                  <span className="text-xs font-mono text-slate-500 bg-slate-200 px-2 py-0.5 rounded">
                    {m.placa}
                  </span>
                  {m.frete && <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded">{m.frete}</span>}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing({ id: m.id, nome: m.nome, placa: m.placa, frete: m.frete ?? "" })}
                    className="h-7 w-7 text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(m.id, m.nome)}
                    className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50"
                  >
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
