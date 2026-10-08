import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedModelText, withModelResponse, MAX_RAW_RESPONSE_BYTES } from "./model-response.mjs";

test("model diagnostics preserve text and bound UTF-8 without splitting characters", () => {
  const encoder = new TextEncoder();
  assert.equal(boundedModelText("  模型原文\n<script>plain text</script>  "), "  模型原文\n<script>plain text</script>  ");
  for (const text of ["a".repeat(20000), "爆".repeat(10000), "💥".repeat(10000), "a".repeat(16383) + "爆"]) {
    const bounded = boundedModelText(text);
    assert.ok(encoder.encode(bounded).byteLength <= MAX_RAW_RESPONSE_BYTES);
    assert.ok(text.startsWith(bounded));
    assert.doesNotMatch(bounded, /�/);
  }
  for (const value of [undefined, null, {}, [], 123, "", "   "]) assert.equal(boundedModelText(value), undefined);
});

test("only model content and refusal reach supported diagnostics, with known secrets removed", () => {
  const error = { code: "UPSTREAM_RESPONSE_INVALID" };
  withModelResponse(error, { content: "Raw model key mock-key.", refusal: "Refusal mock-secret.",
    reasoning_content: "PRIVATE_REASONING", tool_calls: [{ arguments: "PRIVATE_TOOL" }], headers: { authorization: "PRIVATE_HEADER" } },
  { UPSTREAM_API_KEY: "mock-key", VISITOR_HASH_SECRET: "mock-secret" });
  assert.equal(error.rawResponse, "Raw model key [REDACTED].\n\nRefusal [REDACTED].");
  assert.deepEqual(withModelResponse({ code: "UPSTREAM_UNAVAILABLE", response: "PRIVATE_EXCEPTION" }, { content: "NOT_A_FORMAT_FAILURE" }),
    { code: "UPSTREAM_UNAVAILABLE", response: "PRIVATE_EXCEPTION" });
  for (const message of [{}, { content: null }, { content: { text: "PRIVATE_OBJECT" } }, { refusal: ["PRIVATE_ARRAY"] }]) {
    assert.deepEqual(withModelResponse({ code: "UPSTREAM_RESPONSE_INVALID" }, message), { code: "UPSTREAM_RESPONSE_INVALID" });
  }
});
