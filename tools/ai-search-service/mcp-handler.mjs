/* Read-only, stateless Streamable HTTP. No model credentials travel through MCP. */
const VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"];
const schema = properties => ({ type: "object", properties, additionalProperties: false });
const string = { type: "string" };
export const ASSET_TOOLS = [
  { name: "search_assets", description: "Search the complete sound, effect and BGM catalogue. scope is the kind to return; matchOn is the evidence to search. Explosion visuals: scope=effect, matchOn=visual. Explosion sounds: scope=sound, matchOn=audio. An effect's explosion sound / effects with an explosion soundtrack: scope=effect, matchOn=audio, filters.hasAudio=true. Having audio or looking explosive is not proof of an explosion soundtrack. Returns bounded descriptions and trusted IDs. Continue with nextCursor; read selected details with get_assets.",
    inputSchema: { ...schema({ query: string, locale: { ...string, default: "zh-CN" }, scope: { enum: ["all", "sound", "effect", "bgm"], default: "all" },
      includeEffectAudio: { type: "boolean", default: true }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }, cursor: string,
      matchOn: { enum: ["any", "visual", "audio"], default: "any", description: "For effects, visual searches appearance and audio searches only the effect's own described soundtrack. Ordinary sound and BGM assets use their audio feature descriptions. includeEffectAudio only broadens sound scope to effect soundtracks." },
      previousIds: { type: "array", items: string, maxItems: 50 }, previousQuery: { type: "string", maxLength: 2000 },
      excludeIds: { type: "array", items: string, maxItems: 50 },
      searchType: { enum: ["feature", "suggestion", "both"] },
      filters: schema({ minDuration: { type: "number", minimum: 0 }, maxDuration: { type: "number", minimum: 0 }, hasAudio: { type: "boolean" },
        isLoop: { type: "boolean" }, includeTerms: { type: "array", items: string, maxItems: 10 }, excludeTerms: { type: "array", items: string, maxItems: 10 } }) }), required: ["query"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
  { name: "get_assets", description: "Read details of up to 10 known resource IDs, such as sound:40106. Returns missingIds for unknown IDs. Chinese audio descriptions may accompany translated titles; descriptionLocale identifies the text language. Resource links open the original asset page.",
    inputSchema: { ...schema({ ids: { type: "array", items: string, maxItems: 10 }, locale: string }), required: ["ids"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
  { name: "get_asset_catalog", description: "Read catalogue version, per-type counts and description coverage. Does not return every asset or invoke a chat model.",
    inputSchema: schema({}), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
];
const response = (body, status = 200, version) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(version ? { "mcp-protocol-version": version } : {}) },
});
const rpcError = (id, code, message, status = 200) => response({ jsonrpc: "2.0", id, error: { code, message } }, status);

export async function handleMcp(message, handlers, protocolVersion) {
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string"
    || (Object.hasOwn(message, "id") && typeof message.id !== "string" && typeof message.id !== "number")) {
    return rpcError(null, -32600, "Invalid JSON-RPC request", 400);
  }
  if (protocolVersion && !VERSIONS.includes(protocolVersion)) return rpcError(message.id ?? null, -32600, "Unsupported MCP protocol version", 400);
  const id = message.id;
  if (id === undefined) {
    if (message.method.startsWith("notifications/")) return response(null, 202);
    return rpcError(null, -32600, "Request id is required", 400);
  }
  const ok = (result, version = protocolVersion) => response({ jsonrpc: "2.0", id, result }, 200, version);
  if (message.method === "initialize") {
    const version = VERSIONS.includes(message.params?.protocolVersion) ? message.params.protocolVersion : "2025-06-18";
    return ok({ protocolVersion: version, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ugc-asset-search", version: "1.0.0" },
      instructions: "Search summaries first and read selected details. Use resource IDs for results; description coverage and language are explicit. Retrieval does not guarantee every semantic match." }, version);
  }
  if (message.method === "ping") return ok({});
  if (message.method === "tools/list") return ok({ tools: ASSET_TOOLS });
  if (message.method !== "tools/call") return rpcError(id, -32601, "Method not found");
  const name = message.params?.name;
  const args = message.params?.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) return rpcError(id, -32602, "Tool arguments must be an object");
  if (!ASSET_TOOLS.some(tool => tool.name === name)) return rpcError(id, -32602, "Unknown tool");
  try {
    const result = await (name === "search_assets" ? handlers.search(args) : name === "get_assets" ? handlers.assets(args) : handlers.catalog());
    return ok({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false });
  } catch (error) {
    return ok({ content: [{ type: "text", text: JSON.stringify({ error: { code: error.code ?? "SEARCH_UNAVAILABLE", message: error.code ? error.message : "Asset search is temporarily unavailable." } }) }], isError: true });
  }
}
