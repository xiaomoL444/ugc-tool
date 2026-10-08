#!/usr/bin/env node
// Offline and idempotent: reads source/baselines, writes only a local publication package.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { buildIdentityCatalog, dictionary, LOCALES, SOURCES } = require('./build-ai-asset-catalog.cjs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASELINES = {
  SoundEffectPlayer: { root: 'H:/mihoyo Assets/GenshinAsserts/UGCAsserts/UGC_AudioSFX/reports/search-descriptions-20261008/source-snapshots', flat: true },
  EffectPlayer: { root: 'H:/mihoyo Assets/GenshinAsserts/UGCAsserts/UGC_Effect/reports/search-descriptions-20261008/merge-stages/20261007T203223-9055424bf3/backup', flat: false },
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const serialized = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');
async function writeIfChanged(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  try { if ((await fs.readFile(filename)).equals(bytes)) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${filename}.export-tmp`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, filename);
}
function assertLocalOutput(filename) {
  const absolute = path.resolve(filename), relative = path.relative(PROJECT_ROOT, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Output must stay inside this project');
  return absolute;
}
function stripMetadata(data, kind) {
  const result = structuredClone(data), rows = kind === 'effect' ? Object.values(result.effectData) : result.data;
  for (const row of rows) delete row.searchMetadata;
  return result;
}
async function compileSidecar(sidecar, identities, options = {}) {
  const { parseAssetFeatureSidecar, normalizeAssetFeatureResources, computeLexicalFeatureHash, computeLexicalIndexHash, verifyAssetFeatureSidecar, FEATURE_HASH_ALGORITHM } = await import('../tools/ai-search-service/asset-features.mjs');
  const { compileLexicalIndex } = await import('../tools/ai-search-service/asset-search.mjs');
  Object.assign(sidecar, parseAssetFeatureSidecar(sidecar, { ...options, identities, baseIndexVersion: identities.indexVersion, requireCompiled: false }));
  const assets = normalizeAssetFeatureResources(sidecar, identities);
  sidecar.hashAlgorithm = FEATURE_HASH_ALGORITHM;
  sidecar.lexicalFeatureHash = await computeLexicalFeatureHash(sidecar);
  sidecar.lexical = compileLexicalIndex({ assets });
  sidecar.lexical.featureHash = sidecar.lexicalFeatureHash;
  sidecar.lexical.baseIndexVersion = sidecar.baseIndexVersion;
  sidecar.lexical.hashAlgorithm = FEATURE_HASH_ALGORITHM;
  sidecar.lexical.integrityHash = await computeLexicalIndexHash(sidecar.lexical);
  await verifyAssetFeatureSidecar(sidecar, { ...options, identities, baseIndexVersion: identities.indexVersion });
  return sidecar;
}
async function reindex(filename, identitiesFilename) {
  const output = assertLocalOutput(filename), identities = parse(await fs.readFile(identitiesFilename));
  const sidecar = parse(await fs.readFile(output));
  const dictionaries = {};
  if (sidecar.i18nSource === 'project-i18n-v1') for (const locale of LOCALES) dictionaries[locale.toLowerCase()] = parse(await fs.readFile(path.join(path.dirname(output), 'i18n', locale.toLowerCase() + '.json')));
  await compileSidecar(sidecar, identities, Object.keys(dictionaries).length ? { dictionaries } : {});
  if (sidecar.i18nSource === 'project-i18n-v1') delete sidecar.i18n;
  const bytes = serialized(sidecar); await writeIfChanged(output, bytes);
  return { output, bytes: bytes.length, baseIndexVersion: sidecar.baseIndexVersion, lexicalFeatureHash: sidecar.lexicalFeatureHash, apiCalls: 0 };
}
async function main(argv = process.argv.slice(2)) {
  const options = { source: 'R:/ugc-tool-data', output: path.join(PROJECT_ROOT, 'exports/ugc-tool-data'),
    backups: path.join(PROJECT_ROOT, 'exports/ai-asset-feature-backups'), bgmSourceOutput: path.join(PROJECT_ROOT, 'exports/ai-asset-source'),
    identities: path.join(PROJECT_ROOT, 'tools/ai-search-service/generated/asset-identities.json'), manifest: path.join(PROJECT_ROOT, 'exports/ai-asset-feature-export-manifest.json') };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--help') {
      console.log('node scripts/export-ai-asset-features.cjs [--source LOCAL_DIR] [--output LOCAL_DIR] [--backups LOCAL_DIR] [--bgm-source-output LOCAL_DIR] [--sound-baseline LOCAL_DIR] [--effect-baseline LOCAL_DIR] [--identities JSON_PATH] [--manifest JSON_PATH]\nnode scripts/export-ai-asset-features.cjs --reindex LOCAL_FEATURE_JSON [--identities LOCAL_IDENTITY_JSON]'); return;
    }
    const name = { '--source': 'source', '--output': 'output', '--backups': 'backups', '--bgm-source-output': 'bgmSourceOutput', '--sound-baseline': 'soundBaseline', '--effect-baseline': 'effectBaseline', '--identities': 'identities', '--manifest': 'manifest', '--reindex': 'reindex' }[argv[index]];
    if (!name || !argv[index + 1]) throw new Error('Unknown or missing CLI option'); options[name] = argv[++index];
  }
  if (options.reindex) { console.log(JSON.stringify(await reindex(options.reindex, options.identities), null, 2)); return; }
  for (const key of ['output', 'backups', 'bgmSourceOutput', 'identities', 'manifest']) options[key] = assertLocalOutput(options[key]);
  const snapshots = [], sourceFiles = new Map(), restorationFiles = new Map(), drafts = [], report = [];
  for (const source of SOURCES) {
    const dataRelative = `${source.project}/data.json`, dataBytes = await fs.readFile(path.join(options.source, dataRelative));
    sourceFiles.set(dataRelative, dataBytes);
    const currentData = parse(dataBytes), dictionaries = {}, currentDictionaries = {};
    for (const locale of LOCALES) {
      const relative = `${source.project}/i18n/${locale.toLowerCase()}.json`, bytes = await fs.readFile(path.join(options.source, relative));
      sourceFiles.set(relative, bytes); currentDictionaries[locale.toLowerCase()] = parse(bytes);
    }
    if (source.kind === 'bgm') {
      for (const locale of LOCALES) dictionaries[locale] = dictionary(currentDictionaries[locale.toLowerCase()], source.namespace);
      snapshots.push({ ...source, data: currentData, dictionaries });
      continue;
    }
    const baseline = { ...BASELINES[source.project], root: source.kind === 'sound' ? options.soundBaseline || BASELINES[source.project].root : options.effectBaseline || BASELINES[source.project].root };
    const originalDataBytes = await fs.readFile(path.join(baseline.root, 'data.json')), originalData = parse(originalDataBytes);
    const stripped = stripMetadata(currentData, source.kind);
    assert.deepStrictEqual(stripped, originalData, `${source.project}: non-AI data differs from the original snapshot`);
    assert.equal(JSON.stringify(stripped), JSON.stringify(originalData), `${source.project}: original resource/key order changed`);
    restorationFiles.set(dataRelative, originalDataBytes);
    const rows = source.kind === 'effect' ? Object.values(currentData.effectData) : currentData.data;
    let resources = Object.fromEntries(rows.filter(row => row.searchMetadata).map(row => [row.id, { searchMetadata: row.searchMetadata }]));
    // Rerunning after publication reads the already-separated provenance file.
    if (!Object.keys(resources).length) {
      const relative = source.project + '/features.json';
      let bytes;
      try { bytes = await fs.readFile(path.join(options.source, relative)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (bytes) {
        const previous = parse(bytes);
        assert.equal(previous.project, source.project, 'Existing feature project mismatch');
        assert.equal(previous.kind, source.kind, 'Existing feature kind mismatch');
        assert.equal(previous.schemaVersion, 1, 'Existing feature schema mismatch');
        resources = previous.resources; sourceFiles.set(relative, bytes);
      }
    }
    const featureI18n = {}, prefix = `${source.namespace}.search.`;
    for (const locale of LOCALES) {
      const lower = locale.toLowerCase(), relative = `${source.project}/i18n/${lower}.json`;
      const bytes = await fs.readFile(path.join(baseline.root, baseline.flat ? '' : 'i18n', `${lower}.json`)), original = parse(bytes);
      const entries = Object.entries(currentDictionaries[lower]);
      const ordinary = Object.fromEntries(entries.filter(([key]) => !key.startsWith(prefix)));
      assert.deepStrictEqual(ordinary, original, `${source.project}/${lower}: original translations differ`);
      assert.equal(JSON.stringify(ordinary), JSON.stringify(original), `${source.project}/${lower}: original translation order changed`);
      featureI18n[lower] = Object.fromEntries(entries.filter(([key]) => key.startsWith(prefix)));
      restorationFiles.set(relative, sourceFiles.get(relative)); dictionaries[locale] = dictionary(original, source.namespace);
    }
    snapshots.push({ ...source, data: originalData, dictionaries });
    drafts.push({ schemaVersion: 1, project: source.project, kind: source.kind, resources, i18n: featureI18n });
    report.push({ project: source.project, kind: source.kind, resourceCount: rows.length, featureResourceCount: Object.keys(resources).length,
      searchKeysPerLocale: Object.fromEntries(Object.entries(featureI18n).map(([locale, table]) => [locale, Object.keys(table).length])), baselineDirectory: path.resolve(baseline.root) });
  }
  const sourceHashes = Object.fromEntries([...sourceFiles].map(([relative, bytes]) => [relative, sha256(bytes)]));
  const sourceVersion = sha256(Buffer.from(JSON.stringify(sourceHashes))), backupRoot = path.join(options.backups, sourceVersion);
  // All current source files are backed up byte-for-byte before publication files are written.
  for (const [relative, bytes] of sourceFiles) await writeIfChanged(path.join(backupRoot, relative), bytes);
  const identities = buildIdentityCatalog(snapshots);
  // Bootstrap the static import used by compileLexicalIndex before loading the module.
  await writeIfChanged(options.identities, serialized(identities));
  const { compileLexicalIndex } = await import('../tools/ai-search-service/asset-search.mjs');
  identities.lexical = compileLexicalIndex(identities);
  await writeIfChanged(options.identities, serialized(identities));
  const outputHashes = {};
  for (const [relative, bytes] of restorationFiles) {
    const destination = path.join(options.output, relative); await writeIfChanged(destination, bytes);
    assert.equal(sha256(await fs.readFile(destination)), sha256(bytes), 'Restored bytes failed verification');
    outputHashes[relative] = sha256(bytes);
  }
  for (const [relative, bytes] of sourceFiles) if (relative.startsWith('BgmPlayer/')) await writeIfChanged(path.join(options.bgmSourceOutput, relative), bytes);
  for (const draft of drafts) {
    draft.baseIndexVersion = identities.indexVersion;
    await compileSidecar(draft, identities);
    const relative = `${draft.project}/features.json`; draft.i18nSource = 'project-i18n-v1'; delete draft.i18n;
    const bytes = serialized(draft);
    await writeIfChanged(path.join(options.output, relative), bytes); outputHashes[relative] = sha256(bytes);
    Object.assign(report.find(row => row.project === draft.project), { featurePath: relative, featureBytes: bytes.length, lexicalBytes: serialized(draft.lexical).length,
      lexicalDocuments: draft.lexical.docs.length, lexicalTerms: Object.keys(draft.lexical.postings).length, lexicalFeatureHash: draft.lexicalFeatureHash });
  }
  const manifest = { schemaVersion: 1, sourceDirectory: path.resolve(options.source), sourceVersion, backupDirectory: backupRoot,
    publicationDirectory: options.output, baseIndexVersion: identities.indexVersion, sourceHashes, outputHashes, projects: report,
    preservedOriginalDataBytes: true, preservedOriginalTranslationEntries: true, preservedOriginalBytes: false, translationStorage: 'project-i18n-v1', sourceChanged: false, apiCalls: 0, bgmAuxiliarySourceDirectory: options.bgmSourceOutput,
    bgmUploadRequired: false, reindexCommand: 'node scripts/export-ai-asset-features.cjs --reindex exports/ugc-tool-data/<Project>/features.json' };
  await writeIfChanged(path.join(backupRoot, 'manifest.json'), serialized({ schemaVersion: 1, sourceVersion, sourceHashes }));
  const manifestFilename = options.manifest;
  await writeIfChanged(manifestFilename, serialized(manifest));
  console.log(JSON.stringify({ manifest: manifestFilename, backupDirectory: backupRoot, baseIndexVersion: identities.indexVersion, identitiesBytes: serialized(identities).length, projects: report, apiCalls: 0 }, null, 2));
}
module.exports = { main, compileSidecar, reindex, stripMetadata, writeIfChanged };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
