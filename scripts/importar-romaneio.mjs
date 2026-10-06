// Importa no servidor do app uma cópia do banco do artefato Romaneio Ripack.
// Entrada: uma pasta com uma subpasta por coleção e um <id>.json por documento
// (formato do export do ArtifactData). Mantém os ids, então pode rodar de novo:
// regrava por cima e deixa tudo igual à cópia.
//
// Uso: node scripts/importar-romaneio.mjs <pasta> <url-da-api>
//   ex.: node scripts/importar-romaneio.mjs .tmp-db http://127.0.0.1:8787
import fs from "node:fs";
import path from "node:path";

const [pasta, api] = process.argv.slice(2);
if (!pasta || !api) {
  console.error("Uso: node scripts/importar-romaneio.mjs <pasta> <url-da-api>");
  process.exit(1);
}
const base = `${api.replace(/\/+$/, "")}/api/romaneio/docs`;
const PARALELO = 6;

const tarefas = [];
for (const col of fs.readdirSync(pasta).sort()) {
  const dir = path.join(pasta, col);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const arq of fs.readdirSync(dir)) {
    if (arq.endsWith(".json")) tarefas.push({ col, id: arq.slice(0, -5), arquivo: path.join(dir, arq) });
  }
}

const porColecao = {};
const falhas = [];
let i = 0;

async function trabalhador() {
  while (i < tarefas.length) {
    const t = tarefas[i++];
    const data = JSON.parse(fs.readFileSync(t.arquivo, "utf8"));
    for (let tentativa = 1; ; tentativa++) {
      try {
        const r = await fetch(`${base}/${encodeURIComponent(t.col)}/${encodeURIComponent(t.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
        porColecao[t.col] = (porColecao[t.col] || 0) + 1;
        break;
      } catch (e) {
        if (tentativa >= 5) { falhas.push(`${t.col}/${t.id}: ${e.message}`); break; }
        await new Promise((r) => setTimeout(r, 2000 * tentativa));
      }
    }
  }
}

await Promise.all(Array.from({ length: PARALELO }, trabalhador));
console.table(porColecao);
console.log(`${tarefas.length - falhas.length} de ${tarefas.length} documentos importados.`);
if (falhas.length) {
  console.error(falhas.join("\n"));
  process.exit(1);
}
