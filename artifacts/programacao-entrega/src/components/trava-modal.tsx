import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mudarTrava, nomeMes, useTrava, terceiroDiaUtil } from "@/lib/trava";

// Opções → Trava dos meses fechados: mostra se está travado e deixa o Cristian ou o Reinaldo
// desbloquear (com a senha deles) até o fim do dia; bloquear de novo é na hora, com a senha de bloqueio.
export function TravaModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const trava = useTrava();
  const queryClient = useQueryClient();
  const [usuario, setUsuario] = useState("reinaldo");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [a, m] = trava.hoje.split("-").map(Number);
  const mesPassado = `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
  const diaFecha = terceiroDiaUtil(a, m);
  const passadoFechado = trava.fechado(mesPassado);
  const quando = trava.estado?.em ? new Date(trava.estado.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

  const executar = async (acao: "desbloquear" | "bloquear") => {
    setEnviando(true); setErro(null);
    try {
      await mudarTrava(acao, acao === "desbloquear" ? usuario : undefined, senha);
      setSenha("");
      await queryClient.invalidateQueries({ queryKey: ["trava"] });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu certo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setSenha(""); setErro(null); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {trava.desbloqueado ? <LockOpen className="w-5 h-5 text-green-600" /> : <Lock className="w-5 h-5 text-red-600" />}
            Trava dos meses fechados
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-slate-700">
          <p>
            Depois do <b>3º dia útil</b> de cada mês, as cargas do mês anterior ficam só para consulta: ninguém
            cria, altera, apaga nem muda a ordem.
          </p>
          <p className="rounded-md bg-slate-100 px-3 py-2 text-xs">
            {passadoFechado
              ? <>Fechados agora: <b>{nomeMes(mesPassado)}</b> e os meses anteriores.</>
              : <>Fechados agora: os meses antes de <b>{nomeMes(mesPassado)}</b>. {nomeMes(mesPassado)} fecha depois de <b>{String(diaFecha).padStart(2, "0")}/{String(m).padStart(2, "0")}</b> (3º dia útil).</>}
          </p>

          {trava.desbloqueado ? (
            <div className="space-y-3 rounded-lg border-2 border-green-600 bg-green-50 p-3">
              <p className="font-semibold text-green-800">
                🔓 Desbloqueado hoje{trava.estado?.por ? ` por ${trava.estado.por}` : ""}{quando ? ` às ${quando}` : ""}.
              </p>
              <p className="text-xs text-green-800">Os meses fechados podem ser alterados até a meia-noite; aí travam sozinhos.</p>
              <Input type="password" inputMode="numeric" autoComplete="off" placeholder="Senha para bloquear" value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && senha) executar("bloquear"); }} />
              <Button onClick={() => executar("bloquear")} disabled={enviando || !senha} className="w-full gap-2 bg-red-600 hover:bg-red-700 text-white">
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Bloquear agora
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border-2 border-red-600 bg-red-50 p-3">
              <p className="font-semibold text-red-800">🔒 Travado. Só o Cristian ou o Reinaldo desbloqueiam.</p>
              <div className="flex gap-2">
                {[["reinaldo", "Reinaldo"], ["cristian", "Cristian"]].map(([id, nome]) => (
                  <button key={id} type="button" onClick={() => setUsuario(id)}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold ${usuario === id ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                    {nome}
                  </button>
                ))}
              </div>
              <Input type="password" inputMode="numeric" autoComplete="off" placeholder="Senha" value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && senha) executar("desbloquear"); }} />
              <Button onClick={() => executar("desbloquear")} disabled={enviando || !senha} className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white">
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
                Desbloquear até o fim do dia
              </Button>
            </div>
          )}
          {erro && <p className="text-sm font-medium text-red-600">{erro}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
