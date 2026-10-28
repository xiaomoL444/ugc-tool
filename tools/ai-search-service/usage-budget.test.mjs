import { test } from "node:test";
import assert from "node:assert/strict";
import { usageCostMicros } from "./usage-budget.mjs";
import { normalizeResponsesResponse, normalizeResponsesUsage } from "./model-responses.mjs";

const config = { inputRate: 2, cachedInputRate: 0.04, outputRate: 8, costSafety: 1.25 };

test("cached input is retained through Responses normalization and billed separately without safety markup", () => {
  const raw = { object: "response", status: "completed", output: [], usage: {
    input_tokens: 1000000, input_tokens_details: { cached_tokens: 900000 }, output_tokens: 1000 } };
  const { usage } = normalizeResponsesResponse(raw);
  assert.deepEqual(usage, { prompt_tokens: 1000000, prompt_cache_hit_tokens: 900000, completion_tokens: 1000 });
  // 100k uncached + 900k cached + 1k output = 0.244 CNY, not 2.51 CNY.
  assert.equal(usageCostMicros(usage, config, 3000000, 5400), 244000);
  assert.deepEqual(normalizeResponsesUsage(raw.usage), usage);
});

test("missing or malformed cache counts never grant an unearned discount", () => {
  for (const cached of [undefined, -1, 1000001, 1.5, "900000", NaN, Infinity]) {
    assert.equal(usageCostMicros({ prompt_tokens: 1000000, completion_tokens: 1000, prompt_cache_hit_tokens: cached },
      config, 3000000, 5400), 2008000);
  }
  assert.equal(usageCostMicros({ prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 100 },
    { inputRate: 2, outputRate: 8 }, 1000, 100), 280, "Other providers default to their configured input rate");
});

test("unbounded, fractional, negative and missing core usage never release an unknown reservation", () => {
  for (const usage of [undefined, {}, { prompt_tokens: 101, completion_tokens: 10 },
    { prompt_tokens: 100, completion_tokens: 11 }, { prompt_tokens: -1, completion_tokens: 0 },
    { prompt_tokens: 1.5, completion_tokens: 1 }, { prompt_tokens: "100", completion_tokens: 1 }]) {
    assert.equal(usageCostMicros(usage, config, 100, 10), null);
  }
});
