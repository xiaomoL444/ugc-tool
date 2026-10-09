#!/usr/bin/env node
// The Worker imports identities only; full features are loaded from independent sidecars.
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU'];
const SOURCES = [
  { kind: 'sound', project: 'SoundEffectPlayer', namespace: 'soundEffectPlayer' },
  { kind: 'effect', project: 'EffectPlayer', namespace: 'effectPlayer' },
  { kind: 'bgm', project: 'BgmPlayer', namespace: 'bgmPlayer' },
];
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';
const unique = values => [...new Set(values.filter(Boolean))];
const terms = value => unique((Array.isArray(value) ? value : text(value).split(/[\n,，;；|、]+/u)).map(text)).slice(0, 40);
const join = values => unique(values.map(text)).join('\n');

function dictionary(raw, namespace) {
  const value = record(raw);
  const source = Object.keys(record(value.translations)).length ? value.translations : value;
  return Object.fromEntries(Object.entries(source).filter(([key, val]) => typeof val === 'string' &&
    !key.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part)))
    .map(([key, val]) => [key.startsWith(`${namespace}.`) ? key : `${namespace}.${key}`, val]));
}
function field(row, fieldName, locale, dict) {
  const key = text(row[`${fieldName}I18nKey`]);
  if (key) return text(dict[key]);
  // Unlocalized source fields have no evidence that they were translated.
  return locale === 'zh-CN' ? (Array.isArray(row[fieldName]) ? row[fieldName].map(text).join('、') : text(row[fieldName])) : '';
}
function mapFields(row, fields, dictionaries, list = false) {
  const result = {};
  for (const locale of LOCALES) {
    const value = join(fields.map(name => field(row, name, locale, dictionaries[locale] || {})));
    if (value) result[locale] = list ? terms(value) : value;
  }
  return result;
}
function allValues(map) { return Object.values(map).flat(); }

function buildCatalog(snapshots, audioRows = [], sourceBase = 'offline') {
  const audioById = new Map(audioRows.map(row => [String(row.id), row]));
  const assets = [];
  const sourceInfo = [];
  const coverage = { total: 0, byKind: { sound: 0, effect: 0, bgm: 0 }, descriptions: { sound: 0, effect: 0, bgm: 0 },
    detailedDescriptions: 0, audioDescriptions: 0, effectsWithAudio: 0, externalAudioDescriptions: 0,
    namesByLocale: Object.fromEntries(LOCALES.map(locale => [locale, 0])), descriptionLocales: Object.fromEntries(LOCALES.map(locale => [locale, 0])) };
  for (const source of SOURCES) {
    const snapshot = snapshots.find(item => item.kind === source.kind || item.project === source.project);
    if (!snapshot) throw new Error(`Missing source ${source.project}`);
    const data = record(snapshot.data);
    const dictionaries = snapshot.dictionaries || {};
    const rows = source.kind === 'effect' ? Object.values(record(data.effectData))
      : Array.isArray(data.data) ? data.data : Array.isArray(data.musicData) ? data.musicData : [];
    if (!rows.length) throw new Error(`Empty source ${source.project}`);
    const categories = (Array.isArray(data.category) ? data.category : []).map(record);
    let count = 0;
    for (const raw of rows) {
      const row = record(raw);
      const id = String(row.id ?? '');
      if (!/^\d{1,12}$/.test(id)) throw new Error(`Invalid asset ID in ${source.project}`);
      const nameKey = (text(row.nameI18nKey) || (source.kind === 'effect' ? text(row.title) : '') || `${source.namespace}.data.${id}`)
        .replace(/^effectPlayer\.names\./, 'effectPlayer.data.');
      const titles = {};
      for (const locale of LOCALES) {
        const value = text((dictionaries[locale] || {})[nameKey]);
        if (value) titles[locale] = value;
      }
      if (!titles['zh-CN']) titles['zh-CN'] = text(row.sourceName) || text(row.sourceTitle) ||
        (!text(row.name).startsWith(`${source.namespace}.`) ? text(row.name) : '') || `${source.kind} ${id}`;
      const visualFields = ['visualShortDescription', 'visualDescription', 'mainDescription', 'tailDescription'];
      const genericFields = ['shortDescription', 'description'];
      const description = mapFields(row, source.kind === 'effect' ? visualFields : genericFields, dictionaries);
      if (source.kind === 'effect' && !Object.keys(description).length) Object.assign(description, mapFields(row, genericFields, dictionaries));
      const detailedDescription = mapFields(row, source.kind === 'effect' ? ['visualDetailedDescription', 'detailedDescription'] : ['detailedDescription'], dictionaries);
      const keywords = mapFields(row, source.kind === 'effect' ? ['keywords', 'visualKeywords'] : ['keywords'], dictionaries, true);
      const suggestedUses = mapFields(row, source.kind === 'effect' ? ['suggestedUses', 'visualSuggestedUses'] : ['suggestedUses'], dictionaries, true);
      const hasAudio = source.kind === 'sound' || source.kind === 'bgm' ? true
        : row.hasAudio === true && !!text(row.audioPath);
      const audio = { description: {}, detailedDescription: {}, keywords: {}, suggestedUses: {} };
      if (source.kind === 'effect' && hasAudio) {
        audio.description = mapFields(row, ['audioShortDescription', 'audioDescription'], dictionaries);
        audio.detailedDescription = mapFields(row, ['audioDetailedDescription'], dictionaries);
        audio.keywords = mapFields(row, ['audioKeywords'], dictionaries, true);
        audio.suggestedUses = mapFields(row, ['audioSuggestedUses'], dictionaries, true);
      }
      const external = source.kind === 'sound' ? audioById.get(id) : null;
      if (external && text(external.short_description) && !description['zh-CN']) {
        description['zh-CN'] = text(external.short_description);
        coverage.externalAudioDescriptions++;
      }
      if (external && text(external.detailed_description) && !detailedDescription['zh-CN']) detailedDescription['zh-CN'] = text(external.detailed_description);
      const category = categories.find(item => String(item.id) === String(row.category));
      const categoryTexts = category ? LOCALES.map(locale => text((dictionaries[locale] || {})[text(category.nameI18nKey)])) : [];
      const tagTexts = Array.isArray(row.tagList) ? row.tagList.flatMap(tag => LOCALES.map(locale => text((dictionaries[locale] || {})[`${source.namespace}.tags.${tag}`]))) : [];
      const albumTexts = LOCALES.map(locale => text((dictionaries[locale] || {})[text(row.albumI18nKey) || `${source.namespace}.album.${row.album_id}`]));
      const nameExtras = [row.sourceName, row.sourceTitle, row.name, row.album].map(text).filter(value => value && !value.startsWith(`${source.namespace}.`));
      const duration = source.kind === 'bgm' ? Number(row.time ?? (Number(row.minute) * 60 + Number(row.second))) : Number(row.duration ?? external?.duration_seconds);
      const asset = { resourceId: `${source.kind}:${id}`, id, kind: source.kind, titles, description, detailedDescription, keywords, suggestedUses,
        audio, hasAudio, ...(Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
        ...(typeof row.isLoop === 'boolean' ? { isLoop: row.isLoop } : {}),
        ...(text(row.giVersion) ? { giVersion: text(row.giVersion) } : {}),
        ...(row.category != null ? { category: String(row.category) } : {}),
        facetTexts: {
          feature: join([id, ...allValues(titles), ...nameExtras, ...categoryTexts, ...tagTexts, ...albumTexts,
            ...allValues(description), ...allValues(detailedDescription), ...allValues(keywords)]),
          // Visual names/tags are deliberately absent from the audio evidence facet.
          audio: source.kind === 'effect' && hasAudio ? join([...allValues(audio.description), ...allValues(audio.detailedDescription), ...allValues(audio.keywords)]) : '',
          suggestion: join(allValues(suggestedUses)), audioSuggestion: join(allValues(audio.suggestedUses)),
        } };
      assets.push(asset); count++; coverage.byKind[source.kind]++;
      if (Object.keys(description).length) coverage.descriptions[source.kind]++;
      if (Object.keys(detailedDescription).length) coverage.detailedDescriptions++;
      if (Object.keys(audio.description).length || Object.keys(audio.detailedDescription).length) coverage.audioDescriptions++;
      if (source.kind === 'effect' && hasAudio) coverage.effectsWithAudio++;
      for (const locale of LOCALES) {
        if (titles[locale]) coverage.namesByLocale[locale]++;
        if (description[locale]) coverage.descriptionLocales[locale]++;
      }
    }
    sourceInfo.push({ project: source.project, count, locales: LOCALES.filter(locale => !!dictionaries[locale]) });
  }
  assets.sort((a, b) => a.resourceId.localeCompare(b.resourceId, 'en', { numeric: true }));
  if (new Set(assets.map(item => item.resourceId)).size !== assets.length) throw new Error('Duplicate resource ID');
  coverage.total = assets.length;
  coverage.describedAssetCount = Object.values(coverage.descriptions).reduce((sum, count) => sum + count, 0);
  coverage.describedAudioAssetCount = coverage.descriptions.sound + coverage.audioDescriptions;
  const payload = { schemaVersion: 1, lexicalVersion: 2, sourceBase, sources: sourceInfo, coverage, assets };
  const indexVersion = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, indexVersion };
}

const FEATURE_FIELDS = ['searchMetadata', 'visualShortDescription', 'visualDescription', 'mainDescription', 'tailDescription',
  'shortDescription', 'description', 'visualDetailedDescription', 'detailedDescription', 'keywords', 'visualKeywords',
  'suggestedUses', 'visualSuggestedUses', 'audioShortDescription', 'audioDescription', 'audioDetailedDescription', 'audioKeywords', 'audioSuggestedUses'];
function buildIdentityCatalog(snapshots, sourceBase = 'ugc-tool-data') {
  // Keep this input independent of both legacy flat AI fields and the new sidecar.
  const cleanSnapshots = snapshots.map(snapshot => {
    const cleanRow = row => Object.fromEntries(Object.entries(row).filter(([key]) => !FEATURE_FIELDS.includes(key) && !FEATURE_FIELDS.some(field => key === `${field}I18nKey`)));
    const data = { ...snapshot.data };
    if (Array.isArray(data.data)) data.data = data.data.map(cleanRow);
    if (Array.isArray(data.musicData)) data.musicData = data.musicData.map(cleanRow);
    if (data.effectData) data.effectData = Object.fromEntries(Object.entries(data.effectData).map(([id, row]) => [id, cleanRow(row)]));
    return { ...snapshot, data };
  });
  const catalog = buildCatalog(cleanSnapshots, [], sourceBase);
  for (const asset of catalog.assets) {
    for (const key of ['description', 'detailedDescription', 'keywords', 'suggestedUses', 'audio']) delete asset[key];
    asset.facetTexts = { feature: asset.facetTexts.feature };
  }
  const { indexVersion: previous, ...payload } = catalog;
  return { ...payload, indexVersion: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
function featureCoverage(assets) {
  const coverage = { total: assets.length, byKind: { sound: 0, effect: 0, bgm: 0 }, descriptions: { sound: 0, effect: 0, bgm: 0 },
    detailedDescriptions: 0, audioDescriptions: 0, effectsWithAudio: 0, externalAudioDescriptions: 0,
    namesByLocale: Object.fromEntries(LOCALES.map(locale => [locale, 0])), descriptionLocales: Object.fromEntries(LOCALES.map(locale => [locale, 0])) };
  for (const asset of assets) {
    coverage.byKind[asset.kind]++;
    if (Object.keys(asset.description || {}).length) coverage.descriptions[asset.kind]++;
    if (Object.keys(asset.detailedDescription || {}).length) coverage.detailedDescriptions++;
    if (Object.keys(asset.audio?.description || {}).length || Object.keys(asset.audio?.detailedDescription || {}).length) coverage.audioDescriptions++;
    if (asset.kind === 'effect' && asset.hasAudio) coverage.effectsWithAudio++;
    for (const locale of LOCALES) { if (asset.titles[locale]) coverage.namesByLocale[locale]++; if (asset.description?.[locale]) coverage.descriptionLocales[locale]++; }
  }
  coverage.describedAssetCount = Object.values(coverage.descriptions).reduce((sum, count) => sum + count, 0);
  coverage.describedAudioAssetCount = coverage.descriptions.sound + coverage.audioDescriptions;
  return coverage;
}
async function buildFeatureCatalog(identities, sidecars, rawHashes) {
  const { normalizeAssetFeatureResources, verifyAssetFeatureSidecar, computeAssetCatalogVersion } = await import('../tools/ai-search-service/asset-features.mjs');
  const normalized = new Map();
  for (const source of SOURCES) {
    const sidecar = sidecars.find(item => item.project === source.project);
    if (!sidecar) throw new Error(`Missing feature sidecar ${source.project}`);
    await verifyAssetFeatureSidecar(sidecar, { project: source.project, kind: source.kind, baseIndexVersion: identities.indexVersion, identities });
    for (const asset of normalizeAssetFeatureResources(sidecar, identities)) normalized.set(asset.resourceId, asset);
  }
  const assets = identities.assets.map(asset => normalized.get(asset.resourceId) || asset);
  const { indexVersion: previous, lexical: previousLexical, ...base } = identities;
  const sourceHashes = rawHashes || Object.fromEntries(sidecars.map(item => [item.kind, crypto.createHash('sha256').update(JSON.stringify(item) + '\n').digest('hex')]));
  const payload = { ...base, baseIndexVersion: identities.indexVersion, coverage: featureCoverage(assets), assets,
    featureHashes: Object.fromEntries(sidecars.map(item => [item.project, item.lexicalFeatureHash])), featureSourceHashes: sourceHashes };
  return { ...payload, indexVersion: await computeAssetCatalogVersion(identities.indexVersion, sourceHashes) };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'ugc-tools-asset-catalog-builder/1.0',
      Referer: 'https://www.070077.xyz/', Origin: 'https://www.070077.xyz' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Source HTTP ${response.statusCode}: ${new URL(url).pathname}`)); return; }
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 40_000_000) req.destroy(new Error('Source too large')); });
      response.on('end', () => resolve(body)); response.on('error', reject);
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Source timeout'))); req.on('error', reject);
  });
}
async function readSnapshots(base, bgmBase = base) {
  const read = async (sourceBase, relative) => JSON.parse((/^https?:\/\//.test(sourceBase) ? await fetchText(`${sourceBase.replace(/\/$/, '')}/${relative}`) : await fs.readFile(path.join(sourceBase, relative), 'utf8')).replace(/^\uFEFF/, ''));
  return Promise.all(SOURCES.map(async source => {
    const sourceBase = source.kind === 'bgm' ? bgmBase : base;
    const data = await read(sourceBase, `${source.project}/data.json`);
    const translations = await Promise.all(LOCALES.map(async locale => [locale, dictionary(await read(sourceBase, `${source.project}/i18n/${locale.toLowerCase()}.json`), source.namespace)]));
    return { ...source, data, dictionaries: Object.fromEntries(translations) };
  }));
}
async function main(argv = process.argv.slice(2)) {
  const options = { base: path.resolve(__dirname, '../exports/ugc-tool-data'), output: path.resolve(__dirname, '../tools/ai-search-service/generated/asset-catalog.json'),
    identitiesOutput: path.resolve(__dirname, '../tools/ai-search-service/generated/asset-identities.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') {
      console.log('node scripts/build-ai-asset-catalog.cjs [--base HTTPS_URL|LOCAL_DIR] [--bgm-base HTTPS_URL|LOCAL_DIR] [--features-base HTTPS_URL|LOCAL_DIR] [--output JSON_PATH] [--identities-output JSON_PATH]'); return;
    }
    const name = { '--base': 'base', '--bgm-base': 'bgmBase', '--features-base': 'featuresBase', '--output': 'output', '--identities-output': 'identitiesOutput' }[argv[i]];
    if (!name || !argv[i + 1]) throw new Error('Unknown or missing CLI option'); options[name] = argv[++i];
  }
  let bgmBase = options.bgmBase || options.base;
  if (!options.bgmBase && !/^https?:\/\//.test(options.base)) {
    try { await fs.access(path.join(options.base, 'BgmPlayer/data.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; bgmBase = path.resolve(__dirname, '../exports/ai-asset-source'); }
  }
  const snapshots = await readSnapshots(options.base, bgmBase);
  const identities = buildIdentityCatalog(snapshots);
  const featuresBase = options.featuresBase || options.base;
  const sidecars = [], rawHashes = {};
  for (const source of SOURCES) {
    const relative = `${source.project}/features.json`;
    const bytes = /^https?:\/\//.test(featuresBase) ? Buffer.from(await fetchText(`${featuresBase.replace(/\/$/, '')}/${relative}`)) : await fs.readFile(path.join(featuresBase, relative));
    const disk = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const featureHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (disk.i18nSource === 'project-i18n-v1') {
      const dictionaries = {}, dictionaryHashes = {};
      for (const locale of LOCALES) {
        const lower = locale.toLowerCase(), relative = source.project + '/i18n/' + lower + '.json';
        const bytes = /^https?:\/\//.test(featuresBase) ? Buffer.from(await fetchText(featuresBase.replace(/\/$/, '') + '/' + relative)) : await fs.readFile(path.join(featuresBase, relative));
        dictionaries[lower] = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        dictionaryHashes[lower] = crypto.createHash('sha256').update(bytes).digest('hex');
      }
      const { parseAssetFeatureSidecar, computeAssetFeatureSourceHash } = await import('../tools/ai-search-service/asset-features.mjs');
      sidecars.push(parseAssetFeatureSidecar(disk, { dictionaries, identities }));
      rawHashes[source.kind] = await computeAssetFeatureSourceHash(featureHash, dictionaryHashes);
    } else { rawHashes[source.kind] = featureHash; sidecars.push(disk); }
  }
  const catalog = await buildFeatureCatalog(identities, sidecars, rawHashes);
  const { compileLexicalIndex } = await import('../tools/ai-search-service/asset-search.mjs');
  identities.lexical = compileLexicalIndex(identities);
  catalog.lexical = compileLexicalIndex(catalog);
  for (const [output, value] of [[options.identitiesOutput, identities], [options.output, catalog]]) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(value) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ output: options.output, identitiesOutput: options.identitiesOutput, baseIndexVersion: identities.indexVersion, indexVersion: catalog.indexVersion,
    coverage: catalog.coverage, bytes: Buffer.byteLength(JSON.stringify(catalog)), identitiesBytes: Buffer.byteLength(JSON.stringify(identities)) }, null, 2));
}
module.exports = { buildCatalog, buildIdentityCatalog, buildFeatureCatalog, readSnapshots, main, LOCALES, SOURCES, dictionary };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
