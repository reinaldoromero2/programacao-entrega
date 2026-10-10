// Feriados nacionais (não contam como dia útil). Sexta-feira Santa e Corpus Christi vêm da Páscoa.
// Feriado municipal e Carnaval (ponto facultativo) não entram.

const FIXOS: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Consciência Negra",
  "12-25": "Natal",
};

// domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** nome do feriado nacional nessa data, ou null */
export function feriado(d: Date): string | null {
  const fixo = FIXOS[`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`];
  if (fixo) return fixo;
  const p = pascoa(d.getFullYear());
  const desloc = (dias: number) => iso(new Date(p.getFullYear(), p.getMonth(), p.getDate() + dias));
  const hoje = iso(d);
  if (hoje === desloc(-2)) return "Sexta-feira Santa";
  if (hoje === desloc(60)) return "Corpus Christi";
  return null;
}

/** segunda a sexta, fora feriado nacional */
export function ehDiaUtil(d: Date): boolean {
  return d.getDay() !== 0 && d.getDay() !== 6 && !feriado(d);
}
