import { useEffect } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rqc008Disponivel, sincronizarRqc008 } from "@/lib/rqc008-sync";

const VERIFICA_MS = 60_000;

// Abre o Romaneio (no app desktop numa janela própria; na web numa aba nova).
// No computador que tem a RQ C 008, também mantém a programação do Romaneio atualizada.
export function RomaneioButton() {
  const electron = (window as any)?.require?.("electron");

  useEffect(() => {
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
  }, [electron]);

  const abrir = () => {
    if (electron) electron.ipcRenderer.invoke("abrir-romaneio");
    else window.open("./romaneio/index.html", "_blank", "noopener");
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={abrir}
      className="h-10 w-10 border-indigo-800 bg-indigo-700 text-white hover:bg-indigo-800 hover:text-white"
      title="Romaneio"
      aria-label="Romaneio"
      data-testid="button-romaneio"
    >
      <Truck className="w-5 h-5" />
    </Button>
  );
}
