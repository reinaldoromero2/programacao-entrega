import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

// ─── Trava dos meses fechados da Programação de Entrega ──────────────────────────
// Depois do 3º dia útil de um mês, as entregas do mês anterior (e de qualquer mês mais antigo)
// não podem mais ser criadas, alteradas, apagadas nem reordenadas. O Cristian ou o Reinaldo
// desbloqueiam nas Configurações (com a senha deles); o desbloqueio vale até o fim do dia
// (meia-noite, horário de Brasília) ou até alguém bloquear de novo (com a senha de bloqueio). Fica na tabela
// programacao_trava (uma linha só, criada quando o servidor liga — ver index.ts).

const router: IRouter = Router();

// senha para bloquear de novo
const SENHA_BLOQUEAR = "1010";
// quem pode desbloquear (mesmas senhas do Romaneio)
const LIBERADORES: Record<string, { nome: string; senha: string }> = {
  cristian: { nome: "Cristian", senha: "1010" },
  reinaldo: { nome: "Reinaldo", senha: "1250" },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** hoje no horário de Brasília, "AAAA-MM-DD" */
export function hojeBrasil(agora = new Date()): string {
  return agora.toLocaleString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
}

// feriados nacionais + 9 de julho (SP) + Sexta-feira Santa e Corpus Christi
const FERIADOS_FIXOS = new Set(["01-01", "04-21", "05-01", "07-09", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]);
function feriadosDaPascoa(ano: number): Set<string> {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const fmt = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return new Set([fmt(new Date(ano, mes - 1, dia - 2)), fmt(new Date(ano, mes - 1, dia + 60))]);
}

/** dia do mês que é o 3º dia útil (segunda a sexta, fora feriado) */
export function terceiroDiaUtil(ano: number, mes: number): number {
  const pascoa = feriadosDaPascoa(ano);
  let uteis = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(ano, mes - 1, d);
    if (dt.getMonth() !== mes - 1) break;
    const semana = dt.getDay();
    if (semana === 0 || semana === 6) continue;
    if (FERIADOS_FIXOS.has(`${pad(mes)}-${pad(d)}`) || pascoa.has(`${ano}-${pad(mes)}-${pad(d)}`)) continue;
    if (++uteis === 3) return d;
  }
  return 31;
}

/** a data (AAAA-MM-DD) está num mês fechado? (sem olhar o desbloqueio) */
export function mesFechado(data: string, hoje = hojeBrasil()): boolean {
  const [ae, me] = data.slice(0, 7).split("-").map(Number);
  const [ah, mh, dh] = hoje.split("-").map(Number);
  if (!ae || !me) return false;
  const iEntrega = ae * 12 + me, iHoje = ah * 12 + mh;
  if (iEntrega >= iHoje) return false;          // mês atual ou futuro: sempre aberto
  if (iEntrega < iHoje - 1) return true;        // 2 meses ou mais para trás: fechado
  return dh > terceiroDiaUtil(ah, mh);          // mês passado: fecha depois do 3º dia útil
}

interface EstadoTrava { desbloqueadoDia: string | null; por: string | null; em: string | null }
let cache: { em: number; estado: EstadoTrava } | null = null;
async function lerEstado(): Promise<EstadoTrava> {
  if (cache && Date.now() - cache.em < 10_000) return cache.estado;
  const r = await pool.query(`SELECT desbloqueado_dia, por, em FROM programacao_trava WHERE id = 1`);
  const x = r.rows[0] ?? {};
  const dia = x.desbloqueado_dia instanceof Date
    ? `${x.desbloqueado_dia.getFullYear()}-${pad(x.desbloqueado_dia.getMonth() + 1)}-${pad(x.desbloqueado_dia.getDate())}`
    : x.desbloqueado_dia ?? null;
  const estado = { desbloqueadoDia: dia, por: x.por ?? null, em: x.em ? new Date(x.em).toISOString() : null };
  cache = { em: Date.now(), estado };
  return estado;
}

/** desbloqueado agora? (o desbloqueio vale só no dia em que foi feito) */
export async function desbloqueadoAgora(): Promise<boolean> {
  try {
    const e = await lerEstado();
    return e.desbloqueadoDia === hojeBrasil();
  } catch {
    return false;
  }
}

/**
 * Alguma dessas datas está num mês fechado (e a trava não está desbloqueada)? Devolve a mensagem
 * para o usuário, ou null se pode gravar.
 */
export async function motivoTrava(datas: Array<string | null | undefined>): Promise<string | null> {
  const fechadas = datas.filter((d): d is string => !!d && mesFechado(String(d)));
  if (!fechadas.length) return null;
  if (await desbloqueadoAgora()) return null;
  const [a, m] = String(fechadas[0]).split("-");
  return `A programação de ${m}/${a} está bloqueada — passou do 3º dia útil do mês seguinte.`;
}

// estado da trava (para o app mostrar o aviso e o interruptor nas Configurações)
router.get("/trava", async (_req, res): Promise<void> => {
  const hoje = hojeBrasil();
  const [a, m] = hoje.split("-").map(Number);
  const estado = await lerEstado().catch(() => ({ desbloqueadoDia: null, por: null, em: null }));
  res.json({
    hoje,
    terceiroDiaUtil: `${a}-${pad(m)}-${pad(terceiroDiaUtil(a, m))}`,
    desbloqueado: estado.desbloqueadoDia === hoje,
    por: estado.por,
    em: estado.em,
  });
});

// desbloquear (com senha do Cristian ou do Reinaldo) ou bloquear de novo
router.post("/trava", async (req, res): Promise<void> => {
  const acao = req.body?.acao;
  if (acao !== "desbloquear" && acao !== "bloquear") {
    res.status(400).json({ error: "Ação inválida" });
    return;
  }
  // desbloquear pede a senha do Cristian ou do Reinaldo; bloquear pede a senha de bloqueio
  const usuario = String(req.body?.usuario ?? "").toLowerCase();
  const quem = LIBERADORES[usuario];
  if (acao === "desbloquear" && (!quem || String(req.body?.senha ?? "") !== quem.senha)) {
    res.status(403).json({ error: "Usuário ou senha incorretos. Só o Cristian ou o Reinaldo podem desbloquear." });
    return;
  }
  if (acao === "bloquear" && String(req.body?.senha ?? "") !== SENHA_BLOQUEAR) {
    res.status(403).json({ error: "Senha incorreta." });
    return;
  }
  const porQuem = quem?.nome ?? (typeof req.get("x-ripack-quem") === "string" ? decodeURIComponent(String(req.get("x-ripack-quem"))).slice(0, 80) : null);
  await pool.query(
    `INSERT INTO programacao_trava (id, desbloqueado_dia, por, em) VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET desbloqueado_dia = EXCLUDED.desbloqueado_dia, por = EXCLUDED.por, em = EXCLUDED.em`,
    [acao === "desbloquear" ? hojeBrasil() : null, porQuem],
  );
  cache = null;
  const estado = await lerEstado();
  res.json({ desbloqueado: estado.desbloqueadoDia === hojeBrasil(), por: estado.por, em: estado.em });
});

export default router;
