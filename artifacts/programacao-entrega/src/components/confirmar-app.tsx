/**
 * Confirmação no visual do app (no lugar da janela do Windows do window.confirm).
 * Uso: `if (!(await confirmarNoApp({ titulo, texto, botao: "Excluir", tipo: "perigo" }))) return;`
 * O <ConfirmarHost /> fica montado uma vez no App; sem ele (ex.: teste isolado), cai no window.confirm.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PedidoConfirmacao {
  titulo: string;
  /** texto principal (as quebras de linha aparecem) */
  texto?: ReactNode;
  /** um destaque embaixo do texto (ex.: como a linha vai ficar) */
  destaque?: ReactNode;
  /** texto do botão de confirmar (padrão: "OK") */
  botao?: string;
  /** "perigo" = vermelho (excluir); "ok" = verde (padrão) */
  tipo?: "perigo" | "ok";
}

type Aberto = PedidoConfirmacao & { responder: (sim: boolean) => void };
let abrirHost: ((p: Aberto) => void) | null = null;

export function confirmarNoApp(pedido: PedidoConfirmacao): Promise<boolean> {
  if (!abrirHost) {
    const plano = [pedido.titulo, typeof pedido.texto === "string" ? pedido.texto : "", typeof pedido.destaque === "string" ? pedido.destaque : ""].filter(Boolean).join("\n\n");
    return Promise.resolve(window.confirm(plano));
  }
  return new Promise((resolve) => abrirHost!({ ...pedido, responder: resolve }));
}

export function ConfirmarHost() {
  const [pedido, setPedido] = useState<Aberto | null>(null);
  useEffect(() => {
    abrirHost = (p) => setPedido(p);
    return () => { abrirHost = null; };
  }, []);
  const responder = (sim: boolean) => {
    if (!pedido) return;
    pedido.responder(sim);
    setPedido(null);
  };
  const perigo = pedido?.tipo === "perigo";
  return (
    <Dialog open={!!pedido} onOpenChange={(open) => { if (!open) responder(false); }}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md" data-testid="confirmar-app">
        <DialogHeader>
          <DialogTitle className={cn(perigo && "text-red-700")}>{pedido?.titulo}</DialogTitle>
        </DialogHeader>
        {pedido?.texto && <div className="whitespace-pre-line text-sm text-slate-700">{pedido.texto}</div>}
        {pedido?.destaque && (
          <div className={cn("rounded-lg border-2 px-4 py-3 text-base font-bold whitespace-pre-line",
            perigo ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-900")}>
            {pedido.destaque}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={() => responder(false)} data-testid="confirmar-app-cancelar">Cancelar</Button>
          <Button type="button" autoFocus onClick={() => responder(true)}
            className={cn("flex-1 font-bold text-white", perigo ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700")}
            data-testid="confirmar-app-ok">
            {pedido?.botao || "OK"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
