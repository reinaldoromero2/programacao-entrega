import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Rqc008Result = { ok: boolean; exitCode: number | null; lines: string[] };

// Roda C:\RIPack\atualizar-rqc008.ps1 pelo Electron e mostra o log desta execução.
export function Rqc008Button() {
  const electron = (window as any)?.require?.("electron");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Rqc008Result | null>(null);

  if (!electron) return null;

  const handleRun = async () => {
    setRunning(true);
    try {
      setResult(await electron.ipcRenderer.invoke("atualizar-rqc008"));
    } catch (err) {
      setResult({ ok: false, exitCode: null, lines: [String(err)] });
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={handleRun}
        disabled={running}
        className="h-10 w-10 border-green-800 bg-green-700 text-white hover:bg-green-800 hover:text-white disabled:opacity-60"
        title={running ? "Atualizando RQ C 008..." : "Atualizar RQ C 008"}
        aria-label="Atualizar RQ C 008"
        data-testid="button-atualizar-rqc008"
      >
        {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
      </Button>

      <Dialog open={result !== null} onOpenChange={(open) => { if (!open) setResult(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className={cn(result?.ok ? "text-green-700" : "text-red-600")}>
              {result?.ok ? "RQ C 008 atualizada" : "RQ C 008 não foi atualizada"}
            </DialogTitle>
            <DialogDescription>Fim do log (C:\RIPack\atualizar-rqc008.log)</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-900 p-3 text-xs leading-5 text-slate-100">
            {result?.lines.join("\n") || "(nenhuma linha nova no log)"}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
