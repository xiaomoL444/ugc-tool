// Select prompt excerpts without changing stored uses or treating suggestions as facts.
function normalized(value) { return value.normalize("NFKC").toLowerCase(); }
function queryTerms(query) {
  const source = normalized(query).replace(/有没有|有沒有|能不能|适合|適合|适用|適用|音效|声音|聲音|资源|資源|时候|時候|想要|需要/gu, " ");
  const terms = new Set();
  for (const part of source.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(part)) {
      const characters = [...part];
      for (let size = 2; size <= Math.min(4, characters.length); size++) {
        for (let start = 0; start + size <= characters.length; start++) terms.add(characters.slice(start, start + size).join(""));
      }
    } else if (part.length > 1 && !/^(?:a|an|the|for|of|to|sound|sounds|audio|effect|effects)$/u.test(part)) terms.add(part);
  }
  return [...terms];
}

export function selectSuggestedUses(uses, query, limit = 3, maxLength = 160) {
  const terms = queryTerms(typeof query === "string" ? query : "");
  const seen = new Set();
  return (Array.isArray(uses) ? uses : []).filter(value => {
    if (typeof value !== "string" || !value.trim()) return false;
    const key = normalized(value.trim());
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map((value, index) => {
    const source = normalized(value);
    return { value, index, score: terms.reduce((sum, term) => sum + (source.includes(term) ? [...term].length ** 2 : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit).map(item => item.value.slice(0, maxLength));
}
