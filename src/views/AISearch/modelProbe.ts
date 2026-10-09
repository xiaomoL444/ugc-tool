import type { ModelConfig } from "./types";
import { AISearchError, modelConnection, modelResponseEnvelope, chatToolCompatibilityOptions, fetchAISearch, readAISearchJSON, providerRequestError } from "./aiSearchService";
import { modelHeaders, toAnthropicRequest } from "./modelProtocol";
import { responseRequestDiagnostic, sanitizeRequestDiagnostic } from "./requestDiagnostics";
import type { RequestContext } from "./requestDiagnostics";
import { record } from "./resourceCatalog";

export interface ModelProbeResult {
  requestedModel: string;
  returnedModel?: string;
  protocol: "openai" | "anthropic";
  endpoint: string;
  elapsedMs: number;
  replyTruncated?: boolean;
}

/** One manually initiated, short model call. No assets, Worker or saved conversations. */
export async function probeCustomModel(config: ModelConfig, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ModelProbeResult> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!config.apiKey.trim() || !config.model.trim() || config.model.length > 100) throw new AISearchError("CONFIG");
  const { url, protocol } = modelConnection(config);
  const context: RequestContext = { stage: "model", endpoint: url, model: config.model.trim(), round: 1, startedAt: Date.now() };
  const secrets = [config.apiKey.trim()];
  const chatRequest = { model: config.model.trim(), stream: false,
    ...(protocol === "openai" && new URL(url).hostname === "api.openai.com" ? { max_completion_tokens: 128 } : { max_tokens: 128 }),
    ...(protocol === "openai" ? chatToolCompatibilityOptions(url, config.model) : {}),
    messages: [{ role: "user", content: "Connection test. Reply only OK." }] };
  let headers: Record<string, string>, body: string;
  try {
    headers = modelHeaders(protocol, config.apiKey.trim());
    body = JSON.stringify(protocol === "anthropic" ? toAnthropicRequest(chatRequest) : chatRequest);
  } catch { throw new AISearchError("CONFIG"); }
  const response = await fetchAISearch(url, { method: "POST", signal, headers, body }, context, fetcher, secrets);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!response.ok) throw await providerRequestError(response, context, secrets);
  const envelope = await readAISearchJSON(response, context, signal, secrets);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const diagnostic = responseRequestDiagnostic(response, context, "response", secrets);
  const raw = modelResponseEnvelope(envelope, protocol, response, context, secrets);
  if (!Array.isArray(raw.choices) || !raw.choices.length) throw new AISearchError("INVALID_RESPONSE", undefined, undefined, diagnostic);
  const choice = record(raw.choices[0]);
  if (!choice.message || typeof choice.message !== "object" || Array.isArray(choice.message)) throw new AISearchError("INVALID_RESPONSE", undefined, undefined, diagnostic);
  const message = record(choice.message);
  // A bounded reasoning model may spend its test budget before writing text.
  // It still answered this call; report truncation separately, without claiming tool support.
  const truncated = choice.finish_reason === "length";
  if (!truncated && !(typeof message.content === "string" && message.content.trim()) && !message.refusal) throw new AISearchError("EMPTY_RESPONSE", undefined, undefined, diagnostic);
  const identity = sanitizeRequestDiagnostic({ stage: "model", kind: "response", model: raw.model }, secrets)?.model;
  return { requestedModel: sanitizeRequestDiagnostic({ ...context, kind: "response" }, secrets)?.model || "",
    ...(identity ? { returnedModel: identity } : {}), protocol, endpoint: diagnostic.endpoint || url,
    elapsedMs: Math.max(0, Date.now() - context.startedAt!), ...(truncated ? { replyTruncated: true } : {}) };
}
