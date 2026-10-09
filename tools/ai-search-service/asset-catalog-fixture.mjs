import { compileLexicalIndex } from './asset-search.mjs';
import { computeLexicalFeatureHash, computeLexicalIndexHash, normalizeAssetFeatureResources, FEATURE_LOCALES, FEATURE_HASH_ALGORITHM } from './asset-features.mjs';
export function identityFixture() {
  const assets = ['sound', 'effect', 'bgm'].flatMap(kind => [1, 2].map(id => ({ resourceId: `${kind}:${id}`, id: String(id), kind,
    titles: { 'zh-CN': `${kind} identity ${id}` }, hasAudio: kind !== 'effect' || id === 1,
    description: {}, detailedDescription: {}, keywords: {}, suggestedUses: {},
    audio: { description: {}, detailedDescription: {}, keywords: {}, suggestedUses: {} },
    facetTexts: { feature: `${kind} identity ${id}`, audio: '', suggestion: '', audioSuggestion: '' } })));
  const catalog = { schemaVersion: 1, indexVersion: 'synthetic-identities-v1', sourceBase: 'offline-fixture', assets,
    coverage: { total: assets.length, byKind: { sound: 2, effect: 2, bgm: 2 } } };
  catalog.lexical = compileLexicalIndex(catalog); return catalog;
}
export async function featureFixture(kind, identities, text = '雷声 thunder', uses = 'storm ambience') {
  const project = { sound: 'SoundEffectPlayer', effect: 'EffectPlayer', bgm: 'BgmPlayer' }[kind];
  const namespace = { sound: 'soundEffectPlayer', effect: 'effectPlayer', bgm: 'bgmPlayer' }[kind];
  const sidecar = { schemaVersion: 1, hashAlgorithm: FEATURE_HASH_ALGORITHM, project, kind, baseIndexVersion: identities.indexVersion, resources: {},
    i18n: Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, {}])) };
  for (const asset of identities.assets.filter(asset => asset.kind === kind)) {
    const parts = kind === 'effect' ? ['standVisual', 'tailVisual', 'audio'] : ['audio'];
    const metadata = { schemaVersion: 1 };
    for (const part of parts) {
      if (part === 'audio' && !asset.hasAudio) { metadata[part] = { status: 'catalog_no_audio' }; continue; }
      const root = `${namespace}.search.${asset.id}.${part}`;
      metadata[part] = { status: 'generated', shortDescriptionI18nKey: `${root}.short`, descriptionI18nKey: `${root}.detail`,
        keywordsI18nKeys: [`${root}.keywords.0`], suggestedUsesI18nKeys: [`${root}.suggested_uses.0`] };
      for (const locale of FEATURE_LOCALES) Object.assign(sidecar.i18n[locale], {
        [`${root}.short`]: part === 'standVisual' ? '蓝色光环 blue ring' : part === 'tailVisual' ? '消散粒子 fade' : text,
        [`${root}.detail`]: part === 'standVisual' ? '旋转的蓝色光环 rotating blue ring' : part === 'tailVisual' ? '缓慢消散的粒子 slowly fading particles' : `${text} detailed`,
        [`${root}.keywords.0`]: part === 'audio' ? text : part === 'standVisual' ? 'blue' : 'fade', [`${root}.suggested_uses.0`]: uses,
      });
    }
    sidecar.resources[asset.id] = { searchMetadata: metadata };
  }
  sidecar.lexicalFeatureHash = await computeLexicalFeatureHash(sidecar);
  sidecar.lexical = compileLexicalIndex({ assets: normalizeAssetFeatureResources(sidecar, identities) });
  Object.assign(sidecar.lexical, { hashAlgorithm: FEATURE_HASH_ALGORITHM, featureHash: sidecar.lexicalFeatureHash, baseIndexVersion: sidecar.baseIndexVersion,
    integrityHash: await computeLexicalIndexHash(sidecar.lexical) });
  return sidecar;
}
export const featureResponse = (sidecar, etag = '"fixture-v1"') => new Response(JSON.stringify(sidecar), {
  headers: { 'content-type': 'application/json; charset=utf-8', etag },
});
