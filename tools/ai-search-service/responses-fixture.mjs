/* Test-only fixture encoder: shared result scenarios use the current Responses wire envelope. */
export function responsesFixture(value) {
  const choice = value.choices?.[0], message = choice?.message ?? {}, output = [];
  if (typeof message.content === "string" && message.content) output.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: message.content }] });
  if (message.refusal) output.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: message.refusal }] });
  for (const call of message.tool_calls ?? []) output.push({ type: "function_call", status: "completed", call_id: call.id, name: call.function?.name, arguments: call.function?.arguments });
  if (message.content !== undefined && message.content !== null && typeof message.content !== "string") output.push({ type: "message", role: "assistant", content: message.content });
  const status = choice?.finish_reason === "tool_calls" && !message.tool_calls?.length ? "invalid" : choice?.finish_reason === "length" || choice?.finish_reason === "content_filter" ? "incomplete" : ["stop", "tool_calls", undefined, null].includes(choice?.finish_reason) ? "completed" : "invalid";
  return { ...value, choices: undefined, object: "response", id: "resp_mock", model: value.model, status, output,
    ...(status === "incomplete" ? { incomplete_details: { reason: choice.finish_reason === "length" ? "max_output_tokens" : "content_filter" } } : {}),
    ...(value.usage ? { usage: { input_tokens: value.usage.prompt_tokens, output_tokens: value.usage.completion_tokens,
      ...(value.usage.prompt_cache_hit_tokens === undefined ? {} : { input_tokens_details: { cached_tokens: value.usage.prompt_cache_hit_tokens } }) } } : {}) };
}

/** Evidence assertions project Responses Items to readable turns; wire assertions inspect raw payloads. */
export function responsesMessages(payload) {
  if (!Array.isArray(payload.input)) return payload.messages;
  return payload.input.map(item => item.type === "function_call_output" ? { role: "tool", tool_call_id: item.call_id, content: item.output }
    : item.type === "message" && Array.isArray(item.content) ? { ...item, content: item.content.filter(part => part.type === "output_text").map(part => part.text).join("") } : item);
}
