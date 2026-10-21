/**
 * CampoPopup
 *
 * Pop-up de escolha rápida das colunas da Programação (cliente, motorista/placa, frete, unidade),
 * no mesmo jeito do pop-up da hora: um campo grande para digitar e as sugestões dentro do próprio
 * pop-up. Quando o que foi digitado reconhece uma opção só (ou o nome exato de uma), ela é escolhida
 * sozinha depois de uma pausa curta; a lista só aparece quando há várias parecidas ou nenhuma
 * (aí mostra as mais próximas). No alto vai a linha inteira da entrega, para saber qual se edita.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface OpcaoPopup {
  chave: string;
  rotulo: string;
  detalhe?: string;
}

export const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

interface CampoPopupProps {
  aberto: boolean;
  titulo: string;
  opcoes: OpcaoPopup[];
  /** filtra as opções pelo texto digitado (padrão: o nome ou o detalhe contém o texto) */
  filtrar?: (texto: string, op: OpcaoPopup) => boolean;
  /** o texto que vale para "nome exato" (padrão: tudo o que foi digitado) */
  textoDeBusca?: (texto: string) => string;
  aoEscolher: (op: OpcaoPopup, texto: string) => void;
  /** Enter sem uma opção reconhecida: usa o que foi digitado (sem isso, só aceita as opções) */
  aoTextoLivre?: (texto: string) => void;
  aoFechar: () => void;
  aoLimpar?: () => void;
  /** a partir de quantas letras uma opção reconhecida é escolhida sozinha */
  minAuto?: number;
  /** não escolhe sozinho quando o texto casa com isto (ex.: "+" ou "(" no cliente) */
  semAutoSe?: RegExp;
  placeholder?: string;
  dica?: string;
  avisoSemOpcao?: string;
  aoMudarTexto?: (texto: string) => void;
  /** campos a mais embaixo da lista (ex.: a placa de um motorista que não é cadastrado) */
  children?: ReactNode;
  /** a linha da entrega que está sendo editada, mostrada no alto do pop-up */
  linha?: ReactNode;
  /** poucas opções fixas (ex.: unidade): sem campo de digitar, todas à vista para um clique */
  semDigitacao?: boolean;
  /** vários de uma vez (cliente conjugado): o botão "+" abre mais uma linha; cada escolha preenche uma
   *  linha e passa para a próxima, e com todas preenchidas chama aoConcluir com os nomes */
  varios?: { aoConcluir: (nomes: string[]) => void; validarLivre?: (texto: string) => string };
  testId?: string;
}

const filtroPadrao = (texto: string, op: OpcaoPopup) => {
  const t = semAcento(texto);
  return semAcento(op.rotulo).includes(t) || (!!op.detalhe && semAcento(op.detalhe).includes(t));
};

export function CampoPopup({
  aberto, titulo, opcoes, filtrar = filtroPadrao, textoDeBusca = (t) => t, aoEscolher, aoTextoLivre, aoFechar, aoLimpar,
  minAuto = 2, semAutoSe, placeholder, dica, avisoSemOpcao, aoMudarTexto, children, linha, semDigitacao, varios, testId,
}: CampoPopupProps) {
  const [texto, setTexto] = useState("");
  const [ativo, setAtivo] = useState(-1);
  const digitouRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // cliente conjugado: quantas linhas e os nomes já escolhidos
  const [qtdLinhas, setQtdLinhas] = useState(1);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);

  useEffect(() => {
    if (aberto) { setTexto(""); setAtivo(-1); digitouRef.current = false; setQtdLinhas(1); setEscolhidos([]); }
  }, [aberto]);

  const limparDigitacao = () => { setTexto(""); setAtivo(-1); digitouRef.current = false; window.setTimeout(() => inputRef.current?.focus(), 0); };
  const juntarNome = (nome: string) => {
    const lista = [...escolhidos, nome];
    if (lista.length >= qtdLinhas) { varios!.aoConcluir(lista); return; }
    setEscolhidos(lista);
    limparDigitacao();
  };
  // com mais de uma linha, a escolha vai para a linha da vez em vez de salvar e fechar
  const escolher = (op: OpcaoPopup, t: string) => {
    if (varios && qtdLinhas > 1) juntarNome(op.rotulo);
    else aoEscolher(op, t);
  };

  const filtradas = useMemo(
    () => (texto.trim() ? opcoes.filter((op) => filtrar(texto, op)) : opcoes),
    [texto, opcoes, filtrar],
  );
  // a opção que o texto reconhece: a única que sobrou, ou a única com o nome exato digitado
  const reconhecida = useMemo(() => {
    const busca = semAcento(textoDeBusca(texto));
    if (!busca) return null;
    if (filtradas.length === 1) return filtradas[0]!;
    const exatas = filtradas.filter((op) => semAcento(op.rotulo) === busca);
    return exatas.length === 1 ? exatas[0]! : null;
  }, [texto, filtradas, textoDeBusca]);

  // nada encontrado: as mais próximas (começam com as 2 primeiras letras ou têm as 3 primeiras)
  const parecidas = useMemo(() => {
    const t = semAcento(textoDeBusca(texto));
    if (!t || filtradas.length) return [];
    return opcoes.filter((op) => {
      const r = semAcento(op.rotulo);
      return r.startsWith(t.slice(0, 2)) || (t.length >= 3 && r.includes(t.slice(0, 3)));
    }).slice(0, 30);
  }, [texto, filtradas, opcoes, textoDeBusca]);
  // a lista só aparece quando há o que escolher: várias parecidas, ou as próximas de um nome não encontrado
  const lista = semDigitacao ? opcoes : !texto.trim() ? [] : filtradas.length > 1 ? filtradas : filtradas.length === 0 ? parecidas : [];

  // reconheceu: escolhe sozinho depois de uma pausa curta (dá tempo de continuar digitando)
  useEffect(() => {
    if (!aberto || !digitouRef.current || !reconhecida) return;
    if (semAcento(texto).length < minAuto || (semAutoSe && semAutoSe.test(texto))) return;
    const t = window.setTimeout(() => escolher(reconhecida, texto), 550);
    return () => window.clearTimeout(t);
  });

  const confirmar = () => {
    if (ativo >= 0 && lista[ativo]) { escolher(lista[ativo]!, texto); return; }
    if (reconhecida) { escolher(reconhecida, texto); return; }
    if (varios && qtdLinhas > 1) {
      const valor = varios.validarLivre ? varios.validarLivre(texto) : texto.trim();
      if (valor) juntarNome(valor);
      return;
    }
    if (aoTextoLivre && texto.trim()) aoTextoLivre(texto);
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open) aoFechar(); }}>
      <DialogContent className={cn("w-[calc(100%-2rem)]", linha ? "sm:max-w-4xl" : "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        {linha}
        {varios && qtdLinhas > 1 && (
          <div className={cn("flex flex-col gap-1", linha && "sm:max-w-md sm:mx-auto sm:w-full")} data-testid={testId ? `${testId}-linhas` : undefined}>
            {Array.from({ length: qtdLinhas }, (_, i) => (
              <div key={i} className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                escolhidos[i] ? "border-green-300 bg-green-50 text-slate-800" : i === escolhidos.length ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-400")}>
                <span className="text-xs font-bold w-16 flex-shrink-0">Cliente {i + 1}</span>
                <span className="flex-1 truncate font-medium">{escolhidos[i] || (i === escolhidos.length ? "digitando..." : "")}</span>
                {escolhidos[i] && (
                  <button type="button" className="text-slate-400 hover:text-red-600 text-xs font-bold" title="Tirar este cliente"
                    onClick={() => { setEscolhidos(escolhidos.filter((_, j) => j !== i)); limparDigitacao(); }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {!semDigitacao && (
        <div className={cn("flex gap-2 items-stretch", linha && "sm:max-w-md sm:mx-auto sm:w-full")}>
        <input
          ref={inputRef}
          autoFocus
          value={texto}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => { digitouRef.current = true; setTexto(e.target.value); setAtivo(-1); aoMudarTexto?.(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, lista.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, -1)); }
            else if (e.key === "Enter") { e.preventDefault(); confirmar(); }
          }}
          className="w-full min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-3 text-center text-2xl font-bold tracking-wide uppercase outline-none focus:ring-2 focus:ring-blue-500"
          data-testid={testId}
        />
        {varios && (
          <button type="button" title="Mais um cliente conjugado (abre outra linha de cliente)"
            onClick={() => { setQtdLinhas((n) => Math.max(n, escolhidos.length + 1) + 1); limparDigitacao(); }}
            className="flex-shrink-0 w-14 rounded-md border border-blue-400 bg-blue-600 text-white text-2xl font-bold hover:bg-blue-700"
            data-testid={testId ? `${testId}-mais` : undefined}>+</button>
        )}
        </div>
        )}
        <p className="text-center text-sm text-slate-500">
          {reconhecida && texto.trim()
            ? <>Reconhecido: <b className="text-slate-900">{reconhecida.rotulo}</b>{reconhecida.detalhe ? ` · ${reconhecida.detalhe}` : ""}</>
            : dica}
        </p>
        {texto.trim() && filtradas.length === 0 && (
          <p className="text-center text-sm font-semibold text-red-600">{avisoSemOpcao || "Nada encontrado."}{parecidas.length ? " Parecidos:" : ""}</p>
        )}
        {lista.length > 0 && (
        <div className={cn("max-h-72 overflow-y-auto rounded-md border border-slate-200", linha && "sm:max-w-md sm:mx-auto sm:w-full")} data-testid={semDigitacao ? testId : undefined}>
          {lista.map((op, i) => (
            <button
              key={op.chave}
              type="button"
              onClick={() => escolher(op, texto)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm border-b border-slate-100 last:border-b-0",
                i === ativo || op === reconhecida ? "bg-blue-600 text-white" : "text-slate-800 hover:bg-blue-50",
              )}
              data-testid={testId ? `${testId}-opcao` : undefined}
            >
              <span className="font-medium truncate">{op.rotulo}</span>
              {op.detalhe && (
                <span className={cn("text-xs font-mono px-2 py-0.5 rounded flex-shrink-0", i === ativo || op === reconhecida ? "bg-white/20" : "bg-slate-100 text-slate-500")}>
                  {op.detalhe}
                </span>
              )}
            </button>
          ))}
        </div>
        )}
        {children}
        <div className={cn("flex gap-2", linha && "sm:max-w-md sm:mx-auto sm:w-full")}>
          {aoLimpar && <Button type="button" variant="outline" className="flex-1" onClick={aoLimpar} data-testid={testId ? `${testId}-limpar` : undefined}>Limpar</Button>}
          {varios && qtdLinhas > 1 && escolhidos.length > 0 && (
            <Button type="button" className="flex-1" onClick={() => varios.aoConcluir(escolhidos)} data-testid={testId ? `${testId}-salvar` : undefined}>Salvar {escolhidos.length}</Button>
          )}
          <Button type="button" variant="outline" className="flex-1" onClick={aoFechar}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
