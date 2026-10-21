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
  /** vários de uma vez (cliente conjugado): o botão "+" abre outra barra de digitar embaixo; OK (ou Enter)
   *  chama aoConcluir com o que está em cada barra; com isso o pop-up ganha OK verde e Cancelar vermelho */
  varios?: { aoConcluir: (nomes: string[]) => void; validarLivre?: (texto: string) => string };
  /** em vez de escolher e fechar, o reconhecimento completa o texto no campo (ex.: o nome do cliente) e o
   *  pop-up fica aberto para acrescentar algo (anotação entre parênteses); Enter salva com aoTextoLivre */
  completar?: (op: OpcaoPopup, texto: string) => string;
  /** o que já está salvo, para abrir preenchido (uma barra para cada um) */
  valoresIniciais?: string[];
  testId?: string;
}

const filtroPadrao = (texto: string, op: OpcaoPopup) => {
  const t = semAcento(texto);
  return semAcento(op.rotulo).includes(t) || (!!op.detalhe && semAcento(op.detalhe).includes(t));
};

export function CampoPopup({
  aberto, titulo, opcoes, filtrar = filtroPadrao, textoDeBusca = (t) => t, aoEscolher, aoTextoLivre, aoFechar, aoLimpar,
  minAuto = 2, semAutoSe, placeholder, dica, avisoSemOpcao, aoMudarTexto, children, linha, semDigitacao, varios, completar, valoresIniciais, testId,
}: CampoPopupProps) {
  // uma barra de digitar por cliente (só o cliente conjugado tem mais de uma); "texto" é a barra em uso
  const [textos, setTextos] = useState<string[]>([""]);
  const [focado, setFocado] = useState(0);
  const texto = textos[focado] ?? "";
  const setTexto = (v: string) => setTextos((arr) => arr.map((x, i) => (i === focado ? v : x)));
  const [ativo, setAtivo] = useState(-1);
  const [erroBarra, setErroBarra] = useState("");
  const digitouRef = useRef(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const focarBarra = (i: number, fim?: number) => window.setTimeout(() => {
    const el = inputsRef.current[i];
    if (el) { el.focus(); if (fim != null) el.setSelectionRange(fim, fim); }
  }, 0);

  useEffect(() => {
    if (!aberto) return;
    const iniciais = (valoresIniciais || []).map((v) => v.trim()).filter(Boolean);
    const barras = iniciais.length ? (varios ? iniciais : [iniciais.join(" + ")]) : [""];
    setTextos(barras); setAtivo(-1); setErroBarra(""); digitouRef.current = false;
    // o cursor vai para o fim da última barra
    const ultima = barras.length - 1;
    setFocado(ultima); focarBarra(ultima, barras[ultima]!.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // completa a barra com o nome reconhecido e deixa o cursor no fim, para continuar escrevendo
  const completarCampo = (op: OpcaoPopup) => {
    const novo = completar!(op, texto);
    setTexto(novo); setAtivo(-1); digitouRef.current = false; aoMudarTexto?.(novo);
    focarBarra(focado, novo.length);
    return novo;
  };
  const escolher = (op: OpcaoPopup, t: string) => {
    if (completar) { completarCampo(op); return; }
    aoEscolher(op, t);
  };
  // salvar: com várias barras, junta o que está em cada uma (só o que vale); com uma, como antes
  const salvarTexto = (t: string) => {
    if (varios) {
      const todos = textos.map((x, i) => (i === focado ? t : x));
      const valores = todos.map((x) => (!x.trim() ? "" : varios.validarLivre ? varios.validarLivre(x) : x.trim()));
      // uma barra com algo que não é cliente cadastrado: não salva pela metade, avisa qual
      const errada = todos.findIndex((x, i) => x.trim() && !valores[i]);
      if (errada >= 0) {
        setErroBarra(textos.length > 1 ? `O cliente da barra ${errada + 1} não está cadastrado — corrija ou tire com o ✕.` : "Cliente não cadastrado — confira o nome.");
        setFocado(errada); focarBarra(errada);
        return;
      }
      const nomes = valores.filter(Boolean);
      if (nomes.length) varios.aoConcluir(nomes);
      return;
    }
    if (aoTextoLivre && t.trim()) aoTextoLivre(t);
  };
  const maisUmaBarra = () => {
    setTextos((arr) => [...arr, ""]);
    setFocado(textos.length); setAtivo(-1); digitouRef.current = false;
    focarBarra(textos.length);
  };
  const tirarBarra = (i: number) => {
    const novo = textos.filter((_, j) => j !== i);
    setTextos(novo.length ? novo : [""]);
    const f = Math.min(focado, Math.max(0, novo.length - 1));
    setFocado(f); focarBarra(f);
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
    if (completar) {
      let t = texto;
      if (ativo >= 0 && lista[ativo]) t = completar(lista[ativo]!, texto);
      else if (reconhecida && semAcento(textoDeBusca(texto)) !== semAcento(reconhecida.rotulo)) t = completar(reconhecida, texto);
      salvarTexto(t);
      return;
    }
    if (ativo >= 0 && lista[ativo]) { escolher(lista[ativo]!, texto); return; }
    if (reconhecida) { escolher(reconhecida, texto); return; }
    if (varios || (aoTextoLivre && texto.trim())) salvarTexto(texto);
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open) aoFechar(); }}>
      <DialogContent className={cn("w-[calc(100%-2rem)]", linha ? "sm:max-w-4xl" : varios ? "sm:max-w-lg" : "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        {linha}
        {!semDigitacao && textos.map((t, i) => (
        <div key={i} className={cn("flex gap-2 items-stretch", linha && "sm:max-w-md sm:mx-auto sm:w-full")}>
        <input
          ref={(el) => { inputsRef.current[i] = el; }}
          autoFocus={i === textos.length - 1}
          value={t}
          placeholder={i === 0 ? placeholder : "mais um cliente"}
          autoComplete="off"
          onFocus={() => { if (i !== focado) { setFocado(i); setAtivo(-1); digitouRef.current = false; } }}
          onChange={(e) => { digitouRef.current = true; setFocado(i); setErroBarra(""); setTextos((arr) => arr.map((x, j) => (j === i ? e.target.value : x))); setAtivo(-1); aoMudarTexto?.(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((n) => Math.min(n + 1, lista.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((n) => Math.max(n - 1, -1)); }
            else if (e.key === "Enter") { e.preventDefault(); confirmar(); }
          }}
          className={cn("w-full min-w-0 flex-1 rounded-md border px-3 py-3 text-center font-bold tracking-wide uppercase outline-none focus:ring-2 focus:ring-blue-500",
            i === focado ? "border-blue-400" : "border-slate-300", textos.length > 1 || t.length > 18 ? "text-lg" : "text-2xl")}
          data-testid={testId ? (i === 0 ? testId : `${testId}-${i + 1}`) : undefined}
        />
        {varios && textos.length > 1 && (
          <button type="button" title="Tirar este cliente" onClick={() => tirarBarra(i)}
            className="flex-shrink-0 w-10 rounded-md border border-slate-300 text-slate-400 text-lg font-bold hover:text-red-600 hover:border-red-300">✕</button>
        )}
        {varios && i === textos.length - 1 && (
          <button type="button" title="Mais um cliente conjugado (abre outra barra embaixo)" onClick={maisUmaBarra}
            className="flex-shrink-0 w-14 rounded-md border border-blue-400 bg-blue-600 text-white text-2xl font-bold hover:bg-blue-700"
            data-testid={testId ? `${testId}-mais` : undefined}>+</button>
        )}
        </div>
        ))}
        <p className="text-center text-sm text-slate-500">
          {reconhecida && texto.trim()
            ? <>Reconhecido: <b className="text-slate-900">{reconhecida.rotulo}</b>{reconhecida.detalhe ? ` · ${reconhecida.detalhe}` : ""}{completar ? " · pode escrever algo entre parênteses" : ""}</>
            : dica}
        </p>
        {erroBarra && <p className="text-center text-sm font-bold text-red-600" data-testid={testId ? `${testId}-erro` : undefined}>{erroBarra}</p>}
        {texto.trim() && filtradas.length === 0 && (
          <p className="text-center text-sm font-semibold text-red-600">{avisoSemOpcao || "Nada encontrado."}{parecidas.length ? " Parecidos:" : ""}</p>
        )}
        {lista.length > 0 && (
        <div className={cn("max-h-80 overflow-y-auto flex flex-col gap-1.5 p-0.5", linha && "sm:max-w-md sm:mx-auto sm:w-full")} data-testid={semDigitacao ? testId : undefined}>
          {lista.map((op, i) => (
            <button
              key={op.chave}
              type="button"
              onClick={() => escolher(op, texto)}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-base rounded-lg border-2 shadow-sm transition-colors",
                i === ativo || op === reconhecida ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-900 hover:border-blue-400 hover:bg-blue-50",
              )}
              data-testid={testId ? `${testId}-opcao` : undefined}
            >
              <span className="font-bold truncate">{op.rotulo}</span>
              {op.detalhe && (
                <span className={cn("text-base font-mono font-bold tracking-wider px-3 py-1 rounded-md flex-shrink-0", i === ativo || op === reconhecida ? "bg-white/20" : "bg-slate-100 text-slate-700 border border-slate-300")}>
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
          {varios ? (
            <>
              <Button type="button" className="flex-1 bg-red-600 hover:bg-red-700 text-white" onClick={aoFechar} data-testid={testId ? `${testId}-cancelar` : undefined}>Cancelar</Button>
              <Button type="button" className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold" onClick={confirmar} data-testid={testId ? `${testId}-ok` : undefined}>OK</Button>
            </>
          ) : (
            <Button type="button" variant="outline" className="flex-1" onClick={aoFechar}>Fechar</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
