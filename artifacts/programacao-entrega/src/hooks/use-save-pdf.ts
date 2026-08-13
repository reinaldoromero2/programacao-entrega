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
      e.nf && e.nf !== "none" ? "✓" : "",
      e.cg && e.cg !== "none" ? "✓" : "",
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

/** Fallback: trigger a regular browser download (no folder selection). */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Try to write via File System Access API. Returns false if unavailable/denied. */
async function writeViaFileSystemAPI(
  handleRef: React.MutableRefObject<FileSystemFileHandle | null>,
  blob: Blob,
  suggestedName: string,
): Promise<boolean> {
  if (!("showSaveFilePicker" in window)) return false;

  const showPicker = (window as unknown as {
    showSaveFilePicker: (opts: object) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;

  let fileHandle = handleRef.current;

  // Check/request permission on existing handle
  if (fileHandle) {
    try {
      const h = fileHandle as FileSystemFileHandle & {
        queryPermission: (o: { mode: string }) => Promise<string>;
        requestPermission: (o: { mode: string }) => Promise<string>;
      };
      // Go straight to requestPermission — if already granted it returns immediately
      const result = await h.requestPermission({ mode: "readwrite" });
      if (result !== "granted") fileHandle = null; // will open picker below
    } catch {
      fileHandle = null; // handle is stale — open picker
    }
  }

  // Open picker if we don't have a working handle
  if (!fileHandle) {
    try {
      fileHandle = await showPicker({
        suggestedName,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
      });
      handleRef.current = fileHandle;
      await set(IDB_KEY, fileHandle);
    } catch (err) {
      // User cancelled (AbortError) or API not allowed in this context
      if ((err as { name?: string }).name === "AbortError") return true; // cancelled ≠ error
      return false; // API unavailable — caller will fallback
    }
  }

  if (!fileHandle) return false;

  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

export function useSavePdf() {
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  // Pre-load stored handle at mount so it's in memory before the user clicks,
  // keeping the user-gesture token intact for requestPermission.
  useEffect(() => {
    get<FileSystemFileHandle>(IDB_KEY)
      .then(stored => { if (stored) handleRef.current = stored; })
      .catch(() => { /* IDB unavailable — no-op */ });
  }, []);

  const savePdf = useCallback(async (entregas: Entrega[], dateStr: string) => {
    setStatus("saving");
    const dateFmt = format(new Date(dateStr + "T12:00:00"), "dd-MM-yyyy");
    const filename = `Programacao-Entrega-${dateFmt}.pdf`;
    const blob = buildPdf(entregas, dateStr);

    try {
      const savedToFolder = await writeViaFileSystemAPI(handleRef, blob, filename);
      if (!savedToFolder) {
        // File System Access API unavailable or not allowed — use regular download
        downloadBlob(blob, filename);
      }
      setStatus("idle");
    } catch (err) {
      console.error("[useSavePdf]", err);
      // Last resort: try plain download before showing error
      try { downloadBlob(blob, filename); setStatus("idle"); }
      catch { setStatus("error"); setTimeout(() => setStatus("idle"), 3000); }
    }
  }, []);

  const resetLocation = useCallback(() => {
    handleRef.current = null;
    set(IDB_KEY, undefined).catch(() => {});
  }, []);

  return { savePdf, status, resetLocation };
}
