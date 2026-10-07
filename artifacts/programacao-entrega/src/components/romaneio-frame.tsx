import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { rqc008Disponivel, sincronizarRqc008 } from "@/lib/rqc008-sync";

// Três telas lado a lado:  [ Romaneio ]  ‹  [ Programação de Entrega ]  ›  [ Programação RQ C 008 ]
// As duas laterais usam a mesma página do Romaneio (um iframe só): pela direita ela entra com a
// grade da Programação (#prog-modal) aberta, pela esquerda na tela normal do Romaneio.
export const ROMANEIO_ROTA = "/romaneio";
export const PROGRAMACAO_ROTA = "/programacao";
const VERIFICA_MS = 60_000;
const DESLIZE_MS = 450;
const DESLIZE = `transform ${DESLIZE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;

type Tela = "inicio" | "romaneio" | "programacao";

function useTela() {
  const [location, setLocation] = useLocation();
  const tela: Tela = location === ROMANEIO_ROTA ? "romaneio" : location === PROGRAMACAO_ROTA ? "programacao" : "inicio";
  return { tela, ir: (rota: string) => setLocation(rota) };
}

export function rotaDaTelaInicial(location: string) {
  return location === "/" || location === ROMANEIO_ROTA || location === PROGRAMACAO_ROTA;
}

// Botão direito no cliente da Programação: vai para a grade RQ C 008 filtrada por ele.
// O nome fica guardado até a página do Romaneio estar pronta para receber.
let filtroPendente: string | null = null;
export function abrirGradeComCliente(cliente: string) {
  if (!cliente.trim()) return;
  filtroPendente = cliente.trim();
  window.location.hash = PROGRAMACAO_ROTA;
}

export type AcaoZoom = "+" | "-" | "0";
const ROMANEIO_IFRAME = 'iframe[title="Romaneio Ripack"]';

/** Com o Romaneio ou a grade RQ C 008 na tela, manda o zoom para a página deles. */
export function enviarZoomAoRomaneio(acao: AcaoZoom): boolean {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash !== ROMANEIO_ROTA && hash !== PROGRAMACAO_ROTA) return false;
  const frame = document.querySelector<HTMLIFrameElement>(ROMANEIO_IFRAME);
  if (!frame?.contentWindow) return false;
  frame.contentWindow.postMessage({ ripack: "zoom", acao }, "*");
  return true;
}

// O zoom da Programação é aplicado na página inteira (applyAppZoom). Fora dela (Romaneio e
// grade RQ C 008) a página volta a 100%, para o painel usar só o zoom dele. Não dá para
// compensar com um zoom inverso no painel: o Safari do iPhone encolhe o painel inteiro.
export function zoomDaTelaInicialAtivo() {
  const hash = window.location.hash.replace(/^#/, "");
  return hash !== ROMANEIO_ROTA && hash !== PROGRAMACAO_ROTA;
}
function aplicarZoomDaTela(tela: Tela) {
  const salvo = Number(localStorage.getItem("programacao-entrega-zoom")) || 1;
  document.documentElement.style.zoom = String(tela === "inicio" ? salvo : 1);
}

const setaClasse =
  "fixed top-1/2 z-50 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 " +
  "bg-white/70 text-slate-700 shadow-lg backdrop-blur transition-opacity duration-300 hover:bg-white hover:text-slate-900 print:hidden";

function Seta({ lado, visivel, onClick, rotulo, testid }: {
  lado: "esquerda" | "direita"; visivel: boolean; onClick: () => void; rotulo: string; testid: string;
}) {
  const Icone = lado === "esquerda" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${setaClasse} ${lado === "esquerda" ? "left-3" : "right-3"} ${visivel ? "opacity-100" : "pointer-events-none opacity-0"}`}
      title={rotulo}
      aria-label={rotulo}
      aria-hidden={!visivel}
      tabIndex={visivel ? 0 : -1}
      data-testid={testid}
    >
      <Icone className="h-8 w-8" />
    </button>
  );
}

// A tela inicial (Programação de Entrega): sai pela direita quando o Romaneio entra pela
// esquerda, e pela esquerda quando a Programação RQ C 008 entra pela direita.
export function TelaProgramacao({ children }: { children: ReactNode }) {
  const { tela, ir } = useTela();
  const desloca = tela === "romaneio" ? "translateX(100%)" : tela === "programacao" ? "translateX(-100%)" : "none";
  return (
    <div style={{ overflowX: "clip" }}>
      {/* sem transform parado, para não mudar o posicionamento dos elementos fixos da tela */}
      <div style={{ transform: desloca, transition: DESLIZE }} aria-hidden={tela !== "inicio"}>
        {children}
      </div>
      <Seta lado="esquerda" visivel={tela === "inicio"} onClick={() => ir(ROMANEIO_ROTA)} rotulo="Romaneio" testid="seta-romaneio" />
      <Seta lado="direita" visivel={tela === "inicio"} onClick={() => ir(PROGRAMACAO_ROTA)} rotulo="Programação RQ C 008" testid="seta-programacao-rqc" />
    </div>
  );
}

// O iframe é criado na primeira visita e depois fica guardado fora da tela, para não recarregar.
export function RomaneioFrame() {
  const { tela, ir } = useTela();
  const queryClient = useQueryClient();

  useEffect(() => aplicarZoomDaTela(tela), [tela]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [montado, setMontado] = useState(tela !== "inicio");
  // de que lado o painel está estacionado e se ele está na tela
  const [lado, setLado] = useState<"esquerda" | "direita">(tela === "programacao" ? "direita" : "esquerda");
  const [naTela, setNaTela] = useState(false);
  const [semTransicao, setSemTransicao] = useState(false);

  const carregado = useRef(false);
  const avisarPagina = (t: Tela) => {
    if (t === "inicio" || !carregado.current) return;
    const filtroCliente = t === "programacao" ? filtroPendente : null;
    iframeRef.current?.contentWindow?.postMessage({ ripack: "programacao", abrir: t === "programacao", filtroCliente }, "*");
    filtroPendente = null;
  };

  useEffect(() => {
    if (tela === "inicio") {
      setNaTela(false);
      return;
    }
    setMontado(true);
    avisarPagina(tela);
    const novoLado = tela === "romaneio" ? "esquerda" : "direita";
    // já na tela e só trocando entre grade e Romaneio (ex.: calculadora de carga):
    // o painel fica parado, muda só o lado e as setas
    if (naTela && novoLado !== lado) {
      setLado(novoLado);
      return;
    }
    // trocar de lado é um salto sem animação; depois o painel desliza para dentro
    if (novoLado !== lado) {
      setSemTransicao(true);
      setNaTela(false);
      setLado(novoLado);
    }
    // um instante para o navegador desenhar a posição de partida antes de deslizar
    const id = setTimeout(() => {
      setSemTransicao(false);
      setNaTela(true);
    }, 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tela]);

  // "Sair" da grade da Programação volta para a tela inicial; "Inserir programação" criou
  // entregas: a lista da tela inicial recarrega
  useEffect(() => {
    const aoMensagem = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.data?.ripack === "programacao-fechou") ir("/");
      // a grade fechou indo para o romaneio (ex.: calculadora de carga): vira a tela do Romaneio
      if (ev.data?.ripack === "grade-virou-romaneio" && window.location.hash.replace(/^#/, "") === PROGRAMACAO_ROTA) {
        ir(ROMANEIO_ROTA);
      }
      if (ev.data?.ripack === "entregas-mudaram") queryClient.invalidateQueries();
      // "Copiar imagem" do Romaneio: o navegador recusou, então o app copia direto (Electron)
      if (ev.data?.ripack === "copiar-imagem") {
        const responder = (ok: boolean, erro?: string) =>
          iframeRef.current?.contentWindow?.postMessage({ ripack: "copiar-imagem-resultado", id: ev.data.id, ok, erro }, "*");
        const electron = (window as any)?.require?.("electron");
        if (!electron?.clipboard || !electron?.nativeImage) {
          responder(false, "Só o app do computador copia direto.");
          return;
        }
        try {
          const imagem = electron.nativeImage.createFromDataURL(String(ev.data.dataUrl));
          if (imagem.isEmpty()) throw new Error("imagem vazia");
          electron.clipboard.writeImage(imagem);
          responder(true);
        } catch (err) {
          responder(false, err instanceof Error ? err.message : "falha ao copiar");
        }
      }
      // botão "📗 Atualizar RQ C 008" da página: o app roda o script, envia a planilha e
      // responde quando acabar de verdade (sem contagem fixa)
      if (ev.data?.ripack === "rqc008-rodar") {
        const responder = (ok: boolean, texto: string) =>
          iframeRef.current?.contentWindow?.postMessage({ ripack: "rqc008-resultado", ok, texto }, "*");
        const electron = (window as any)?.require?.("electron");
        if (!electron) {
          responder(false, "Só funciona no app do computador da expedição.");
          return;
        }
        electron.ipcRenderer.invoke("rodar-rqc008")
          .then(async (r: { ok: boolean; lines: string[] }) => {
            if (!r.ok) {
              responder(false, r.lines[r.lines.length - 1] || "O script não terminou certo.");
              return;
            }
            await sincronizarRqc008(true);
            responder(true, "Planilha atualizada e enviada.");
          })
          .catch((err: unknown) => responder(false, err instanceof Error ? err.message : "Falha ao rodar o script."));
      }
    };
    window.addEventListener("message", aoMensagem);
    return () => window.removeEventListener("message", aoMensagem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!montado) return null;

  const fora = lado === "esquerda" ? "translateX(-100%)" : "translateX(100%)";
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-white"
        style={{
          transform: naTela ? "translateX(0)" : fora,
          // ao sair, só some de vez quando o deslize termina — mas para de pegar cliques na hora
          visibility: naTela ? "visible" : "hidden",
          pointerEvents: naTela ? "auto" : "none",
          transition: semTransicao ? "none" : naTela ? DESLIZE : `${DESLIZE}, visibility 0s linear ${DESLIZE_MS}ms`,
        }}
        aria-hidden={!naTela}
      >
        <iframe
          ref={iframeRef}
          src="./romaneio/index.html"
          title="Romaneio Ripack"
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
          onLoad={() => {
            carregado.current = true;
            avisarPagina(tela);
          }}
        />
      </div>
      <Seta lado="direita" visivel={tela === "romaneio"} onClick={() => ir("/")} rotulo="Programação de Entrega" testid="seta-voltar-do-romaneio" />
      <Seta lado="esquerda" visivel={tela === "programacao"} onClick={() => ir("/")} rotulo="Programação de Entrega" testid="seta-voltar-da-programacao" />
    </>
  );
}

// No computador que tem a RQ C 008, mantém a programação do Romaneio atualizada
// (fica no App para continuar rodando em qualquer tela).
export function RomaneioSync() {
  useEffect(() => {
    const electron = (window as any)?.require?.("electron");
    if (!electron || !rqc008Disponivel()) return;

    let parado = false;
    const sincronizar = (forcar = false) => {
      sincronizarRqc008(forcar)
        .then((r) => { if (r === "enviada") console.info("[romaneio] RQ C 008 enviada ao Romaneio"); })
        .catch((err) => { if (!parado) console.error("[romaneio] Falha ao enviar a RQ C 008:", err); });
    };

    sincronizar();
    const timer = setInterval(() => sincronizar(), VERIFICA_MS);
    // o botão "📗 Atualizar RQ C 008" do Romaneio roda o script pelo app e avisa aqui
    const aposScript = () => sincronizar(true);
    electron.ipcRenderer.on("rqc008-atualizada", aposScript);

    return () => {
      parado = true;
      clearInterval(timer);
      electron.ipcRenderer.removeListener("rqc008-atualizada", aposScript);
    };
  }, []);

  return null;
}
