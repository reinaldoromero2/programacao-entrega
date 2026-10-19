import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

// Comprime as respostas (listas do Romaneio, entregas, imagens em base64). Sem isso cada busca
// saía como texto puro e a transferência do Render (5 GB/mês no plano grátis) esgotou em
// 2026-10-19, com o serviço suspenso. JSON costuma cair para 1/5 a 1/10 do tamanho.
const TAMANHO_MIN = 1024;

export function compressao(req: Request, res: Response, next: NextFunction): void {
  const aceita = String(req.headers["accept-encoding"] || "");
  const br = /\bbr\b/.test(aceita);
  const gz = /\bgzip\b/.test(aceita);
  if (!br && !gz) { next(); return; }

  const enviar = res.send.bind(res);
  res.send = function (corpo?: unknown): Response {
    res.vary("Accept-Encoding");
    if (res.getHeader("Content-Encoding") || req.method === "HEAD" || res.statusCode === 204 || res.statusCode === 304) {
      return enviar(corpo as never);
    }
    // res.json chega aqui com o texto já pronto; objetos viram JSON como o Express faria
    let dados: Buffer;
    if (typeof corpo === "string") dados = Buffer.from(corpo, "utf8");
    else if (Buffer.isBuffer(corpo)) dados = corpo;
    else if (corpo && typeof corpo === "object") { res.type("json"); dados = Buffer.from(JSON.stringify(corpo), "utf8"); }
    else return enviar(corpo as never);
    if (dados.length < TAMANHO_MIN) return enviar(corpo as never);

    if (!res.getHeader("Content-Type")) res.type(typeof corpo === "string" ? "html" : "bin");
    const comprimido = br
      ? brotliCompressSync(dados, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: dados.length } })
      : gzipSync(dados, { level: 6 });
    res.setHeader("Content-Encoding", br ? "br" : "gzip");
    res.removeHeader("Content-Length");
    return enviar(comprimido);
  } as Response["send"];
  next();
}
