/** Choose query-relevant suggestion excerpts, retaining stable order for equal scores. */
export function selectSuggestedUses(uses: readonly string[], query: string, limit?: number, maxLength?: number): string[];
