/** Only final model text belongs in response diagnostics, never an upstream envelope. */
export const MAX_RAW_RESPONSE_BYTES = 16 * 1024;

export function boundedRawResponse(value: unknown, secrets: readonly string[] = []): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  // Include enough lookahead to redact a known credential crossing the cut.
  // A UTF-8 prefix cannot contain more than this many UTF-16 code units.
  const lookahead = secrets.reduce((longest, secret) => Math.max(longest, secret.length), 0);
  let source = value.slice(0, MAX_RAW_RESPONSE_BYTES + lookahead);
  for (const secret of secrets) if (secret) source = source.split(secret).join("[REDACTED]");
  source = source.replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|secret[_-]?key)["']?)\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,;}\]\r\n]+)/giu, '$1"[REDACTED]"');
  source = source.slice(0, MAX_RAW_RESPONSE_BYTES);
  if (/[\uD800-\uDBFF]$/u.test(source)) source = source.slice(0, -1);
  let bytes = 0, end = 0;
  for (const character of source) {
    const point = character.codePointAt(0)!;
    const width = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + width > MAX_RAW_RESPONSE_BYTES) break;
    bytes += width;
    end += character.length;
  }
  const result = source.slice(0, end);
  return result.trim() ? result : undefined;
}

/** Compatible content parts and refusal prose are safe fallbacks to final content. */
export function modelResponseText(message: Record<string, unknown>, secrets: readonly string[] = []): string | undefined {
  if (typeof message.content === "string" && message.content.trim()) return boundedRawResponse(message.content, secrets);
  if (Array.isArray(message.content)) {
    const parts: string[] = [];
    let remaining = MAX_RAW_RESPONSE_BYTES + secrets.reduce((longest, secret) => Math.max(longest, secret.length), 0);
    for (const part of message.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const text = part as Record<string, unknown>;
      if (!["text", "output_text"].includes(String(text.type)) || typeof text.text !== "string") continue;
      const value = text.text.slice(0, remaining);
      parts.push(value);
      remaining -= value.length + 1;
      if (remaining <= 0) break;
    }
    const content = boundedRawResponse(parts.join("\n"), secrets);
    if (content) return content;
  }
  return boundedRawResponse(message.refusal, secrets);
}
