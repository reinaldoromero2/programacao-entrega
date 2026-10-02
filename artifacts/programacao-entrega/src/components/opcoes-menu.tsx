import { useEffect, useRef, useState } from "react";
import { Download, Upload, Users, Ban, Settings, Loader2, Building2, Palette, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { MotoristasModal } from "@/components/motoristas-modal";
import { MotivosCancelamentoModal } from "@/components/motivos-cancelamento-modal";
import { ClientesCadastroModal } from "@/components/clientes-cadastro-modal";
import { BgColorModal } from "@/components/bg-color-modal";

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");
const ZOOM_STORAGE_KEY = "programacao-entrega-zoom";
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.3;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(1))));
}

export function applyAppZoom(zoom: number) {
  const clampedZoom = clampZoom(zoom);
  document.documentElement.style.zoom = String(clampedZoom);
  localStorage.setItem(ZOOM_STORAGE_KEY, String(clampedZoom));
  window.dispatchEvent(new CustomEvent("app-zoom-change", { detail: clampedZoom }));
  return clampedZoom;
}

export function OpcoesMenu() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [motoOpen, setMotoOpen] = useState(false);
  const [motivosOpen, setMotivosOpen] = useState(false);
  const [clientesOpen, setClientesOpen] = useState(false);
  const [bgColorOpen, setBgColorOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const savedZoom = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    if (Number.isFinite(savedZoom)) setZoom(clampZoom(savedZoom));

    const handleZoomChange = (event: Event) => {
      const nextZoom = (event as CustomEvent<number>).detail;
      if (Number.isFinite(nextZoom)) setZoom(clampZoom(nextZoom));
    };
    window.addEventListener("app-zoom-change", handleZoomChange);
    return () => window.removeEventListener("app-zoom-change", handleZoomChange);
  }, []);

  const updateZoom = (nextZoom: number) => setZoom(applyAppZoom(nextZoom));

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/entregas/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `backup-entregas-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Backup exportado com sucesso!", description: a.download });
    } catch (err) {
      toast({ title: "Erro ao exportar", description: String(err), variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setConfirmOpen(true);
    e.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setConfirmOpen(false);
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      const res = await fetch(`${API_BASE}/api/entregas/import`, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await queryClient.invalidateQueries();
      toast({ title: "Importação concluída!", description: `${json.imported} registros restaurados.` });
    } catch (err) {
      toast({ title: "Erro ao importar", description: String(err), variant: "destructive" });
    } finally {
      setIsImporting(false);
      setPendingFile(null);
    }
  };

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 border-slate-600 bg-slate-500 text-white hover:bg-slate-600 hover:text-white"
            disabled={isExporting || isImporting}
            title="Opções"
            aria-label="Opções"
          >
            {isExporting || isImporting
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Settings className="w-5 h-5" />}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onClick={handleExport}
            className="gap-2 text-emerald-700 focus:text-emerald-700 focus:bg-emerald-50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Exportar
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => fileInputRef.current?.click()}
            className="gap-2 text-amber-700 focus:text-amber-700 focus:bg-amber-50 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Importar
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => updateZoom(zoom - ZOOM_STEP)} className="gap-2 cursor-pointer">
            <ZoomOut className="w-4 h-4" />
            Diminuir zoom
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => updateZoom(1)} className="gap-2 cursor-pointer">
            <RotateCcw className="w-4 h-4" />
            Zoom: {Math.round(zoom * 100)}%
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => updateZoom(zoom + ZOOM_STEP)} className="gap-2 cursor-pointer">
            <ZoomIn className="w-4 h-4" />
            Aumentar zoom
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setMotoOpen(true)}
            className="gap-2 cursor-pointer"
          >
            <Users className="w-4 h-4" />
            Motoristas
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setMotivosOpen(true)}
            className="gap-2 cursor-pointer"
          >
            <Ban className="w-4 h-4" />
            Motivos Cancelamento
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setClientesOpen(true)}
            className="gap-2 cursor-pointer"
          >
            <Building2 className="w-4 h-4" />
            Clientes Cadastro
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setBgColorOpen(true)}
            className="gap-2 cursor-pointer"
          >
            <Palette className="w-4 h-4" />
            Cor do plano de fundo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Modals controlled externally */}
      <MotoristasModal open={motoOpen} onOpenChange={setMotoOpen} />
      <MotivosCancelamentoModal open={motivosOpen} onOpenChange={setMotivosOpen} />
      <ClientesCadastroModal open={clientesOpen} onOpenChange={setClientesOpen} />
      <BgColorModal open={bgColorOpen} onOpenChange={setBgColorOpen} />
      {/* Import confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar importação</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600">
                <p>O arquivo <strong className="text-slate-800">{pendingFile?.name}</strong> vai{" "}
                  <strong className="text-red-600">substituir todos os dados existentes</strong> no banco de dados.</p>
                <p>Esta ação não pode ser desfeita. Deseja continuar?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingFile(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport} className="bg-red-600 hover:bg-red-700 text-white">
              Sim, importar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
