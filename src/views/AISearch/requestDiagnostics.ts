import { boundedRawResponse } from "./responseDiagnostics";

export interface RequestDiagnostic {
  stage: "model" | "site" | "catalog" | "search" | "assets" | "prompt";
  kind: "http" | "network" | "timeout" | "response";
  endpoint?: string;
  status?: number;
  providerCode?: string;
  providerMessage?: string;
  parameter?: string;
  requestId?: string;
  model?: string;
  round?: number;
  elapsedMs?: number;
  browserMessage?: string;
}
export interface RequestContext {
  stage: RequestDiagnostic["stage"];
  endpoint: string;
  model?: string;
  round?: number;
  startedAt?: number;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stages = ["model", "site", "catalog", "search", "assets", "prompt"];
const kinds = ["http", "network", "timeout", "response"];

function safeEndpoint(value: unknown, secrets: readonly string[]): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return;
    return safeText(`${url.origin}${url.pathname}`, 2048, secrets, false);
  } catch {
    // Same-origin Worker URLs may be relative. Never retain their query string.
    if (/^\/[^/]/u.test(value)) return safeText(value.split(/[?#]/u, 1)[0], 2048, secrets, false);
  }
}
function safeText(value: unknown, limit: number, secrets: readonly string[], cleanUrls = true): string | undefined {
  let text = boundedRawResponse(value, secrets);
  if (!text) return;
  text = text.replace(/\bBearer\s+[^\s"',;]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, "[REDACTED]");
  if (cleanUrls) text = text.replace(/https?:\/\/[^\s<>"']+/giu, url => safeEndpoint(url, secrets) ?? "[URL]");
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "").slice(0, limit).trim() || undefined;
}

/** Diagnostics contain public error fields only: no headers, request bodies or account data. */
export function sanitizeRequestDiagnostic(raw: unknown, secrets: readonly string[] = []): RequestDiagnostic | undefined {
  const source = object(raw);
  if (!stages.includes(String(source.stage)) || !kinds.includes(String(source.kind))) return;
  const result: RequestDiagnostic = { stage: source.stage as RequestDiagnostic["stage"], kind: source.kind as RequestDiagnostic["kind"] };
  const endpoint = safeEndpoint(source.endpoint, secrets);
  if (endpoint) result.endpoint = endpoint;
  for (const [field, limit] of [["providerCode", 160], ["providerMessage", 1200], ["parameter", 160], ["requestId", 200], ["model", 200], ["browserMessage", 400]] as const) {
    const value = safeText(source[field], limit, secrets);
    if (value) result[field] = value;
  }
  if (Number.isInteger(source.status) && Number(source.status) >= 100 && Number(source.status) <= 599) result.status = Number(source.status);
  if (Number.isInteger(source.round) && Number(source.round) >= 1 && Number(source.round) <= 3) result.round = Number(source.round);
  if (typeof source.elapsedMs === "number" && Number.isFinite(source.elapsedMs) && source.elapsedMs >= 0) result.elapsedMs = Math.min(3600000, Math.round(source.elapsedMs));
  return result;
}
export function responseRequestDiagnostic(response: Response, context: RequestContext, kind: RequestDiagnostic["kind"] = "response", secrets: readonly string[] = []): RequestDiagnostic {
  return sanitizeRequestDiagnostic({ ...context, kind, status: response.status,
    requestId: response.headers.get("x-request-id") || response.headers.get("request-id") || response.headers.get("cf-ray") || undefined,
    elapsedMs: context.startedAt === undefined ? undefined : Date.now() - context.startedAt }, secrets)!;
}
export function transportRequestDiagnostic(error: unknown, context: RequestContext, signal?: AbortSignal, secrets: readonly string[] = []): RequestDiagnostic {
  const cause = object(error);
  const timeout = signal?.aborted || cause.name === "AbortError" || cause.name === "TimeoutError";
  return sanitizeRequestDiagnostic({ ...context, kind: timeout ? "timeout" : "network",
    browserMessage: typeof cause.message === "string" ? `${typeof cause.name === "string" ? cause.name + ": " : ""}${cause.message}` : undefined,
    elapsedMs: context.startedAt === undefined ? undefined : Date.now() - context.startedAt }, secrets)!;
}

/** Read a small clone of an HTTP error; invalid JSON must not hide the HTTP status. */
export async function httpRequestDiagnostic(response: Response, context: RequestContext, secrets: readonly string[] = []): Promise<RequestDiagnostic> {
  const diagnostic = responseRequestDiagnostic(response, context, "http", secrets);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return diagnostic;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size <= 8192) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) return diagnostic;
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = object(JSON.parse(new TextDecoder().decode(bytes)));
    const error = object(payload.error);
    // Whitelist public provider fields; never save the error envelope or an HTML proxy page.
    return sanitizeRequestDiagnostic({ ...diagnostic, providerCode: error.code ?? error.type,
      providerMessage: error.message ?? payload.message, parameter: error.param }, secrets)!;
  } catch { return diagnostic; }
  finally { if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); } }
}
