const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { normalizeImageCatalog, createImageCatalog, clientImageCatalog } = require('../src/views/ClientUIAnimationEditor/imageAssets.ts');
const { i18n, loadOssTranslations } = require('../src/i18n/index.ts');
const optionCatalog = createImageCatalog('Public/CustomUIImage');
const optionAssets = optionCatalog.normalizeImageCatalog({ imageData: { 100160: { id: 100160, img: 'sprite/100160.png', border: '' } }, category: { 1: { id: 1, images: [100160] } } });
assert.match(optionAssets[0].src, /Public\/CustomUIImage\/sprite\/100160.png$/);
assert.notEqual(optionCatalog.imageAssetById, clientImageCatalog.imageAssetById);
assert.notEqual(optionCatalog.imageAssets, clientImageCatalog.imageAssets);
const { parseSpriteMetadata, isStretchable, spriteSlices } = require('../src/views/ClientUIAnimationEditor/spriteGeometry.ts');
const assets = normalizeImageCatalog({ imageData: { 104001: { id: 104001, img: 'sprite/104001.png', border: 'border/104001.json' }, 104004: { id: 104004, img: '', border: '' } }, category: { 5: { id: 5, images: [104001, 104004, 104005] } } });
assert.deepEqual(assets.map(asset => asset.id), [104001, 104004, 104005]);
assert.match(assets[0].src, /Public\/CustomUIImage\/sprite\/104001.png$/);
assert.equal(assets[1].src, '');
assert.equal(assets[2].src, '');
assert.deepEqual(assets[2].categories, ['5']);
const metadata = parseSpriteMetadata({ m_Rect: { width: 100, height: 80 }, m_Border: { X: 10, Y: 20, Z: 30, W: 5 }, m_PixelsToUnits: 1 });
assert.equal(isStretchable(metadata), true);
const slices = spriteSlices(metadata, 400, 200, true);
assert.equal(slices.length, 9);
assert.deepEqual(slices[0], { x: 0, y: 0, width: 10, height: 5, viewBox: '0 0 10 5' });
assert.deepEqual(slices[4], { x: 10, y: 5, width: 360, height: 175, viewBox: '10 5 60 55' });
assert.deepEqual(slices[8], { x: 370, y: 180, width: 30, height: 20, viewBox: '70 60 30 20' });
assert.equal(spriteSlices(metadata, 400, 200, false).length, 1);
const small = spriteSlices(metadata, 20, 10, true);
assert.equal(small.length, 4);
assert.equal(small.reduce((sum, slice) => sum + slice.width * slice.height, 0), 200);
const partial = parseSpriteMetadata({ m_Rect: { width: 8, height: 8 }, m_Border: { X: 0, Y: 2, Z: 0, W: 2 }, m_PixelsToUnits: 1 });
assert.equal(spriteSlices(partial, 150, 150, true).length, 3);
assert.equal(spriteSlices({ ...metadata, pixelsPerUnit: 2 }, 400, 200, true)[0].width, 5);
assert.equal(isStretchable(parseSpriteMetadata({ m_Rect: { width: 32, height: 32 }, m_Border: { X: 0, Y: 0, Z: 0, W: 0 } })), false);
assert.equal(parseSpriteMetadata({ m_Rect: { width: Infinity, height: 80 } }), undefined);
assert.equal(parseSpriteMetadata(null), undefined);
// OSS sprite 106004: opposite borders consume the full source dimensions.
// The game extends the seam samples into four continuous edges, not just corners.
const ring = parseSpriteMetadata({ m_Rect: { width: 36, height: 36 }, m_Border: { X: 18, Y: 18, Z: 18, W: 18 }, m_PixelsToUnits: 1 });
const ringSlices = spriteSlices(ring, 158, 150, true);
assert.equal(ringSlices.length, 9);
assert.deepEqual(ringSlices[1], { x: 18, y: 0, width: 122, height: 18, viewBox: '17.5 0 1 18' });
assert.deepEqual(ringSlices[3], { x: 0, y: 18, width: 18, height: 114, viewBox: '0 17.5 18 1' });
assert.deepEqual(ringSlices[4], { x: 18, y: 18, width: 122, height: 114, viewBox: '17.5 17.5 1 1' });
assert.equal(ringSlices.reduce((area, slice) => area + slice.width * slice.height, 0), 158 * 150);
assert.equal(spriteSlices(ring, 20, 20, true).length, 4);
assert.equal(spriteSlices(ring, 158, 150, false).length, 1);
const collapsedX = { ...ring, top: 5, bottom: 5 };
assert.equal(spriteSlices(collapsedX, 158, 150, true).length, 9);
console.log('PASS image IDs, missing entries, OSS paths, Unity border order, nine-slice corners, small sizes, partial borders and pixels per unit');
console.log('PASS sprite 106004 continuous edges with zero-width/height source center, small targets and basic mode');

async function testCatalogRefresh() {
  const originalFetch = global.fetch;
  const originalLocale = i18n.global.locale.value;
  const requests = [];
  let revision = 'first';
  let failCatalog = false;
  let failLanguage = '';
  i18n.global.locale.value = 'en-US';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/data.json')) return {
      ok: !failCatalog, status: failCatalog ? 503 : 200,
      json: async () => ({ imageData: { 100160: { id: 100160, img: `${revision}.png`, border: 'border/100160.json' } }, category: { 3: { id: 3, images: [100160] } } }),
    };
    if (failLanguage && url.includes(`/i18n/${failLanguage}.json`)) return { ok: false, status: 503 };
    return { ok: true, json: async () => url.includes('/border/')
      ? { m_Rect: { width: 32, height: 32 }, m_Border: { X: 1, Y: 1, Z: 1, W: 1 } }
      : { [revision === 'updated' ? 'clientUIAnimationEditor.category.3' : '3']: new URL(url, 'https://test.invalid').pathname.split('/').pop() } };
  };
  try {
    const first = clientImageCatalog.loadImageCatalog();
    assert.equal(clientImageCatalog.loadImageCatalog(true), first, 'Concurrent loads share the pending request');
    await first;
    assert.match(clientImageCatalog.imageAssetById.get(100160).src, /Public\/CustomUIImage\/first.png$/);
    assert.deepEqual(requests.filter(request => request.url.includes('/i18n/')).map(request => request.url.split('/').pop().split('?')[0]), ['en-us.json'], 'Initial load only requests the current language');
    assert.equal(i18n.global.t('clientUIAnimationEditor.category.3', {}, { locale: 'en-US' }), 'en-us.json', 'Legacy numeric category keys enter the global composer');
    await loadOssTranslations('ClientUIAnimationEditor', 'clientUIAnimationEditor', 'i18n', { locale: 'en-US', keyPrefix: 'category' });
    assert.equal(requests.filter(request => request.url.includes('/i18n/en-us.json')).length, 1, 'Other consumers reuse the public translation cache');
    revision = 'updated';
    await clientImageCatalog.loadImageCatalog();
    assert.equal(requests.filter(request => request.url.includes('/data.json')).length, 1);
    await clientImageCatalog.loadImageCatalog(true);
    const updated = clientImageCatalog.imageAssetById.get(100160);
    assert.match(updated.src, /Public\/CustomUIImage\/updated.png$/);
    assert.ok(await clientImageCatalog.loadSpriteMetadata(updated));
    assert.ok(requests.some(request => /Public\/CustomUIImage\/border\/100160.json\?/.test(request.url)));
    assert.ok(requests.filter(request => request.url.includes('/data.json')).every(request => request.options.cache === 'no-store' && /\?_t=\d+$/.test(request.url)));
    failCatalog = true;
    await clientImageCatalog.loadImageCatalog(true);
    assert.equal(clientImageCatalog.imageAssetById.get(100160), updated, 'A failed refresh preserves loaded assets');
    assert.ok(clientImageCatalog.imageCatalogError.value);
    failCatalog = false;
    await clientImageCatalog.loadImageCatalog();
    assert.equal(clientImageCatalog.imageCatalogError.value, '');
    console.log('PASS shared public catalog refresh, request deduplication, relative sprite/border paths and failed refresh recovery');

    const switchAsset = clientImageCatalog.imageAssetById.get(100160);
    const dataRequests = requests.filter(request => request.url.includes('/data.json')).length;
    const jaRequest = clientImageCatalog.loadImageCategoryNames('ja-JP');
    await Promise.all([jaRequest, clientImageCatalog.loadImageCategoryNames('ja-JP')]);
    assert.equal(clientImageCatalog.imageCategoryLabel('3', 'ja-JP'), 'ja-jp.json');
    assert.equal(clientImageCatalog.imageCategoryLabel('3', 'JA_jp'), 'ja-jp.json', 'Category labels normalize supported locale spellings');
    assert.equal(clientImageCatalog.imageCategoryLabel('3', 'fr-FR'), 'clientUIAnimationEditor.category.3', 'Unsupported category languages preserve the full key');
    const requestsBeforeAlias = requests.length;
    await clientImageCatalog.loadImageCategoryNames('JA_jp');
    assert.equal(requests.length, requestsBeforeAlias, 'Category locale aliases reuse the canonical language cache');
    await clientImageCatalog.loadImageCategoryNames('en-US');
    await clientImageCatalog.loadImageCategoryNames('ja-JP');
    assert.equal(requests.filter(request => request.url.includes('/i18n/ja-jp.json')).length, 1, 'Loaded languages remain cached after switching away and back');
    assert.equal(requests.filter(request => request.url.includes('/data.json')).length, dataRequests, 'Language switching does not refetch asset data');

    failLanguage = 'ru-ru';
    i18n.global.locale.value = 'ru-RU';
    await clientImageCatalog.loadImageCategoryNames('ru-RU');
    assert.notEqual(clientImageCatalog.imageCategoryLabel('3', 'ru-RU'), 'ru-ru.json', 'Failed requests do not update the global composer');
    assert.ok(clientImageCatalog.imageCatalogError.value);
    assert.equal(clientImageCatalog.imageAssetById.get(100160), switchAsset, 'Failed translations preserve loaded assets');
    i18n.global.locale.value = 'en-US';
    assert.equal(clientImageCatalog.imageCatalogError.value, '', 'Switching language immediately hides an inactive language failure');
    await clientImageCatalog.loadImageCategoryNames('en-US');
    assert.equal(clientImageCatalog.imageCatalogError.value, '', 'An inactive failed language does not warn in a cached active language');
    failLanguage = '';
    i18n.global.locale.value = 'ru-RU';
    await clientImageCatalog.loadImageCategoryNames('ru-RU');
    assert.equal(clientImageCatalog.imageCategoryLabel('3', 'ru-RU'), 'ru-ru.json');
    assert.equal(clientImageCatalog.imageCatalogError.value, '');
    assert.equal(requests.filter(request => request.url.includes('/i18n/ru-ru.json')).length, 2, 'Failed translations can be retried');

    failLanguage = 'en-us';
    i18n.global.locale.value = 'en-US';
    await clientImageCatalog.loadImageCategoryNames('en-US', true);
    assert.equal(clientImageCatalog.imageCategoryLabel('3', 'en-US'), 'en-us.json', 'Failed refreshes preserve the previous translation');
    assert.ok(clientImageCatalog.imageCatalogError.value);
    failLanguage = '';
    const beforeRetry = requests.length;
    await clientImageCatalog.loadImageCategoryNames('en-US');
    assert.equal(requests.length, beforeRetry + 1, 'A failed translation refresh remains retryable');
    assert.equal(clientImageCatalog.imageCatalogError.value, '');

    // A failed initial translation can recover without downloading the asset catalog again.
    const partialCatalog = createImageCatalog('Test/PartialImages', 'ClientUIAnimationEditor');
    failLanguage = 'zh-tw';
    i18n.global.locale.value = 'zh-TW';
    await partialCatalog.loadImageCatalog(false, 'zh-TW');
    assert.ok(partialCatalog.imageAssetById.get(100160));
    assert.ok(partialCatalog.imageCatalogError.value);
    failLanguage = '';
    await partialCatalog.loadImageCatalog(false, 'zh-TW');
    assert.equal(partialCatalog.imageCatalogError.value, '');
    assert.equal(requests.filter(request => request.url.includes('/Test/PartialImages/data.json')).length, 1);
    assert.equal(requests.some(request => request.url.includes('/Test/PartialImages/i18n/')), false, 'Custom image catalogs share the registered category translation source');
    console.log('PASS current-language category requests, shared global translations, switch deduplication and retry without asset refetch');
    const requestFetch = global.fetch;
    let finishOldLanguage;
    global.fetch = (url, options) => {
      if (!url.includes('/i18n/ru-ru.json')) return requestFetch(url, options);
      requests.push({ url, options });
      return new Promise(resolve => { finishOldLanguage = resolve; });
    };
    i18n.global.locale.value = 'ru-RU';
    const lateFailure = clientImageCatalog.loadImageCategoryNames('ru-RU', true);
    i18n.global.locale.value = 'en-US';
    finishOldLanguage({ ok: false, status: 503 });
    await lateFailure;
    assert.equal(clientImageCatalog.imageCatalogError.value, '', 'A late failure from the old language cannot overwrite the current language error');
    global.fetch = requestFetch;
    // Invalidate the shared snapshots while retaining prior text, so the scoped hook
    // must load the current language and then react to a new selected language.
    failLanguage = 'ru-ru';
    await clientImageCatalog.loadImageCategoryNames('ru-RU', true);
    failLanguage = 'ja-jp';
    await clientImageCatalog.loadImageCategoryNames('ja-JP', true);
    failLanguage = '';
    await testLibraryLanguageChanges(requests);
  } finally {
    global.fetch = originalFetch;
    i18n.global.locale.value = originalLocale;
  }
}

async function testLibraryLanguageChanges(requests) {
  const filename = path.resolve(__dirname, '../src/views/ClientUIAnimationEditor/ImageAssetLibrary.vue');
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'));
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: 'image-library-language-test' });
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'image-library-language-test', compilerOptions: { bindingMetadata: compiled.bindings } }).errors, []);
  const ast = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join('\n');
  const code = ts.transpileModule(declarations, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const catalog = createImageCatalog('Test/ScopedImages', 'ClientUIAnimationEditor');
  const locale = i18n.global.locale;
  locale.value = 'ru-RU';
  const mounted = [], unmounted = [];
  const context = vm.createContext({
    ...vue, t: i18n.global.t,
    defineProps: () => ({ selectedId: null, catalog }), withDefaults: (props, defaults) => ({ ...defaults, ...props }), defineEmits: () => () => {},
    useI18n: () => ({ locale }), onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback),
    document: { activeElement: { isConnected: false } },
  });
  const scope = vue.effectScope();
  scope.run(() => vm.runInContext(`${code}\nglobalThis.libraryTest = { search, filteredAssets };`, context));
  try {
    const initialRuRequests = requests.filter(request => request.url.includes('/ClientUIAnimationEditor/i18n/ru-ru.json')).length;
    mounted.forEach(callback => callback());
    await catalog.loadImageCatalog(false, 'ru-RU');
    assert.equal(requests.filter(request => request.url.includes('/ClientUIAnimationEditor/i18n/ru-ru.json')).length, initialRuRequests + 1, 'The scoped hook and image catalog share one public download');
    context.libraryTest.search.value = 'ru-ru.json';
    assert.equal(context.libraryTest.filteredAssets.value.length, 1, 'Category search reads the current global translation');
    const initialJaRequests = requests.filter(request => request.url.includes('/ClientUIAnimationEditor/i18n/ja-jp.json')).length;
    locale.value = 'ja-JP';
    await vue.nextTick();
    await catalog.loadImageCategoryNames('ja-JP');
    assert.equal(requests.filter(request => request.url.includes('/ClientUIAnimationEditor/i18n/ja-jp.json')).length, initialJaRequests + 1, 'The public hook loads the mounted library new current language once');
    assert.equal(context.libraryTest.filteredAssets.value.length, 0, 'Category search switches with the selected language');
    context.libraryTest.search.value = 'ja-jp.json';
    assert.equal(context.libraryTest.filteredAssets.value.length, 1);
    unmounted.forEach(callback => callback());
    scope.stop();
    const before = requests.length;
    locale.value = 'zh-CN';
    await vue.nextTick();
    assert.equal(requests.length, before, 'The component language watcher stops when its scope is disposed');
    console.log('PASS actual image-library SFC compilation, current-language category search and public i18n subscription lifetime');
  } finally {
    scope.stop();
  }
}
testCatalogRefresh().catch(error => { console.error(error); process.exitCode = 1; });
