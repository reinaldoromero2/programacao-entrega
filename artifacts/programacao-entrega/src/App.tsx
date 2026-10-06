import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { applyAppZoom } from "@/components/opcoes-menu";
import { ROMANEIO_ROTA, RomaneioFrame, RomaneioSync } from "@/components/romaneio-frame";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

function Router() {
  return (
    <>
      <Switch>
        <Route path="/" component={Home} />
        {/* o Romaneio é desenhado pelo RomaneioFrame, por cima de tudo */}
        <Route path={ROMANEIO_ROTA}>{null}</Route>
        <Route component={NotFound} />
      </Switch>
      <RomaneioFrame />
      <RomaneioSync />
    </>
  );
}

function App() {
  useEffect(() => {
    const savedZoom = Number(localStorage.getItem("programacao-entrega-zoom"));
    if (Number.isFinite(savedZoom)) applyAppZoom(savedZoom);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

      if (event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd") {
        event.preventDefault();
        applyAppZoom((Number(localStorage.getItem("programacao-entrega-zoom")) || 1) + 0.1);
      } else if (event.key === "-" || event.key === "_" || event.code === "Minus" || event.code === "NumpadSubtract") {
        event.preventDefault();
        applyAppZoom((Number(localStorage.getItem("programacao-entrega-zoom")) || 1) - 0.1);
      } else if (event.key === "0") {
        event.preventDefault();
        applyAppZoom(1);
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      event.preventDefault();
      const currentZoom = Number(localStorage.getItem("programacao-entrega-zoom")) || 1;
      applyAppZoom(currentZoom + (event.deltaY < 0 ? 0.1 : -0.1));
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
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