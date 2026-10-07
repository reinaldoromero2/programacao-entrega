import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { applyAppZoom } from "@/components/opcoes-menu";
import { RomaneioFrame, RomaneioSync, TelaProgramacao, enviarZoomAoRomaneio, rotaDaTelaInicial, zoomDaTelaInicialAtivo, type AcaoZoom } from "@/components/romaneio-frame";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

function Router() {
  const [location] = useLocation();
  // a Programação continua montada com o Romaneio aberto, para o deslize entre as duas
  const telaInicial = rotaDaTelaInicial(location);

  return (
    <>
      {telaInicial ? (
        <TelaProgramacao>
          <Home />
        </TelaProgramacao>
      ) : (
        <Switch>
          <Route component={NotFound} />
        </Switch>
      )}
      <RomaneioFrame />
      <RomaneioSync />
    </>
  );
}

function App() {
  useEffect(() => {
    const savedZoom = Number(localStorage.getItem("programacao-entrega-zoom"));
    // abrindo direto no Romaneio ou na grade, o zoom da Programação fica para quando voltar
    if (Number.isFinite(savedZoom) && zoomDaTelaInicialAtivo()) applyAppZoom(savedZoom);

    // cada tela tem o seu zoom: na Programação é o do app; no Romaneio e na grade RQ C 008
    // o pedido vai para a página do Romaneio, que guarda o zoom de cada uma
    const zoom = (acao: AcaoZoom) => {
      if (!enviarZoomAoRomaneio(acao)) {
        const atual = Number(localStorage.getItem("programacao-entrega-zoom")) || 1;
        applyAppZoom(acao === "0" ? 1 : atual + (acao === "+" ? 0.1 : -0.1));
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

      if (event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd") {
        event.preventDefault();
        zoom("+");
      } else if (event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract") {
        event.preventDefault();
        zoom("-");
      } else if (event.key === "0") {
        event.preventDefault();
        zoom("0");
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      event.preventDefault();
      zoom(event.deltaY < 0 ? "+" : "-");
    };

    // no app instalado o Electron segura os atalhos de teclado e manda para cá
    const electron = (window as any)?.require?.("electron");
    const handleAtalho = (_event: unknown, acao: AcaoZoom) => zoom(acao);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    electron?.ipcRenderer.on("atalho-zoom", handleAtalho);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
      electron?.ipcRenderer.removeListener("atalho-zoom", handleAtalho);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter hook={useHashLocation}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;