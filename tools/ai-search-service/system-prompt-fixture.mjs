/* Artificial source fixture: not a backup of the production system prompt. */
import { SYSTEM_PROMPT_URL } from "./system-prompt.mjs";
export const TEST_SYSTEM_PROMPT = "TEST_PROMPT_SOURCE\n测试：最多 RESULT\\_LIMIT 条。返回 JSON。";
export const promptResponse = (source = TEST_SYSTEM_PROMPT) => new Response(source, { headers: { "content-type": "text/markdown; charset=utf-8" } });
export function withPromptFetch(providerFetch) {
  return async (url, options) => {
    const requested = new URL(String(url));
    const source = new URL(SYSTEM_PROMPT_URL);
    if (requested.origin === source.origin && requested.pathname === source.pathname && options?.method === "GET") {
      return promptResponse();
    }
    return providerFetch(url, options);
  };
}
