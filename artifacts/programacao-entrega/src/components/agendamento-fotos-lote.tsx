import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, ClipboardPaste, ImagePlus, Loader2, Trash2 } from "lucide-react";
import type { Entrega } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reduzir, salvarFoto } from "@/components/agendamento-foto-dialog";
import { lerTicket } from "@/lib/ler-ticket";

// "Criar pelas fotos": cola os tickets de agendamento de um cliente (vários de uma vez); o app lê a
// data e o horário de cada um, mostra para conferir e cria os agendamentos já com a foto anexada.

interface Linha {
  chave: number;
  arquivo: Blob;
  miniatura: string;
  lendo: boolean;
  data: string;
  hora: string;
  cliente: string;
  /** o cliente veio do modelo do ticket (e não do campo Cliente nem escolhido à mão) */
  clienteDoModelo: boolean;
  conferir: boolean;
  erro?: string;
}

interface Props {
  open: boolean;
  /** o do campo Cliente da agenda: vale para a foto em que o modelo não for reconhecido */
  cliente: string;
  clientes: string[];
  onOpenChange: (open: boolean) => void;
  criar: (dados: { date: string; hrs: string; cliente: string }) => Promise<Entrega>;
  onCriados: (datas: string[]) => void;
}

let proximaChave = 1;

export function AgendamentoFotosLote({ open, cliente, clientes, onOpenChange, criar, onCriados }: Props) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  // uma leitura por vez (o leitor é um só)
  const fila = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!open) setLinhas((atuais) => { atuais.forEach((l) => URL.revokeObjectURL(l.miniatura)); return []; });
  }, [open]);

  const atualizar = (chave: number, mudancas: Partial<Linha>) =>
    setLinhas((atuais) => atuais.map((l) => (l.chave === chave ? { ...l, ...mudancas } : l)));

  const adicionar = (arquivos: Blob[]) => {
    const novas = arquivos.map((arquivo) => ({
      chave: proximaChave++, arquivo, miniatura: URL.createObjectURL(arquivo), lendo: true, data: "", hora: "", cliente: "", clienteDoModelo: false, conferir: false,
    }));
    setLinhas((atuais) => [...atuais, ...novas]);
    for (const l of novas) {
      fila.current = fila.current.then(async () => {
        try {
          const r = await lerTicket(l.arquivo);
          atualizar(l.chave, {
            lendo: false, data: r.data ?? "", hora: r.hora ?? "", conferir: r.conferir,
            cliente: r.cliente ?? cliente.trim().toUpperCase(), clienteDoModelo: !!r.cliente,
          });
        } catch {
          atualizar(l.chave, { lendo: false, conferir: true, cliente: cliente.trim().toUpperCase(), erro: "Não consegui ler esta foto: preencha o que faltar." });
        }
      });
    }
  };

  // Ctrl+V com o pop-up aberto (pode colar uma foto atrás da outra, ou várias juntas)
  useEffect(() => {
    if (!open) return;
    const aoColar = (ev: ClipboardEvent) => {
      const imagens = Array.from(ev.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (!imagens.length) return;
      ev.preventDefault();
      adicionar(imagens);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  });

  const colarDoBotao = async () => {
    try {
      const imagens: Blob[] = [];
      for (const item of await navigator.clipboard.read()) {
        const tipo = item.types.find((t) => t.startsWith("image/"));
        if (tipo) imagens.push(await item.getType(tipo));
      }
      if (imagens.length) adicionar(imagens);
      else toast({ title: "Nenhuma imagem copiada.", description: "Copie a imagem do ticket no e-mail e tente de novo." });
    } catch {
      toast({ title: "Não deu para ler a área de transferência.", description: "Use Ctrl+V aqui, ou \"Escolher imagens\"." });
    }
  };

  const lendo = linhas.some((l) => l.lendo);
  const prontas = linhas.filter((l) => !l.lendo && l.data && l.hora && l.cliente.trim());
  const podeCriar = linhas.length > 0 && !lendo && prontas.length === linhas.length && !salvando;

  const criarTodos = async () => {
    if (!podeCriar) return;
    setSalvando(true);
    const criados: string[] = [];
    const falharam: Linha[] = [];
    for (const l of linhas) {
      try {
        const entrega = await criar({ date: l.data, hrs: l.hora, cliente: l.cliente.trim().toUpperCase() });
        criados.push(l.data);
        // a foto vai junto; se falhar, o agendamento já está criado (dá para colar depois)
        try { await salvarFoto(entrega.id, await reduzir(l.arquivo)); } catch { /* segue */ }
      } catch (error) {
        falharam.push({ ...l, erro: error instanceof Error ? error.message : "Falhou ao criar." });
      }
    }
    setSalvando(false);
    onCriados(criados);
    if (!falharam.length) {
      const nomes = Array.from(new Set(linhas.map((l) => l.cliente.trim().toUpperCase()))).join(", ");
      toast({ title: `${criados.length} agendamento${criados.length !== 1 ? "s" : ""} criado${criados.length !== 1 ? "s" : ""}`, description: nomes });
      onOpenChange(false);
    } else {
      setLinhas(falharam);
      toast({ title: `${criados.length} de ${criados.length + falharam.length} criados`, description: "Os que falharam continuam na lista.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-800">Criar agendamentos pelas fotos</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-600">
          <ClipboardPaste className="h-6 w-6 text-blue-600" />
          <p><b>Copie a imagem de cada ticket no e-mail</b> e aperte <b>Ctrl+V</b> aqui, uma atrás da outra.</p>
          <p className="text-xs text-slate-500">O app reconhece o cliente pelo modelo do ticket e lê a data e o horário. Confira antes de criar.</p>
        </div>

        {linhas.length > 0 && (
          <div className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
            {linhas.map((l) => (
              <div key={l.chave} className={`flex flex-wrap items-center gap-3 p-2 ${l.conferir && !l.lendo ? "bg-amber-50" : ""}`}>
                <a href={l.miniatura} target="_blank" rel="noreferrer" title="Abrir a foto">
                  <img src={l.miniatura} alt="ticket" className="h-16 w-28 rounded border border-slate-200 object-cover object-left-top" />
                </a>
                {l.lendo ? (
                  <span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Lendo a foto…</span>
                ) : (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <Input
                        list="lote-clientes" value={l.cliente} placeholder="Escolha o cliente"
                        onChange={(e) => atualizar(l.chave, { cliente: e.target.value.toUpperCase(), clienteDoModelo: false })}
                        className={`h-9 w-[210px] bg-white text-sm uppercase ${l.cliente.trim() ? "" : "border-red-400"}`} aria-label="Cliente do agendamento"
                      />
                      <span className={`text-[10px] ${l.clienteDoModelo ? "text-green-700" : l.cliente.trim() ? "text-slate-500" : "text-red-600"}`}>
                        {l.clienteDoModelo ? "reconhecido pelo modelo do ticket" : l.cliente.trim() ? "do campo Cliente / escolhido" : "não reconheci: escolha o cliente"}
                      </span>
                    </div>
                    <Input type="date" value={l.data} onChange={(e) => atualizar(l.chave, { data: e.target.value })} className="h-9 w-[150px] bg-white text-sm" aria-label="Data do agendamento" />
                    <Input type="time" value={l.hora} onChange={(e) => atualizar(l.chave, { hora: e.target.value })} className="h-9 w-[110px] bg-white text-sm" aria-label="Horário do agendamento" />
                    {(l.conferir || l.erro || !l.data || !l.hora) && (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" /> {l.erro || (!l.data || !l.hora ? "Preencha o que faltou" : "Confira: a leitura ficou em dúvida")}
                      </span>
                    )}
                  </>
                )}
                <Button
                  type="button" variant="ghost" size="icon" title="Tirar esta foto" aria-label="Tirar esta foto"
                  onClick={() => setLinhas((atuais) => atuais.filter((x) => x.chave !== l.chave))}
                  className="ml-auto h-8 w-8 text-slate-500 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <input
              ref={arquivoRef} type="file" accept="image/*" multiple hidden
              onChange={(ev) => { const fs = Array.from(ev.target.files ?? []); ev.target.value = ""; if (fs.length) adicionar(fs); }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void colarDoBotao()} className="gap-1.5"><ClipboardPaste className="h-4 w-4" /> Colar</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => arquivoRef.current?.click()} className="gap-1.5"><ImagePlus className="h-4 w-4" /> Escolher imagens</Button>
          </div>
          <Button type="button" disabled={!podeCriar} onClick={() => void criarTodos()} className="gap-2 bg-blue-600 text-white hover:bg-blue-700">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
            {linhas.length ? `Criar ${linhas.length} agendamento${linhas.length !== 1 ? "s" : ""}` : "Criar agendamentos"}
          </Button>
        </div>
        <datalist id="lote-clientes">{clientes.map((n) => <option key={n} value={n} />)}</datalist>
      </DialogContent>
    </Dialog>
  );
}
