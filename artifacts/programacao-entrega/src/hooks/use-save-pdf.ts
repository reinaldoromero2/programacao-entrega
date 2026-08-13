import { useRef, useState, useCallback, useEffect } from "react";
import { get, set } from "idb-keyval";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Entrega } from "@workspace/api-client-react";

const IDB_KEY = "pdf-file-handle";

function buildPdf(entregas: Entrega[], dateStr: string): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const dateFmt = format(new Date(dateStr + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR });
  const weekday = format(new Date(dateStr + "T12:00:00"), "EEEE", { locale: ptBR });

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("PROGRAMAÇÃO DE ENTREGA", 14, 16);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${dateFmt} — ${weekday.charAt(0).toUpperCase() + weekday.slice(1)}`, 14, 23);

  const rows = [...entregas]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((e, i) => [
      i + 1,
      e.cliente,
      e.hrs || "",
      e.obs || "",
      [e.motorista, e.placa].filter(Boolean).join(" • "),
      e.v || "",
      e.unidade,
      e.nf ? "✓" : "",
      e.cg ? "✓" : "",
    ]);

  autoTable(doc, {
    startY: 28,
    head: [["#", "CLIENTE", "HRS", "OBS", "MOTORISTA • PLACA", "V", "UNIDADE", "NF", "CG"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      1: { cellWidth: 55 },
      2: { halign: "center", cellWidth: 16 },
      3: { cellWidth: 40 },
      4: { cellWidth: 65 },
      5: { halign: "center", cellWidth: 10 },
      6: { cellWidth: 32 },
      7: { halign: "center", cellWidth: 10 },
      8: { halign: "center", cellWidth: 10 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  return doc.output("blob");
}

async function requestWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & {
    queryPermission: (opts: { mode: string }) => Promise<string>;
    requestPermission: (opts: { mode: string }) => Promise<string>;
  };
  const perm = await h.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  const req = await h.requestPermission({ mode: "readwrite" });
  return req === "granted";
}

export function useSavePdf() {
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  // Pre-load the stored handle at mount time so it's already in memory
  // before the user clicks. This keeps the user-gesture token intact
  // when we later call requestPermission inside the click handler.
  useEffect(() => {
    get<FileSystemFileHandle>(IDB_KEY).then(stored => {
      if (stored) handleRef.current = stored;
    });
  }, []);

  const savePdf = useCallback(async (entregas: Entrega[], dateStr: string) => {
    if (!("showSaveFilePicker" in window)) {
      alert("Seu navegador não suporta salvar arquivos diretamente. Use Chrome ou Edge.");
      return;
    }

    setStatus("saving");
    try {
      // Handle already pre-loaded by useEffect — no IDB await here
      // so the user-gesture token stays alive for requestPermission.
      let fileHandle = handleRef.current;
      let needPicker = !fileHandle;

      if (fileHandle && !needPicker) {
        const ok = await requestWritePermission(fileHandle).catch(() => false);
        if (!ok) needPicker = true;
      }

      if (needPicker) {
        const dateFmt = format(new Date(dateStr + "T12:00:00"), "dd-MM-yyyy");
        fileHandle = await (window as unknown as {
          showSaveFilePicker: (opts: object) => Promise<FileSystemFileHandle>
        }).showSaveFilePicker({
          suggestedName: `Programacao-Entrega-${dateFmt}.pdf`,
          types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
        });
        handleRef.current = fileHandle;
        await set(IDB_KEY, fileHandle);
      }

      if (!fileHandle) { setStatus("idle"); return; }

      const blob = buildPdf(entregas, dateStr);
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      setStatus("idle");
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") {
        setStatus("idle");
      } else {
        console.error(err);
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    }
  }, []);

  const resetLocation = useCallback(async () => {
    handleRef.current = null;
    await set(IDB_KEY, undefined);
  }, []);

  return { savePdf, status, resetLocation };
}
