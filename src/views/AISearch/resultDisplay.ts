import { parseModelJSON } from "../../../tools/ai-search-service/model-json.mjs";
import { boundedRawResponse } from "./responseDiagnostics";
import { MAX_SEARCH_RESULTS } from "./resultLimits";
import type { ResourceCard } from "./types";

export interface ResultDisplay { answer: string; cards: ResourceCard[] }

/** Display failed recommendations without treating their IDs as trusted assets. */
export function recoverResultDisplay(raw: unknown, resources: readonly ResourceCard[], secrets: string[] = []): ResultDisplay | undefined {
  let value = raw;
  if (typeof value === "string") {
    try { value = parseModelJSON(value); } catch { return; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const result = value as Record<string, unknown>;
  if (typeof result.answer !== "string" || !Array.isArray(result.matches)) return;
  const safeText = (value: unknown, maximum: number) => typeof value === "string"
    ? (boundedRawResponse(value, secrets) ?? "").slice(0, maximum) : "";
  const known = new Map(resources.map(item => [item.resourceId, item]));
  const cards: ResourceCard[] = result.matches.slice(0, MAX_SEARCH_RESULTS).flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const match = value as Record<string, unknown>;
    const resourceId = safeText(typeof match.resourceId === "number" && Number.isFinite(match.resourceId)
      ? String(match.resourceId) : match.resourceId, 200);
    if (!resourceId.trim()) return [];
    const resource = known.get(resourceId);
    const identity = /^(sound|effect|bgm):\d{1,12}$/u.exec(resourceId);
    const card: ResourceCard = resource && !resource.unresolved ? { ...resource } : {
      resourceId, id: resourceId, kind: identity ? resourceId.split(":")[0] as ResourceCard["kind"] : "sound",
      title: "", description: "", keywords: [], suggestedUses: [], href: "", unresolved: true,
    };
    return [{ ...card, matchReason: safeText(match.reason, 800),
      matchType: match.matchType === "feature" || match.matchType === "suggestion" ? match.matchType : undefined }];
  });
  return cards.length ? { answer: safeText(result.answer, 6000), cards } : undefined;
}
