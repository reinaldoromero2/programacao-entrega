// Publica a RQ C 008 no banco do Romaneio sozinho (só no app desktop, onde a planilha existe).
// Faz o mesmo que o "🔄 Atualizar" da Programação no Romaneio: lê a aba planilha.geral,
// comprime (gzip + base64), grava em pedaços na coleção prog_planilha e troca o doc "meta".
// Os aparelhos com o Romaneio aberto recebem a versão nova pelo acompanhamento de mudanças.

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");
const DOCS = `${API_BASE}/api/romaneio/docs/prog_planilha`;
export const RQC008_ARQUIVO = "C:\\Users\\Expedicao\\Desktop\\EXPEDIÇÃO\\rq c 008 - resumo de programacao de entrega REV 03.09.24.xlsm";
const ULTIMA_KEY = "rqc008-sync-mtime";
// aba import.detalhes (o botão "Logística" da planilha): qtd por fardo, empilhamento, carga, encavalado...
const DOCS_LOGI = `${API_BASE}/api/romaneio/docs/prog_logistica`;
const ULTIMA_LOGI_KEY = "rqc008-logistica-mtime";
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

type XlsxMod = typeof import("xlsx");

/** Lê a aba import.detalhes: o cabeçalho (CLIENTE, PRODUTO, QTD FARDO...) e as linhas de cada RP. */
function lerLogistica(XLSX: XlsxMod, wb: import("xlsx").WorkBook): { cab: string[]; linhas: unknown[][] } | null {
  const ws = wb.Sheets["import.detalhes"];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const txt = (c: unknown) => String(c ?? "").trim().toUpperCase();
  const hi = rows.findIndex((r) => Array.isArray(r) && r.some((c) => txt(c) === "PRODUTO") && r.some((c) => txt(c).includes("QTD FARDO")));
  if (hi < 0) return null;
  const cab = rows[hi].map(txt);
  const iProd = cab.indexOf("PRODUTO");
  // a linha logo abaixo do cabeçalho tem os nomes dos campos do sistema (PRV_CODPRO...): fica de fora
  const linhas = rows.slice(hi + 1).filter((r) => Array.isArray(r) && r[iProd] != null && txt(r[iProd]) !== "" && !/^(PRV|PRO|ITV|CNP)_/.test(txt(r[iProd])));
  return { cab, linhas };
}

async function publicarLogistica(dados: { cab: string[]; linhas: unknown[][] }, nome: string): Promise<void> {
  const b = await gzipBase64(JSON.stringify(dados));
  const ver = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const partes: string[] = [];
  for (let i = 0; i < b.length; i += PEDACO) partes.push(b.slice(i, i + PEDACO));
  await Promise.all(partes.map((d, i) => enviar("PUT", `${DOCS_LOGI}/l${ver}_${i}`, { ver, i, d })));
  await enviar("PUT", `${DOCS_LOGI}/meta`, { ver, n: partes.length, z: 1, nome, qtd: dados.linhas.length, em: new Date().toISOString() });
  try {
    const res = await fetch(DOCS_LOGI, { cache: "no-store" });
    const { docs } = (await res.json()) as { docs: { id: string; data: { ver?: string } }[] };
    await Promise.all(docs.filter((d) => d.id !== "meta" && d.data?.ver !== ver).map((d) => enviar("DELETE", `${DOCS_LOGI}/${d.id}`)));
  } catch {
    // sobra de versão antiga não atrapalha
  }
}

/** Publica a planilha se ela mudou desde a última vez (ou sempre, com `forcar`). */
export async function sincronizarRqc008(forcar = false): Promise<"enviada" | "sem-mudanca" | "indisponivel"> {
  const fs = nodeFs();
  if (!fs || !fs.existsSync(RQC008_ARQUIVO)) return "indisponivel";

  const { mtimeMs } = fs.statSync(RQC008_ARQUIVO);
  const ultima = Number(localStorage.getItem(ULTIMA_KEY) || 0);
  const ultimaLogi = Number(localStorage.getItem(ULTIMA_LOGI_KEY) || 0);
  // espera o arquivo ficar 20 s parado para não ler no meio do salvamento do Excel
  if (Date.now() - mtimeMs < 20_000 && !forcar) return "sem-mudanca";
  const precisaPlanilha = forcar || mtimeMs > ultima;
  const precisaLogistica = forcar || mtimeMs > ultimaLogi;
  if (!precisaPlanilha && !precisaLogistica) return "sem-mudanca";

  const XLSX = await import("xlsx");
  const wb = XLSX.read(fs.readFileSync(RQC008_ARQUIVO), { type: "buffer", cellDates: true, sheets: ["planilha.geral", "import.detalhes"] });
  const nomeArq = RQC008_ARQUIVO.split("\\").pop() || "";
  // a aba de logística vai em separado: se falhar, a programação segue normal
  if (precisaLogistica) {
    try {
      const logi = lerLogistica(XLSX, wb);
      if (logi && logi.linhas.length) { await publicarLogistica(logi, nomeArq); localStorage.setItem(ULTIMA_LOGI_KEY, String(mtimeMs)); }
    } catch {
      // tenta de novo na próxima mudança do arquivo
    }
  }
  if (!precisaPlanilha) return "enviada";
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
