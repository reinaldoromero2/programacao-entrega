// Publica a RQ C 008 no banco do Romaneio sozinho (só no app desktop, onde a planilha existe).
// Faz o mesmo que o "🔄 Atualizar" da Programação no Romaneio: lê a aba planilha.geral,
// comprime (gzip + base64), grava em pedaços na coleção prog_planilha e troca o doc "meta".
// Os aparelhos com o Romaneio aberto recebem a versão nova pelo acompanhamento de mudanças.

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");
const DOCS = `${API_BASE}/api/romaneio/docs/prog_planilha`;
export const RQC008_ARQUIVO = "C:\\Users\\Expedicao\\Desktop\\EXPEDIÇÃO\\rq c 008 - resumo de programacao de entrega REV 03.09.24.xlsm";
const ULTIMA_KEY = "rqc008-sync-mtime";
const PEDACO = 150000;

type NodeFs = {
  statSync(p: string): { mtimeMs: number };
  readFileSync(p: string): Uint8Array;
  existsSync(p: string): boolean;
};

function nodeFs(): NodeFs | null {
  try {
    return (window as any)?.require?.("fs") ?? null;
  } catch {
    return null;
  }
}

export function rqc008Disponivel(): boolean {
  const fs = nodeFs();
  return !!fs && fs.existsSync(RQC008_ARQUIVO);
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gzipBase64(texto: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(texto)]).stream().pipeThrough(new CompressionStream("gzip"));
  return base64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function enviar(method: string, url: string, data?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify({ data }) : undefined,
  });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
}

/** Publica a planilha se ela mudou desde a última vez (ou sempre, com `forcar`). */
export async function sincronizarRqc008(forcar = false): Promise<"enviada" | "sem-mudanca" | "indisponivel"> {
  const fs = nodeFs();
  if (!fs || !fs.existsSync(RQC008_ARQUIVO)) return "indisponivel";

  const { mtimeMs } = fs.statSync(RQC008_ARQUIVO);
  const ultima = Number(localStorage.getItem(ULTIMA_KEY) || 0);
  // espera o arquivo ficar 20 s parado para não ler no meio do salvamento do Excel
  if (!forcar && (mtimeMs <= ultima || Date.now() - mtimeMs < 20_000)) return "sem-mudanca";

  const XLSX = await import("xlsx");
  const wb = XLSX.read(fs.readFileSync(RQC008_ARQUIVO), { type: "buffer", cellDates: true, sheets: ["planilha.geral"] });
  const ws = wb.Sheets["planilha.geral"];
  if (!ws) throw new Error('A RQ C 008 não tem a aba "planilha.geral".');
  const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const b = await gzipBase64(JSON.stringify(linhas));
  const ver = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const partes: string[] = [];
  for (let i = 0; i < b.length; i += PEDACO) partes.push(b.slice(i, i + PEDACO));

  await Promise.all(partes.map((d, i) => enviar("PUT", `${DOCS}/p${ver}_${i}`, { ver, i, d })));
  const nome = RQC008_ARQUIVO.split("\\").pop();
  await enviar("PUT", `${DOCS}/meta`, { ver, n: partes.length, z: 1, nome, em: new Date().toISOString() });
  localStorage.setItem(ULTIMA_KEY, String(mtimeMs));

  // limpa os pedaços das versões anteriores (como o Romaneio faz)
  try {
    const res = await fetch(DOCS, { cache: "no-store" });
    const { docs } = (await res.json()) as { docs: { id: string; data: { ver?: string } }[] };
    await Promise.all(docs.filter((d) => d.id !== "meta" && d.data?.ver !== ver).map((d) => enviar("DELETE", `${DOCS}/${d.id}`)));
  } catch {
    // sobra de versão antiga não atrapalha; fica para a próxima limpeza
  }
  return "enviada";
}
