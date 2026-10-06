import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rqc008Disponivel, sincronizarRqc008 } from "@/lib/rqc008-sync";

export const ROMANEIO_ROTA = "/romaneio";
const VERIFICA_MS = 60_000;

// Romaneio dentro da própria janela do app (rota #/romaneio). O iframe só é criado na
// primeira visita e depois fica guardado escondido, para voltar a ele sem recarregar.
export function RomaneioFrame() {
  const [location, setLocation] = useLocation();
  const aberto = location === ROMANEIO_ROTA;
  const [montado, setMontado] = useState(aberto);

  useEffect(() => {
    if (aberto) setMontado(true);
  }, [aberto]);

  if (!montado) return null;

  return (
    <div className={`fixed inset-0 z-40 flex-col bg-white ${aberto ? "flex" : "hidden"}`}>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 print:hidden">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="h-8 gap-2 text-slate-700" data-testid="button-voltar-programacao">
          <ArrowLeft className="h-4 w-4" />
          Programação de Entrega
        </Button>
      </div>
      <iframe
        src="./romaneio/index.html"
        title="Romaneio Ripack"
        className="w-full flex-1 border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

// No computador que tem a RQ C 008, mantém a programação do Romaneio atualizada
// (fica no App para continuar rodando em qualquer tela).
export function RomaneioSync() {
  useEffect(() => {
    const electron = (window as any)?.require?.("electron");
    if (!electron || !rqc008Disponivel()) return;

    let parado = false;
    const sincronizar = (forcar = false) => {
      sincronizarRqc008(forcar)
        .then((r) => { if (r === "enviada") console.info("[romaneio] RQ C 008 enviada ao Romaneio"); })
        .catch((err) => { if (!parado) console.error("[romaneio] Falha ao enviar a RQ C 008:", err); });
    };

    sincronizar();
    const timer = setInterval(() => sincronizar(), VERIFICA_MS);
    // o botão "📗 Atualizar RQ C 008" do Romaneio roda o script pelo app e avisa aqui
    const aposScript = () => sincronizar(true);
    electron.ipcRenderer.on("rqc008-atualizada", aposScript);

    return () => {
      parado = true;
      clearInterval(timer);
      electron.ipcRenderer.removeListener("rqc008-atualizada", aposScript);
    };
  }, []);

  return null;
}
