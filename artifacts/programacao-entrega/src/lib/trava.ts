// Trava dos meses fechados da Programação de Entrega (a mesma regra do servidor, routes/trava.ts):
// depois do 3º dia útil de um mês, as entregas do mês anterior (e dos mais antigos) ficam só para
// consulta. O Cristian ou o Reinaldo desbloqueiam em Opções; o desbloqueio vale até a meia-noite
// ou até alguém bloquear de novo. Quem decide de verdade é o servidor; aqui é para o app avisar
// e não deixar mexer.
import { useQuery } from "@tanstack/react-query";
import { ehDiaUtil } from "@/lib/feriados";

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");

export interface EstadoTrava {
  hoje: string;
  terceiroDiaUtil: string;
  desbloqueado: boolean;
  por: string | null;
  em: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function hojeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** dia do mês que é o 3º dia útil (segunda a sexta, fora feriado) */
export function terceiroDiaUtil(ano: number, mes: number): number {
  let uteis = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(ano, mes - 1, d);
    if (dt.getMonth() !== mes - 1) break;
    if (ehDiaUtil(dt) && ++uteis === 3) return d;
  }
  return 31;
}

/** a data (AAAA-MM-DD) está num mês fechado? (sem olhar o desbloqueio) */
export function mesFechado(data: string, hoje = hojeLocal()): boolean {
  const [ae, me] = data.slice(0, 7).split("-").map(Number);
  const [ah, mh, dh] = hoje.split("-").map(Number);
  if (!ae || !me) return false;
  const iEntrega = ae * 12 + me, iHoje = ah * 12 + mh;
  if (iEntrega >= iHoje) return false;
  if (iEntrega < iHoje - 1) return true;
  return dh > terceiroDiaUtil(ah, mh);
}

/** "setembro/2026" */
export function nomeMes(data: string): string {
  const [a, m] = data.slice(0, 7).split("-").map(Number);
  return `${MESES[m - 1]}/${a}`;
}

async function lerTrava(): Promise<EstadoTrava> {
  const r = await fetch(`${API_BASE}/api/trava`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** estado da trava (atualiza a cada minuto) e se uma data está bloqueada agora */
export function useTrava() {
  const q = useQuery({ queryKey: ["trava"], queryFn: lerTrava, refetchInterval: 60_000, staleTime: 30_000, retry: 1 });
  const hoje = q.data?.hoje ?? hojeLocal();
  const desbloqueado = !!q.data?.desbloqueado;
  return {
    estado: q.data,
    hoje,
    desbloqueado,
    /** mês fechado (pela regra do 3º dia útil), desbloqueado ou não */
    fechado: (data: string) => mesFechado(data, hoje),
    /** fechado e sem desbloqueio: só consulta */
    bloqueado: (data: string) => mesFechado(data, hoje) && !desbloqueado,
    recarregar: () => q.refetch(),
  };
}

/** desbloquear (com a senha do Cristian ou do Reinaldo) ou bloquear de novo (com a senha de bloqueio) */
export async function mudarTrava(acao: "desbloquear" | "bloquear", usuario?: string, senha?: string): Promise<EstadoTrava> {
  const r = await fetch(`${API_BASE}/api/trava`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acao, usuario, senha }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Não deu certo (HTTP ${r.status}).`);
  return j as EstadoTrava;
}
