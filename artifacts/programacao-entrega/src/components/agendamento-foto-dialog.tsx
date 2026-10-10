import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Foto do ticket de agendamento: cola (Ctrl+V) a imagem copiada do e-mail. A imagem é reduzida
// aqui antes de subir e fica numa tabela separada no servidor, apagada quando passa o dia.

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");
const LADO_MAX = 1600;
const QUALIDADE = 0.72;

export async function buscarIdsComFoto(from: string, to: string): Promise<number[]> {
  const r = await fetch(`${API_BASE}/api/agendamento-fotos?from=${from}&to=${to}`, { cache: "no-store" });
  if (!r.ok) return [];
  return (await r.json()) as number[];
}

// reduz para no máximo 1600 px no lado maior, em JPEG (um print de e-mail cai de MB para ~100-300 KB)
function reduzir(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("Sem canvas")); return; }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", QUALIDADE));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não é uma imagem")); };
    img.src = url;
  });
}

interface Props {
  entrega: { id: number; cliente: string; date: string; hrs: string | null } | null;
  temFoto: boolean;
  onOpenChange: (open: boolean) => void;
  onMudou: () => void;
}

export function AgendamentoFotoDialog({ entrega, temFoto, onOpenChange, onMudou }: Props) {
  const [foto, setFoto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const id = entrega?.id ?? null;

  useEffect(() => {
    setFoto(null);
    if (id == null || !temFoto) return;
    let vivo = true;
    setCarregando(true);
    fetch(`${API_BASE}/api/agendamento-fotos/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { conteudo?: string } | null) => { if (vivo) setFoto(j?.conteudo ?? null); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [id, temFoto]);

  const enviar = async (arquivo: Blob) => {
    if (id == null || salvando) return;
    setSalvando(true);
    try {
      const conteudo = await reduzir(arquivo);
      const r = await fetch(`${API_BASE}/api/agendamento-fotos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conteudo }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`);
      setFoto(conteudo);
      onMudou();
      toast({ title: "Foto do ticket salva", description: entrega?.cliente });
    } catch (error) {
      toast({ title: "Não foi possível salvar a foto.", description: error instanceof Error ? error.message : "Tente de novo.", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  // Ctrl+V com o pop-up aberto
  useEffect(() => {
    if (id == null) return;
    const aoColar = (ev: ClipboardEvent) => {
      const item = Array.from(ev.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const arquivo = item?.getAsFile();
      if (!arquivo) return;
      ev.preventDefault();
      void enviar(arquivo);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  });

  // botão "Colar" (celular, ou quem não usa o teclado)
  const colarDoBotao = async () => {
    try {
      const itens = await navigator.clipboard.read();
      for (const item of itens) {
        const tipo = item.types.find((t) => t.startsWith("image/"));
        if (tipo) { await enviar(await item.getType(tipo)); return; }
      }
      toast({ title: "Nenhuma imagem copiada.", description: "Copie a imagem do ticket no e-mail e tente de novo." });
    } catch {
      toast({ title: "Não deu para ler a área de transferência.", description: "Use Ctrl+V aqui, ou \"Escolher imagem\"." });
    }
  };

  const excluir = async () => {
    if (id == null) return;
    setSalvando(true);
    try {
      const r = await fetch(`${API_BASE}/api/agendamento-fotos/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFoto(null);
      onMudou();
    } catch (error) {
      toast({ title: "Não foi possível excluir a foto.", description: error instanceof Error ? error.message : "Tente de novo.", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const dataBr = entrega ? entrega.date.split("-").reverse().slice(0, 2).join("/") : "";

  return (
    <Dialog open={entrega !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-800">
            Ticket · {entrega?.cliente} · {dataBr}{entrega?.hrs ? ` · ${entrega.hrs}` : ""}
          </DialogTitle>
        </DialogHeader>

        {carregando ? (
          <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-600" /></div>
        ) : foto ? (
          <img src={foto} alt={`Ticket de agendamento de ${entrega?.cliente}`} className="w-full rounded border border-slate-200" />
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
            {salvando ? <Loader2 className="h-5 w-5 animate-spin text-blue-600" /> : <ClipboardPaste className="h-6 w-6 text-blue-600" />}
            <p><b>Copie a imagem do ticket no e-mail</b> e aperte <b>Ctrl+V</b> aqui.</p>
            <p className="text-xs text-slate-500">A foto é apagada sozinha quando passa o dia do agendamento.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            ref={arquivoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void enviar(f); }}
          />
          <Button type="button" variant="outline" size="sm" disabled={salvando} onClick={() => void colarDoBotao()} className="gap-1.5">
            <ClipboardPaste className="h-4 w-4" /> {foto ? "Colar outra" : "Colar"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={salvando} onClick={() => arquivoRef.current?.click()} className="gap-1.5">
            <ImagePlus className="h-4 w-4" /> Escolher imagem
          </Button>
          {foto && (
            <Button type="button" variant="outline" size="sm" disabled={salvando} onClick={() => void excluir()} className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700">
              <Trash2 className="h-4 w-4" /> Excluir foto
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
