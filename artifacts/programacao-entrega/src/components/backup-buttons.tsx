import { useRef, useState } from "react";
import { Download, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const API_BASE = (import.meta.env.VITE_API_URL || "https://data-fill-tool.onrender.com").replace(/\/+$/, "");

export function BackupButtons() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/entregas/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Use filename from Content-Disposition if available, fallback to default
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

  // ── Import ────────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setConfirmOpen(true);
    // Reset input so the same file can be selected again if needed
    e.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setConfirmOpen(false);
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);

      const res = await fetch(`${API_BASE}/api/entregas/import`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      // Invalidate all cached queries so the table reloads
      await queryClient.invalidateQueries();

      toast({
        title: "Importação concluída!",
        description: `${json.imported} registros restaurados.`,
      });
    } catch (err) {
      toast({ title: "Erro ao importar", description: String(err), variant: "destructive" });
    } finally {
      setIsImporting(false);
      setPendingFile(null);
    }
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Export button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={isExporting}
        className="h-9 gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
        title="Exportar todos os dados como Excel"
      >
        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        Exportar
      </Button>

      {/* Import button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={isImporting}
        className="h-9 gap-2 text-amber-700 border-amber-300 hover:bg-amber-50"
        title="Importar backup Excel (substitui todos os dados)"
      >
        {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Importar
      </Button>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar importação</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-600">
                <p>
                  O arquivo <strong className="text-slate-800">{pendingFile?.name}</strong> vai{" "}
                  <strong className="text-red-600">substituir todos os dados existentes</strong> no banco de dados.
                </p>
                <p>Esta ação não pode ser desfeita. Deseja continuar?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingFile(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Sim, importar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
