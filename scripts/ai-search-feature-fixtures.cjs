// Synthetic complete sidecars for frontend tests; no source files or services are read.
const locales = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru'];
function createFeatureSidecar(project, entries) {
  const kind = project === 'SoundEffectPlayer' ? 'sound' : project === 'BgmPlayer' ? 'bgm' : 'effect';
  const namespace = kind === 'sound' ? 'soundEffectPlayer' : kind === 'bgm' ? 'bgmPlayer' : 'effectPlayer';
  const sidecar = { schemaVersion: 1, project, kind, baseIndexVersion: 'fixture-identities', resources: {}, i18n: Object.fromEntries(locales.map(locale => [locale, {}])) };
  for (const [id, parts] of Object.entries(entries)) {
    const searchMetadata = { schemaVersion: 1 };
    for (const [partName, part] of Object.entries(parts)) {
      const metadata = { status: part.status || 'generated' };
      if (metadata.status === 'generated') {
        for (const [field, value] of [['shortDescriptionI18nKey', part.short], ['descriptionI18nKey', part.description]]) {
          if (!value) continue;
          const key = `${namespace}.search.${id}.${partName}.${field === "shortDescriptionI18nKey" ? "short" : "detail"}`;
          metadata[field] = key;
          for (const locale of locales) sidecar.i18n[locale][key] = typeof value === 'string' ? value : value[locale] || value['zh-cn'];
        }
        for (const [field, values] of [['keywordsI18nKeys', part.keywords], ['suggestedUsesI18nKeys', part.uses], ['possibleSourcesI18nKeys', part.possibleSources], ['uncertainDetailsI18nKeys', part.uncertainDetails]]) {
          if (!values?.length) continue;
          metadata[field] = values.map((value, index) => {
            const key = `${namespace}.search.${id}.${partName}.${({ keywordsI18nKeys: "keywords", suggestedUsesI18nKeys: "suggested_uses", possibleSourcesI18nKeys: "possible_sources", uncertainDetailsI18nKeys: "uncertain_details" })[field]}.${index}`;
            for (const locale of locales) sidecar.i18n[locale][key] = typeof value === 'string' ? value : value[locale] || value['zh-cn'];
            return key;
          });
        }
      }
      searchMetadata[partName] = metadata;
    }
    sidecar.resources[id] = { searchMetadata };
  }
  return sidecar;
}
function featuresFromLegacy(source) {
  const rows = source.kind === 'effect' ? Object.values(source.data.effectData || {}) : source.data.data;
  const entries = {};
  for (const row of rows) {
    if (!/^\d{1,12}$/.test(String(row.id))) continue;
    const read = field => row[`${field}I18nKey`] ? source.dictionaries['zh-CN']?.[row[`${field}I18nKey`]] || '' : row[field] || '';
    const terms = field => String(read(field)).split(/[\n,，;；|、]+/u).map(value => value.trim()).filter(Boolean);
    const parts = {};
    if (source.kind === 'effect') {
      const short = read('visualShortDescription') || read('visualDescription') || read('shortDescription') || read('description');
      if (short) parts.standVisual = { short, keywords: terms('visualKeywords'), uses: terms('suggestedUses') };
      const audio = read('audioShortDescription') || read('audioDescription');
      if (audio) parts.audio = { short: audio, keywords: terms('audioKeywords'), uses: terms('audioSuggestedUses') };
    } else {
      const short = read('shortDescription') || read('description');
      if (short) parts.audio = { short, keywords: terms('keywords'), uses: terms('suggestedUses') };
    }
    entries[String(row.id)] = parts;
  }
  return createFeatureSidecar(source.project, entries);
}
module.exports = { createFeatureSidecar, featuresFromLegacy };
