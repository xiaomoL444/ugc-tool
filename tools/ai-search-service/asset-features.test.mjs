import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compileLexicalIndex } from './asset-search.mjs';
import { FEATURE_LOCALES, parseAssetFeatureSidecar, verifyAssetFeatureSidecar, normalizeAssetFeatureResources, computeAssetCatalogVersion, computeAssetFeatureSourceHash, extractAssetFeatureDictionaries, computeLexicalFeatureHash, computeLexicalIndexHash } from './asset-features.mjs';
const require = createRequire(import.meta.url);
const { compileSidecar, reindex } = require('../../scripts/export-ai-asset-features.cjs');
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value) + '\n';
function fixture(kind = 'effect') {
  const project = kind === 'effect' ? 'EffectPlayer' : 'SoundEffectPlayer';
  const namespace = kind === 'effect' ? 'effectPlayer' : 'soundEffectPlayer';
  const i18n = Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, {}]));
  const metadata = { schemaVersion: 1 };
  for (const part of kind === 'effect' ? ['standVisual', 'tailVisual', 'audio'] : ['audio']) {
    const stem = `${namespace}.search.1.${part}`;
    metadata[part] = { status: 'generated', origin: 'ai', model: 'test-model', responseModel: 'actual-model', generatedAt: '2026-10-08T00:00:00Z',
      sourceSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), inputMethod: part === 'audio' ? 'audio' : 'frames',
      shortDescriptionI18nKey: `${stem}.short`, descriptionI18nKey: `${stem}.detail`, keywordsI18nKeys: [`${stem}.keywords.0`],
      possibleSourcesI18nKeys: [`${stem}.possible_sources.0`], suggestedUsesI18nKeys: [`${stem}.suggested_uses.0`], uncertainDetailsI18nKeys: [`${stem}.uncertain_details.0`] };
    for (const locale of FEATURE_LOCALES) Object.assign(i18n[locale], { [`${stem}.short`]: `${locale} ${part} short`, [`${stem}.detail`]: `${locale} ${part} detail`,
      [`${stem}.keywords.0`]: `${part} keyword`, [`${stem}.possible_sources.0`]: 'unconfirmed-source', [`${stem}.suggested_uses.0`]: `${part} suggestion`, [`${stem}.uncertain_details.0`]: 'unconfirmed-detail' });
  }
  const identities = { schemaVersion: 1, indexVersion: 'identity-test', assets: [{ resourceId: `${kind}:1`, id: '1', kind, titles: { 'zh-CN': 'catalog title' }, hasAudio: true,
    facetTexts: { feature: 'catalog title original category' } }] };
  return { sidecar: { schemaVersion: 1, project, kind, resources: { 1: { searchMetadata: metadata } }, i18n, baseIndexVersion: identities.indexVersion }, identities };
}
test('full multilingual stand/tail/audio fields resolve without crossing evidence or suggestion facets', async () => {
  const { sidecar, identities } = fixture();
  const rawMetadata = structuredClone(sidecar.resources[1].searchMetadata), rawDictionaries = structuredClone(sidecar.i18n);
  await compileSidecar(sidecar, identities);
  assert.deepEqual(sidecar.resources[1].searchMetadata, rawMetadata);
  assert.deepEqual(sidecar.i18n, rawDictionaries);
  const asset = normalizeAssetFeatureResources(sidecar, identities)[0];
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']) {
    assert.match(asset.description[locale], /standVisual short/);
    assert.match(asset.description[locale], /tailVisual short/);
    assert.match(asset.detailedDescription[locale], /tailVisual detail/);
    assert.match(asset.audio.description[locale], /audio short/);
  }
  assert.match(asset.facetTexts.feature, /standVisual keyword/);
  assert.doesNotMatch(asset.facetTexts.feature, /audio keyword|suggestion|unconfirmed/);
  assert.doesNotMatch(asset.facetTexts.audio, /standVisual|tailVisual|catalog title|suggestion|unconfirmed/);
  assert.match(asset.facetTexts.suggestion, /standVisual suggestion/);
  assert.match(asset.facetTexts.audioSuggestion, /audio suggestion/);
  const lean = normalizeAssetFeatureResources(sidecar, identities, { includeFacetTexts: false })[0];
  assert.equal('facetTexts' in lean, false);
  assert.equal('searchMetadata' in lean, false);
  assert.deepEqual(lean.audio, asset.audio);
});
test('project i18n resolves five locales without duplicating text in the disk sidecar', async () => {
  const { sidecar, identities } = fixture(); await compileSidecar(sidecar, identities);
  const expectedHash = sidecar.lexicalFeatureHash, embedded = sidecar.i18n;
  const external = { ...sidecar, i18nSource: 'project-i18n-v1' }; delete external.i18n;
  const dictionaries = Object.fromEntries(FEATURE_LOCALES.map((locale, index) => [
    ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU'][index],
    { translations: { originalName: 'base name', ...Object.fromEntries(Object.entries(embedded[locale]).map(([key, value]) => [key.replace(/^effectPlayer\./, ''), value])) }, revision: 'base metadata' },
  ]));
  const hydrated = await verifyAssetFeatureSidecar(external, { identities, dictionaries });
  assert.equal(hydrated.lexicalFeatureHash, expectedHash);
  assert.equal('i18n' in external, false);
  for (const locale of FEATURE_LOCALES) assert.deepEqual(Object.entries(hydrated.i18n[locale]), Object.entries(embedded[locale]));
  assert.equal(normalizeAssetFeatureResources(hydrated, identities)[0].audio.description['en-US'], 'en-us audio short');
  dictionaries['zh-CN'].translations.originalName = 'new base name';
  await verifyAssetFeatureSidecar(external, { identities, dictionaries });
  const key = external.resources[1].searchMetadata.audio.shortDescriptionI18nKey.replace(/^effectPlayer\./, '');
  dictionaries['zh-CN'].translations[key] = 'edited external feature';
  await assert.rejects(verifyAssetFeatureSidecar(external, { identities, dictionaries }), /source hash mismatch/);
  await compileSidecar(external, identities, { dictionaries });
  assert.equal(normalizeAssetFeatureResources(external, identities)[0].audio.description['zh-CN'], 'edited external feature');
  assert.notEqual(external.lexicalFeatureHash, expectedHash);
  const incomplete = { ...dictionaries }; delete incomplete['en-US'];
  assert.throws(() => parseAssetFeatureSidecar(external, { identities, dictionaries: incomplete }), /Incomplete project/);
  assert.throws(() => extractAssetFeatureDictionaries('EffectPlayer', Object.fromEntries(FEATURE_LOCALES.map(locale => [locale, { 'effectPlayer.search.x': 'one', 'search.x': 'two' }]))), /Duplicate normalized/);
});

test('aggregate source version includes all raw dictionary hashes even for an unchanged feature file', async () => {
  const hashes = Object.fromEntries(FEATURE_LOCALES.map((locale, index) => [locale, String(index + 1).repeat(64)]));
  const original = await computeAssetFeatureSourceHash('a'.repeat(64), hashes);
  assert.equal(original, await computeAssetFeatureSourceHash('a'.repeat(64), Object.fromEntries(Object.entries(hashes).reverse())));
  for (const locale of FEATURE_LOCALES) assert.notEqual(original, await computeAssetFeatureSourceHash('a'.repeat(64), { ...hashes, [locale]: 'f'.repeat(64) }));
  await assert.rejects(computeAssetFeatureSourceHash('a'.repeat(64), {}), /dictionary hash/);
});

test('sound descriptions resolve from audio while unavailable effect parts contribute no invented evidence', async () => {
  const sound = fixture('sound'); await compileSidecar(sound.sidecar, sound.identities);
  const audioAsset = normalizeAssetFeatureResources(sound.sidecar, sound.identities)[0];
  assert.match(audioAsset.description['en-US'], /audio short/); assert.deepEqual(audioAsset.audio.description, {});
  const effect = fixture();
  for (const locale of FEATURE_LOCALES) for (const key of Object.keys(effect.sidecar.i18n[locale])) if (key.includes('.standVisual.')) delete effect.sidecar.i18n[locale][key];
  effect.sidecar.resources[1].searchMetadata.standVisual = { status: 'not_available' };
  effect.identities.assets[0].hasAudio = false;
  await compileSidecar(effect.sidecar, effect.identities);
  const asset = normalizeAssetFeatureResources(effect.sidecar, effect.identities)[0];
  assert.doesNotMatch(asset.facetTexts.feature, /standVisual|audio short/); assert.equal(asset.facetTexts.audio, '');
  assert.equal(effect.sidecar.resources[1].searchMetadata.standVisual.status, 'not_available');
});
test('source/hash/base/ID/reference/size mismatches are rejected instead of searching stale descriptors', async () => {
  const { sidecar, identities } = fixture(); await compileSidecar(sidecar, identities);
  const changed = structuredClone(sidecar); changed.i18n['zh-cn'][changed.resources[1].searchMetadata.audio.shortDescriptionI18nKey] += ' edited';
  await assert.rejects(verifyAssetFeatureSidecar(changed, { identities }), /source hash mismatch/);
  const unknown = structuredClone(sidecar); unknown.resources[2] = unknown.resources[1]; delete unknown.resources[1];
  assert.throws(() => parseAssetFeatureSidecar(unknown, { identities }), /Unknown feature resource/);
  const missing = structuredClone(sidecar); delete missing.i18n['en-us'][missing.resources[1].searchMetadata.audio.shortDescriptionI18nKey];
  assert.throws(() => parseAssetFeatureSidecar(missing), /Dangling/);
  const orphan = structuredClone(sidecar); orphan.i18n['zh-cn']['effectPlayer.search.1.audio.unowned'] = 'extra';
  assert.throws(() => parseAssetFeatureSidecar(orphan), /Unowned/);
  const oversized = structuredClone(sidecar); oversized.resources[1].searchMetadata.audio.keywordsI18nKeys = Array(65).fill('effectPlayer.search.1.audio.keywords.0');
  assert.throws(() => parseAssetFeatureSidecar(oversized), /array reference/);
  assert.throws(() => parseAssetFeatureSidecar(sidecar, { baseIndexVersion: 'another-version' }), /baseIndexVersion mismatch/);
});
test('lexical matches the shared compiler; tampering and out-of-range postings fail validation', async () => {
  const { sidecar, identities } = fixture(); await compileSidecar(sidecar, identities);
  const compiled = compileLexicalIndex({ assets: normalizeAssetFeatureResources(sidecar, identities) });
  for (const field of ['format', 'docs', 'postings', 'averageLength']) assert.deepEqual(sidecar.lexical[field], compiled[field]);
  const changed = structuredClone(sidecar); changed.lexical.averageLength += 1;
  await assert.rejects(verifyAssetFeatureSidecar(changed, { identities }), /index hash mismatch/);
  const invalid = structuredClone(sidecar); invalid.lexical.postings.invalid = Buffer.from(new Uint32Array([999999 * 8 + 1]).buffer).toString('base64');
  assert.throws(() => parseAssetFeatureSidecar(invalid, { identities }), /out of range/);
});
test('source and lexical hashes use bounded deterministic UTF-8 blocks across supplementary characters', async () => {
  const { sidecar } = fixture();
  for (const locale of FEATURE_LOCALES) for (const key in sidecar.i18n[locale]) sidecar.i18n[locale][key] = '🚀'.repeat(9000);
  const lexical = { format: 'uint32-base64-v1', averageLength: 4, docs: Array.from({ length: 6000 }, (_, index) => [`effect:${index}`, 'feature', 4]), postings: { unicode: 'AAAA'.repeat(40000) } };
  const original = crypto.subtle.digest; let maximumBytes = 0, calls = 0;
  crypto.subtle.digest = function(algorithm, data) { maximumBytes = Math.max(maximumBytes, data.byteLength); calls++; return original.call(this, algorithm, data); };
  try {
    const first = await computeLexicalFeatureHash(sidecar), second = await computeLexicalFeatureHash(JSON.parse(JSON.stringify(sidecar)));
    assert.equal(first, second);
    const indexHash = await computeLexicalIndexHash(lexical); lexical.docs[0][2]++;
    assert.notEqual(indexHash, await computeLexicalIndexHash(lexical));
    assert.ok(calls > 10); assert.ok(maximumBytes <= 196608, `SHA block was ${maximumBytes} bytes`);
  } finally { crypto.subtle.digest = original; }
});
test('offline export restores data bytes, preserves translation entries and supports project i18n reindex', async () => {
  const exportRoot = path.join(root, 'exports'); await mkdir(exportRoot, { recursive: true });
  const directory = await mkdtemp(path.join(exportRoot, '.asset-features-test-'));
  try {
    const source = path.join(directory, 'source'), output = path.join(directory, 'publication'), baselines = path.join(directory, 'baselines');
    const expected = new Map(), originalSources = new Map();
    for (const kind of ['sound', 'effect', 'bgm']) {
      const project = { sound: 'SoundEffectPlayer', effect: 'EffectPlayer', bgm: 'BgmPlayer' }[kind];
      const namespace = { sound: 'soundEffectPlayer', effect: 'effectPlayer', bgm: 'bgmPlayer' }[kind];
      const f = kind === 'bgm' ? null : fixture(kind);
      const row = { id: '1', nameI18nKey: `${namespace}.data.1`, duration: 1, path: 'original/media.mp3', hasAudio: true, audioPath: '1.mp3' };
      const baselineData = kind === 'effect' ? { effectData: { 1: row }, TagData: {}, category: [] } : { data: [row], category: [] };
      const currentData = structuredClone(baselineData);
      if (f) (kind === 'effect' ? currentData.effectData[1] : currentData.data[0]).searchMetadata = f.sidecar.resources[1].searchMetadata;
      const dataRelative = `${project}/data.json`, currentBytes = Buffer.from(json(currentData)), baselineBytes = Buffer.from('\r\n' + JSON.stringify(baselineData, null, 3) + '\r\n');
      await mkdir(path.join(source, project, 'i18n'), { recursive: true }); await writeFile(path.join(source, dataRelative), currentBytes); originalSources.set(dataRelative, currentBytes);
      if (f) { await mkdir(path.join(baselines, project, 'i18n'), { recursive: true }); await writeFile(path.join(baselines, project, 'data.json'), baselineBytes); expected.set(dataRelative, baselineBytes); }
      for (const locale of FEATURE_LOCALES) {
        const name = { [`${namespace}.data.1`]: `${locale} original name` }, relative = `${project}/i18n/${locale}.json`;
        const bytes = Buffer.from(json({ ...name, ...(f?.sidecar.i18n[locale] || {}) })); await writeFile(path.join(source, relative), bytes); originalSources.set(relative, bytes);
        if (f) {
          const baseline = Buffer.from(JSON.stringify(name, null, 4) + '\r\n');
          await writeFile(path.join(baselines, project, kind === 'sound' ? '' : 'i18n', `${locale}.json`), baseline); expected.set(relative, bytes);
        }
      }
    }
    const identitiesFilename = path.join(directory, 'identities.json'), manifestFilename = path.join(directory, 'manifest.json');
    const args = [path.join(root, 'scripts/export-ai-asset-features.cjs'), '--source', source, '--output', output, '--backups', path.join(directory, 'backups'),
      '--bgm-source-output', path.join(directory, 'auxiliary'), '--sound-baseline', path.join(baselines, 'SoundEffectPlayer'), '--effect-baseline', path.join(baselines, 'EffectPlayer'), '--identities', identitiesFilename, '--manifest', manifestFilename];
    const run = () => { const result = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
    run(); const firstManifest = await readFile(manifestFilename); run(); assert.deepEqual(await readFile(manifestFilename), firstManifest);
    const manifest = JSON.parse(firstManifest);
    assert.ok(manifest.outputHashes['SoundEffectPlayer/features.json']);
    assert.ok(manifest.outputHashes['EffectPlayer/features.json']);
    assert.equal(Object.keys(manifest.outputHashes).some(relative => /^AISearch\//.test(relative)), false);
    for (const [relative, bytes] of expected) assert.equal(sha(await readFile(path.join(output, relative))), sha(bytes));
    for (const [relative, bytes] of originalSources) {
      assert.deepEqual(await readFile(path.join(source, relative)), bytes);
      assert.deepEqual(await readFile(path.join(manifest.backupDirectory, relative)), bytes);
    }
    // Once data has been published without metadata, the exporter must consume
    // the separated provenance and translations instead of losing descriptors.
    for (const project of ['SoundEffectPlayer', 'EffectPlayer']) {
      for (const relative of [project + '/data.json', project + '/features.json']) await writeFile(path.join(source, relative), await readFile(path.join(output, relative)));
    }
    const publishedFeatureBytes = await readFile(path.join(output, 'EffectPlayer/features.json'));
    run(); const separatedManifest = await readFile(manifestFilename); run(); assert.deepEqual(await readFile(manifestFilename), separatedManifest);
    assert.deepEqual(await readFile(path.join(output, 'EffectPlayer/features.json')), publishedFeatureBytes);
    const featureFilename = path.join(output, 'EffectPlayer/features.json');
    const fullFilename = path.join(directory, 'full-catalog.json'), builtIdentitiesFilename = path.join(directory, 'built-identities.json');
    const build = spawnSync(process.execPath, [path.join(root, 'scripts/build-ai-asset-catalog.cjs'), '--base', output, '--bgm-base', path.join(directory, 'auxiliary'), '--output', fullFilename, '--identities-output', builtIdentitiesFilename], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const fullCatalog = JSON.parse(await readFile(fullFilename));
    assert.deepEqual(await readFile(builtIdentitiesFilename), await readFile(identitiesFilename));
    const rawHashes = {};
    for (const kind of ['sound', 'effect']) {
      const project = kind === 'sound' ? 'SoundEffectPlayer' : 'EffectPlayer';
      const dictionaryHashes = Object.fromEntries(await Promise.all(FEATURE_LOCALES.map(async locale => [locale, sha(await readFile(path.join(output, project, 'i18n', locale + '.json')))])));
      rawHashes[kind] = await computeAssetFeatureSourceHash(sha(await readFile(path.join(output, project, 'features.json'))), dictionaryHashes);
    }
    assert.equal(fullCatalog.indexVersion, await computeAssetCatalogVersion(manifest.baseIndexVersion, rawHashes));
    assert.equal(fullCatalog.indexVersion, await computeAssetCatalogVersion(manifest.baseIndexVersion, { effect: rawHashes.effect, sound: rawHashes.sound }));
    assert.notEqual(fullCatalog.indexVersion, await computeAssetCatalogVersion(manifest.baseIndexVersion, { ...rawHashes, effect: sha((await readFile(featureFilename, 'utf8')) + '\n') }));
    const edited = JSON.parse(await readFile(featureFilename));
    assert.equal(edited.i18nSource, 'project-i18n-v1'); assert.equal('i18n' in edited, false);
    const dictionaryFile = path.join(output, 'EffectPlayer/i18n/zh-cn.json');
    const translated = JSON.parse(await readFile(dictionaryFile)); translated[edited.resources[1].searchMetadata.audio.shortDescriptionI18nKey] = 'manual edited audio';
    await writeFile(dictionaryFile, json(translated)); await reindex(featureFilename, identitiesFilename);
    const dictionaries = Object.fromEntries(await Promise.all(FEATURE_LOCALES.map(async locale => [locale, JSON.parse(await readFile(path.join(output, 'EffectPlayer/i18n', locale + '.json')))])));
    const identities = JSON.parse(await readFile(identitiesFilename)), sidecar = await verifyAssetFeatureSidecar(await readFile(featureFilename, 'utf8'), { identities, dictionaries });
    assert.equal('i18n' in JSON.parse(await readFile(featureFilename)), false);
    assert.equal(normalizeAssetFeatureResources(sidecar, identities)[0].audio.description['zh-CN'], 'manual edited audio');
    assert.equal(sidecar.resources[1].searchMetadata.audio.responseModel, 'actual-model');
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(exportRoot) + path.sep), 'Test cleanup must remain inside exports');
    await rm(directory, { recursive: true, force: true });
  }
});
