// Error diagnostics contain only model-authored text, never a provider envelope or tool trace.
export const MAX_RAW_RESPONSE_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function boundedModelText(value, secrets = []) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let text = value;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length) text = text.replaceAll(secret, "[REDACTED]");
  }
  const bytes = encoder.encode(text);
  let end = Math.min(bytes.byteLength, MAX_RAW_RESPONSE_BYTES);
  // End before a partial UTF-8 character, so the limit never adds a replacement character.
  if (end < bytes.byteLength) while ((bytes[end] & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.subarray(0, end));
}

export function withModelResponse(error, message, env = {}) {
  if (error?.code !== "UPSTREAM_RESPONSE_INVALID") return error;
  const text = [message?.content, message?.refusal]
    .filter(value => typeof value === "string" && value.trim()).join("\n\n");
  const rawResponse = boundedModelText(text, [env.UPSTREAM_API_KEY, env.VISITOR_HASH_SECRET]);
  if (rawResponse) error.rawResponse = rawResponse;
  return error;
}
