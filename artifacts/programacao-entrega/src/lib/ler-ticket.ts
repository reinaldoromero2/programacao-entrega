// Lê a data e o horário de um ticket de agendamento (foto colada do e-mail).
// O texto vem do Tesseract (roda no próprio app). Testado com os modelos de 3M Itapetininga,
// 3M Sumaré, 3M Ribeirão, Ouro Fino, Perfetti Van Melle e Chevron (10/2026).

export interface DataHora { data: string | null; hora: string | null }

const pad = (n: number) => String(n).padStart(2, "0");

/** data (AAAA-MM-DD) e horário (HH:MM) achados no texto; sem ano ("14/10"), usa o próximo */
export function lerDataHora(texto: string, hoje: Date = new Date()): DataHora {
  const t = String(texto || "").replace(/[|]/g, " ");
  const datas: { d: number; mes: number; ano: number | null; pos: number }[] = [];
  const reData = /(^|[^\d])(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = reData.exec(t))) {
    const d = +m[2], mes = +m[3];
    if (d < 1 || d > 31 || mes < 1 || mes > 12) continue;
    let ano = m[4] ? +m[4] : null;
    if (ano !== null && ano < 100) ano += 2000;
    datas.push({ d, mes, ano, pos: m.index + m[1].length });
  }
  const horas: { h: number; min: number; pos: number }[] = [];
  const reHora = /(^|[^\d])(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*:\s*\d{2})?\s*(AM|PM|A\.M\.|P\.M\.)?(?!\d)/gi;
  while ((m = reHora.exec(t))) {
    let h = +m[2];
    const min = +m[3];
    if (h > 23 || min > 59) continue;
    const ap = (m[4] || "").toUpperCase().replace(/\./g, "");
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    horas.push({ h, min, pos: m.index + m[1].length });
  }
  // a data com ano vale mais (o ticket pode ter outras datas soltas)
  const data = datas.find((x) => x.ano) || datas[0] || null;
  let iso: string | null = null;
  if (data) {
    let ano = data.ano;
    if (!ano) {
      ano = hoje.getFullYear();
      // "14/10" lido em janeiro é do ano que vem
      if (new Date(ano, data.mes - 1, data.d) < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 60)) ano += 1;
    }
    iso = `${ano}-${pad(data.mes)}-${pad(data.d)}`;
  }
  // o horário: o primeiro depois da data (nos modelos ele vem junto ou logo abaixo)
  const hora = (data && horas.find((x) => x.pos >= data.pos)) || horas[0] || null;
  return { data: iso, hora: hora ? `${pad(hora.h)}:${pad(hora.min)}` : null };
}

// versão da imagem em preto e branco, ampliada: o marca-texto amarelo e o texto colorido
// atrapalham a leitura da imagem original (Ouro Fino, Chevron)
function tratar(img: HTMLImageElement): HTMLCanvasElement {
  const escala = Math.min(3, Math.max(1, 1800 / img.width));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 170 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

function carregar(arquivo: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não é uma imagem")); };
    img.src = url;
  });
}

type Leitor = { recognize: (img: Blob | HTMLCanvasElement) => Promise<{ data: { text: string } }> };
let leitor: Promise<Leitor> | null = null;
function obterLeitor(): Promise<Leitor> {
  // carrega o Tesseract só quando alguém usa (o resto do app continua leve)
  if (!leitor) {
    // o pacote é CommonJS: conforme o empacotador, createWorker vem no default
    leitor = import("tesseract.js").then((t) => {
      const mod = ((t as unknown as { default?: typeof t }).default ?? t) as typeof t;
      return mod.createWorker("por") as unknown as Promise<Leitor>;
    });
    leitor.catch(() => { leitor = null; });
  }
  return leitor;
}

// Cliente pelo modelo do ticket: trechos que só aparecem no ticket daquele cliente. Vence o modelo
// com mais trechos achados; empate ou nenhum, fica para escolher à mão. Os nomes são os do cadastro.
const MODELOS: { cliente: string; sinais: RegExp[] }[] = [
  { cliente: "3M SUMARÉ", sinais: [/SUM-\d{6,}/i, /3M\s*-\s*Sumar/i, /Data\s+agendamento/i] },
  { cliente: "3M ITAPETININGA", sinais: [/Rodovi[aá]rio/i, /\bModal\b/i, /\bTurno\b/i] },
  { cliente: "3M RIBEIRÃO", sinais: [/(^|\s)[I1l|]\.?\s?D\s*:\s*\d{6,}/m, /\bItem\s*:/i] },
  { cliente: "OURO FINO", sinais: [/Agendamento\s+confirmado\s+para/i] },
  { cliente: "PERFETTI VAN MELLE", sinais: [/\bagv\b/i, /Cajamar/i, /GRADE\s+AGENDA/i, /Medvedenk/i] },
  { cliente: "CHEVRON", sinais: [/Chevron/i, /Oronite/i, /AGENDAMENTO\s+IMPRESSO/i] },
];

export function identificarCliente(texto: string): string | null {
  const pontos = MODELOS
    .map((m) => ({ cliente: m.cliente, n: m.sinais.filter((r) => r.test(texto)).length }))
    .sort((a, b) => b.n - a.n);
  if (!pontos[0].n || pontos[1].n === pontos[0].n) return null;
  return pontos[0].cliente;
}

/** lê a foto do ticket: a imagem original e a tratada; "conferir" quando ficou dúvida */
export async function lerTicket(arquivo: Blob): Promise<DataHora & { conferir: boolean; cliente: string | null }> {
  const w = await obterLeitor();
  const img = await carregar(arquivo);
  // a original vai como arquivo (o leitor não reabre a imagem pelo endereço, já descartado)
  const textoA = (await w.recognize(arquivo)).data.text;
  const a = lerDataHora(textoA);
  const textoB = (await w.recognize(tratar(img))).data.text;
  const b = lerDataHora(textoB);
  const cliente = identificarCliente(`${textoA}\n${textoB}`);
  if (a.data && a.hora) {
    const iguais = !b.data || !b.hora || (b.data === a.data && b.hora === a.hora);
    return { ...a, cliente, conferir: !iguais };
  }
  return { data: a.data || b.data, hora: a.hora || b.hora, cliente, conferir: !(a.data || b.data) || !(a.hora || b.hora) };
}
