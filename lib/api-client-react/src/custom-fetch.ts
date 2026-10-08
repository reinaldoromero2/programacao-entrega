export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  offlineReplay?: boolean;
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const OFFLINE_DB_NAME = "programacao-entrega-offline";
const OFFLINE_DB_VERSION = 1;
const CACHE_STORE = "responses";
const QUEUE_STORE = "requests";

type CachedResponse = { key: string; value: unknown; savedAt: number };
type QueuedRequest = {
  id: number;
  url: string;
  method: string;
  headers: [string, string][];
  body?: string;
  /** id provisório (negativo) da entrega criada sem servidor; vira o id real no envio */
  tempId?: number;
};
type OfflineSnapshot = {
  version: number;
  generatedAt: string;
  entregas: Array<Record<string, unknown>>;
  motoristas: unknown[];
  motivos: unknown[];
  clientes: unknown[];
  faturamentoDiario: unknown[];
  faturamentoMeta: unknown[];
};

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCached(key: string): Promise<unknown | undefined> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(key);
    request.onsuccess = () => resolve((request.result as CachedResponse | undefined)?.value);
    request.onerror = () => reject(request.error);
  });
}

async function writeCached(key: string, value: unknown): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put({ key, value, savedAt: Date.now() } satisfies CachedResponse);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function readSnapshot(): Promise<OfflineSnapshot | undefined> {
  return readCached("__offline_snapshot__") as Promise<OfflineSnapshot | undefined>;
}

async function syncSnapshot(): Promise<void> {
  if (!_baseUrl || typeof navigator !== "undefined" && !navigator.onLine) return;
  try {
    const response = await fetch(`${_baseUrl}/api/sync/snapshot`);
    if (response.ok) await writeCached("__offline_snapshot__", await response.json());
  } catch {
    // A temporary connection failure must not affect the local application.
  }
}

async function queueRequest(request: Omit<QueuedRequest, "id">): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const operation = db.transaction(QUEUE_STORE, "readwrite").objectStore(QUEUE_STORE).add(request);
    operation.onsuccess = () => resolve();
    operation.onerror = () => reject(operation.error);
  });
}

async function readQueuedRequests(): Promise<QueuedRequest[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(QUEUE_STORE, "readonly").objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(request.result as QueuedRequest[]);
    request.onerror = () => reject(request.error);
  });
}

async function removeQueuedRequest(id: number): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(QUEUE_STORE, "readwrite").objectStore(QUEUE_STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Servidor fora (sem internet, servidor caído/travado ou banco sem cota): o app continua
// com a cópia local e guarda as gravações numa fila, que é reenviada sozinha.
// ---------------------------------------------------------------------------

const SERVIDOR_FORA_KEY = "api-servidor-fora-ate";
const SERVIDOR_FORA_MS = 30_000;
const TEMPO_LEITURA_MS = 30_000;
// criar entrega espera mais: se desistir cedo e o servidor gravar mesmo assim, duplicaria no reenvio
const TEMPO_GRAVACAO_MS = 60_000;
const REENVIO_MS = 20_000;
const IDS_TEMPORARIOS_KEY = "__ids_temporarios__";
const ID_TEMPORARIO_NA_URL = /\/api\/entregas\/(-\d+)(?=$|[/?])/;

function servidorMarcadoFora(): boolean {
  try { return Date.now() < Number(localStorage.getItem(SERVIDOR_FORA_KEY) || 0); } catch { return false; }
}

let sondaAgendada = false;
function marcarServidorFora(): void {
  try { localStorage.setItem(SERVIDOR_FORA_KEY, String(Date.now() + SERVIDOR_FORA_MS)); } catch { /* sem armazenamento */ }
  // quando passar o prazo, pergunta ao servidor se voltou (sem isso a tela ficava na cópia local)
  if (!sondaAgendada && typeof window !== "undefined") {
    sondaAgendada = true;
    window.setTimeout(() => { sondaAgendada = false; void sondarServidor(); }, SERVIDOR_FORA_MS + 1000);
  }
}

// o servidor respondeu: sai do modo "fora do ar" e, se estava nele, a tela busca tudo de novo
// (a cópia local podia estar velha — ex.: entregas incluídas pela grade RQ C 008)
export function marcarServidorOk(): void {
  let estavaFora = false;
  try { estavaFora = localStorage.getItem(SERVIDOR_FORA_KEY) !== null; localStorage.removeItem(SERVIDOR_FORA_KEY); } catch { /* sem armazenamento */ }
  if (estavaFora && typeof window !== "undefined") window.dispatchEvent(new Event("api-fila-enviada"));
}

// pergunta leve (não toca no banco): mantém o servidor do Render acordado e detecta a volta dele
async function sondarServidor(): Promise<void> {
  if (!_baseUrl || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  try {
    const r = await fetchComTempo(`${_baseUrl}/api/healthz`, { cache: "no-store" }, TEMPO_LEITURA_MS);
    if (r.ok) marcarServidorOk(); else if (servidorIndisponivel(r.status)) marcarServidorFora();
  } catch {
    marcarServidorFora();
  }
}

/** respostas que querem dizer "servidor indisponível agora", não "pedido errado" */
function servidorIndisponivel(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/** fetch com tempo máximo; quem passa o próprio signal (ex.: React Query) controla o cancelamento */
async function fetchComTempo(input: RequestInfo | URL, init: RequestInit, ms: number): Promise<Response> {
  if (init.signal || typeof AbortController === "undefined") return fetch(input, init);
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controle.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function temFila(): Promise<boolean> {
  return (await readQueuedRequests().catch(() => [])).length > 0;
}

function trocarIdsTemporarios(texto: string, mapa: Record<string, number>): string {
  return texto.replace(ID_TEMPORARIO_NA_URL, (todo, temp: string) => (mapa[temp] ? `/api/entregas/${mapa[temp]}` : todo));
}

function trocarIdsNoCorpo(body: string | undefined, mapa: Record<string, number>): string | undefined {
  if (!body) return body;
  try {
    const dados = JSON.parse(body) as Record<string, unknown>;
    if (!Array.isArray(dados.ids)) return body;
    return JSON.stringify({ ...dados, ids: (dados.ids as unknown[]).map((id) => (typeof id === "number" && id < 0 && mapa[id] ? mapa[id] : id)) });
  } catch {
    return body;
  }
}

let reenviando = false;
const falhas500: Record<number, number> = {};

async function replayQueuedRequests(): Promise<void> {
  if (reenviando || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  reenviando = true;
  let enviou = false;
  try {
    const mapa = ((await readCached(IDS_TEMPORARIOS_KEY).catch(() => undefined)) ?? {}) as Record<string, number>;
    for (const queued of await readQueuedRequests()) {
      const url = trocarIdsTemporarios(queued.url, mapa);
      // a criação dessa entrega não foi aceita pelo servidor: não há o que alterar
      if (ID_TEMPORARIO_NA_URL.test(url)) {
        await removeQueuedRequest(queued.id);
        continue;
      }
      let response: Response;
      try {
        response = await fetchComTempo(url, {
          method: queued.method,
          headers: Object.fromEntries(queued.headers),
          body: trocarIdsNoCorpo(queued.body, mapa),
        }, TEMPO_GRAVACAO_MS);
      } catch {
        marcarServidorFora();
        break;
      }
      if (!response.ok && response.status === 500) {
        // defeito daquele pedido, não servidor fora: tenta por uns 10 min e depois desiste dele,
        // para não travar a fila (e o app na cópia local) para sempre
        falhas500[queued.id] = (falhas500[queued.id] || 0) + 1;
        if (falhas500[queued.id] < 30) break;
        delete falhas500[queued.id];
      } else if (!response.ok && servidorIndisponivel(response.status)) {
        marcarServidorFora();
        break;
      }
      // aceito, ou recusado de vez (4xx: tentar de novo não adiantaria e travaria a fila)
      if (response.ok && queued.tempId !== undefined) {
        const criado = await response.json().catch(() => null) as { id?: number } | null;
        if (criado && typeof criado.id === "number") {
          mapa[queued.tempId] = criado.id;
          await writeCached(IDS_TEMPORARIOS_KEY, mapa).catch(() => {});
        }
      }
      await removeQueuedRequest(queued.id);
      enviou = true;
    }
  } finally {
    reenviando = false;
  }
  if (enviou && !(await temFila())) {
    marcarServidorOk();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("api-fila-enviada"));
  }
}

async function applyOfflineDeliveryMutation(url: string, method: string, body: string | undefined, tempId?: number): Promise<void> {
  if (!url.includes("/api/entregas")) return;
  const payload = body ? JSON.parse(body) as Record<string, unknown> : {};
  const idMatch = url.match(/\/api\/entregas\/(-?\d+)$/);
  const id = idMatch ? Number(idMatch[1]) : undefined;
  const db = await openOfflineDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(CACHE_STORE, "readwrite");
    const store = transaction.objectStore(CACHE_STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result as IDBCursorWithValue | null;
      if (!cursor) return;
      const cached = cursor.value as CachedResponse;
      // só listas de entregas (antes uma entrega nova entrava até na lista de motoristas guardada)
      if (Array.isArray(cached.value) && /\/api\/entregas(\?|$)/.test(String(cached.key))) {
        let deliveries = cached.value as Array<Record<string, unknown>>;
        if (method === "POST" && url.endsWith("/api/entregas")) {
          const newDelivery: Record<string, unknown> = { ...payload, id: tempId ?? -Date.now(), sortOrder: payload.sortOrder ?? deliveries.length, checked: payload.checked ?? "none", nf: payload.nf ?? "none", cg: payload.cg ?? "none" };
          const queryDate = new URL(cached.key).searchParams.get("date");
          if (!queryDate || queryDate === newDelivery.date) deliveries = [...deliveries, newDelivery];
        } else if (id !== undefined && method === "DELETE") {
          deliveries = deliveries.filter((delivery) => delivery.id !== id);
        } else if (id !== undefined && method === "PATCH") {
          deliveries = deliveries.map((delivery) => delivery.id === id ? { ...delivery, ...payload } : delivery);
        } else if (method === "POST" && url.endsWith("/reorder")) {
          const order = payload.ids as number[] | undefined;
          if (order) deliveries = deliveries.map((delivery) => ({ ...delivery, sortOrder: order.indexOf(Number(delivery.id)) }));
        }
        cursor.update({ ...cached, value: deliveries, savedAt: Date.now() });
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

if (typeof window !== "undefined") {
  // a cópia local não é apagada depois do reenvio: se o servidor cair de novo, ainda há o que mostrar
  window.addEventListener("online", () => {
    void replayQueuedRequests().then(syncSnapshot).catch(() => {});
  });
  window.setInterval(() => { void replayQueuedRequests().catch(() => {}); }, REENVIO_MS);
  // o Render grátis dorme depois de um tempo parado e leva ~1 min para acordar: uma pergunta
  // leve a cada 10 min (só /api/healthz, sem banco) mantém ele acordado enquanto o app está aberto
  window.setInterval(() => { void sondarServidor(); }, 10 * 60 * 1000);
  void replayQueuedRequests().catch(() => {});
  void syncSnapshot();
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
  if (_baseUrl && typeof window !== "undefined") void syncSnapshot();
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, offlineReplay = false, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const isApiRequest = requestInfo.url.includes("/api/");
  const isRead = method === "GET" || method === "HEAD";

  const lerCopiaLocal = async (): Promise<T | undefined> => {
    const cached = await readCached(requestInfo.url).catch(() => undefined);
    if (cached !== undefined) return cached as T;

    const snapshot = await readSnapshot().catch(() => undefined);
    if (snapshot) {
      if (requestInfo.url.includes("/api/entregas")) {
        const date = new URL(requestInfo.url).searchParams.get("date");
        return snapshot.entregas.filter((item) => !date || item.date === date) as T;
      }
      if (requestInfo.url.endsWith("/api/motoristas")) return snapshot.motoristas as T;
      if (requestInfo.url.endsWith("/api/motivos-cancelamento")) return snapshot.motivos as T;
      if (requestInfo.url.endsWith("/api/clientes-cadastro")) return snapshot.clientes as T;
      if (requestInfo.url.startsWith(`${_baseUrl}/api/faturamento`)) {
        const mes = new URL(requestInfo.url).searchParams.get("mes");
        const daily = snapshot.faturamentoDiario.filter((item) => !mes || String((item as Record<string, unknown>).date).startsWith(mes));
        const meta = snapshot.faturamentoMeta.find((item) => (item as Record<string, unknown>).mes === mes);
        return { mes, meta: meta ? Number((meta as Record<string, unknown>).meta) : null, dias: daily } as T;
      }
    }
    return undefined;
  };

  // grava na fila e responde como se o servidor tivesse aceitado; a tela segue normal
  const guardarNaFila = async (): Promise<T> => {
    const body = typeof init.body === "string" ? init.body : undefined;
    const criaEntrega = method === "POST" && requestInfo.url.endsWith("/api/entregas");
    const tempId = criaEntrega ? -Date.now() : undefined;
    await queueRequest({ url: requestInfo.url, method, headers: Array.from(headers.entries()), body, tempId });
    await applyOfflineDeliveryMutation(requestInfo.url, method, body, tempId).catch(() => {});

    if (method === "DELETE") return null as T;
    if (criaEntrega) {
      const dados = body ? JSON.parse(body) as Record<string, unknown> : {};
      return { ...dados, id: tempId, sortOrder: dados.sortOrder ?? 0, checked: dados.checked ?? "none", nf: dados.nf ?? "none", cg: dados.cg ?? "none" } as T;
    }
    return {} as T;
  };

  const podeFicarOffline = isApiRequest && !offlineReplay && method !== "HEAD";
  const semInternet = typeof navigator !== "undefined" && !navigator.onLine;
  // com gravação ainda na fila, o servidor não tem tudo: a cópia local é a mais atual
  const usarLocal = podeFicarOffline && (semInternet || servidorMarcadoFora() || await temFila());

  if (usarLocal && isRead) {
    const local = await lerCopiaLocal();
    if (local !== undefined) return local;
  }
  // gravações entram atrás das que já estão na fila, para manter a ordem
  if (usarLocal && !isRead) return guardarNaFila();

  let response: Response;
  try {
    response = await fetchComTempo(input, { ...init, method, headers }, isRead ? TEMPO_LEITURA_MS : TEMPO_GRAVACAO_MS);
  } catch (error) {
    // cancelado por quem pediu (ex.: a tela fechou): não é problema do servidor
    if (!podeFicarOffline || init.signal?.aborted) throw error;
    marcarServidorFora();
    if (isRead) {
      const local = await lerCopiaLocal();
      if (local !== undefined) return local;
      throw error;
    }
    return guardarNaFila();
  }

  if (!response.ok) {
    // 500 é defeito daquele pedido, não servidor fora: só esse pedido usa a cópia local (antes, um
    // único endereço com erro deixava o app inteiro na cópia local, às vezes velha). Servidor caído
    // ou acordando (502/503/504/429/408) põe tudo no modo offline.
    if (podeFicarOffline && servidorIndisponivel(response.status)) {
      const so500 = response.status === 500;
      if (!so500) marcarServidorFora();
      if (isRead) {
        const local = await lerCopiaLocal();
        if (local !== undefined) return local;
      } else if (!so500) {
        return guardarNaFila();
      }
    }
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  if (isApiRequest && !offlineReplay) marcarServidorOk();
  const data = (await parseSuccessBody(response, responseType, requestInfo)) as T;
  if (isApiRequest && isRead && responseType !== "blob") {
    await writeCached(requestInfo.url, data).catch(() => {});
    if (requestInfo.url.endsWith("/api/sync/snapshot")) await writeCached("__offline_snapshot__", data).catch(() => {});
  }
  return data;
}
