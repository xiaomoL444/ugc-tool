/* NODE_PATH=<bundled Playwright modules> node scripts/test-ai-search-partial-results-browser.cjs
 * Compiles actual result/preview Vue components into an isolated browser fixture.
 * No development server or model calls. Fixture bundles and screenshots stay outside the repo.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const ts = require('typescript');
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '..');
const artifactRoot = path.resolve(root, '../ugc-ai-search-file');
const experimentDirectory = path.join(artifactRoot, 'experiments/partial-resource-results');
const screenshotDirectory = path.join(artifactRoot, 'verification/browser');
const screenshot = path.join(screenshotDirectory, 'ai-search-partial-results.png');
const fixtureOrigin = 'http://127.0.0.1:18765';
const fixtureId = 'partial-results';
const answer = '释放道具使用短促金属音，道具不足使用清脆否定反馈。下面保留了本次模型返回的全部资源 ID。';
const unknownId = 'sound:10128';
const malformedId = 'sound:not-a-number';
const longId = 'invalid:' + 'bad-resource-'.repeat(10);
const trusted = [{
  resourceId: 'sound:50514', id: '50514', kind: 'sound', title: '短促清脆金属撞击',
  description: '清脆明亮金属撞击伴颤音衰减。', keywords: ['清脆', '金属'], suggestedUses: ['道具使用反馈'],
  duration: 1, hasAudio: true, href: '/SoundEffectPlayer?id=50514',
}, {
  resourceId: 'sound:50934', id: '50934', kind: 'sound', title: '提示性 UI 错误音',
  description: '短促清脆金属撞击，适合作道具不足提示。', keywords: ['错误反馈'], suggestedUses: ['道具不足反馈'],
  duration: 1, hasAudio: true, href: '/SoundEffectPlayer?id=50934',
}];
const modelResult = { answer, matches: [
  { resourceId: trusted[0].resourceId, reason: '短促明亮的金属声，建议用于释放道具。', matchType: 'feature' },
  { resourceId: unknownId, reason: '模型给出的原始推荐理由会保留，资源资料暂时留空。', matchType: 'feature' },
  { resourceId: trusted[0].resourceId, reason: '这是相同 ID 的第二条结果，保留独立的推荐理由。', matchType: 'suggestion' },
  { resourceId: malformedId, reason: '非数字 ID 同样保留原始字符串。' },
  { resourceId: 'sound:999999999999' },
  { resourceId: longId, reason: '较长的无法识别 ID 也应自动换行。' },
  { resourceId: trusted[1].resourceId, reason: '道具不足的否定反馈。', matchType: 'feature' },
  { resourceId: unknownId, reason: '重复的未识别 ID，继续保留这一项。' },
  { resourceId: trusted[0].resourceId, reason: '分页之后仍然保留重复资源。', matchType: 'feature' },
] };

// Use the real recovery mapper; no validation behavior is duplicated in the fixture.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { recoverResultDisplay } = require('../src/views/AISearch/resultDisplay.ts');
const display = recoverResultDisplay(modelResult, trusted);
assert.ok(display);

function transpile(source, filename) {
  return ts.transpileModule(source, { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
}
function compileFixture(sectionMode = false) {
  const sourceFiles = [
    'src/views/AISearch/components/ResourceResults.vue', 'src/views/AISearch/components/AnswerSections.vue', 'src/views/AISearch/components/ResourceDetails.vue',
    'src/views/AISearch/components/SearchIcon.vue', 'src/views/AISearch/components/ResourceMiniPreview.vue',
    'src/views/AISearch/components/SoundMiniPreview.vue', 'src/views/SoundEffectPlayer/AudioWaveform.vue',
    'src/views/AISearch/previewMedia.ts', 'src/views/AISearch/previewPlayback.ts',
    'src/views/SoundEffectPlayer/waveform.ts', 'src/utils/oss.ts', 'src/utils/clipboard.ts',
  ];
  const styles = [fs.readFileSync(path.join(root, 'src/views/AISearch/AISearch.css'), 'utf8')];
  const factories = sourceFiles.map(filename => {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    let javascript;
    if (filename.endsWith('.vue')) {
      const { descriptor, errors } = parse(source, { filename });
      assert.deepEqual(errors, [], filename + ': SFC parses');
      const scope = 'partial-' + path.basename(filename, '.vue').toLowerCase();
      const compiled = compileScript(descriptor, { id: scope, inlineTemplate: true });
      javascript = transpile(compiled.content, filename + '.ts');
      if (descriptor.styles.some(style => style.scoped)) javascript += '\nexports.default.__scopeId=' + JSON.stringify('data-v-' + scope) + ';';
      for (const style of descriptor.styles) {
        const result = compileStyle({ source: style.content, filename, id: 'data-v-' + scope, scoped: style.scoped });
        assert.deepEqual(result.errors, [], filename + ': CSS compiles');
        styles.push(result.code);
      }
    } else javascript = transpile(source, filename);
    return JSON.stringify(filename) + ':function(module,exports,require){\n' + javascript + '\n}';
  });
  const locales = Object.assign({}, ...['aiSearch', 'soundEffectPlayer'].map(name =>
    JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', name, 'zh-cn.json'), 'utf8'))));
  const bundle = `
  const process={env:{NODE_ENV:'development'}};
  const factories={${factories.join(',\n')}};
  const cache={};
  function resolve(from,name){
    if(name.startsWith('@/')) return find('src/'+name.slice(2));
    if(!name.startsWith('.')) return name;
    const parts=from.split('/');parts.pop();
    for(const part of name.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}
    return find(parts.join('/'));
  }
  function find(id){return Object.hasOwn(factories,id)?id:Object.hasOwn(factories,id+'.ts')?id+'.ts':id;}
  function requireModule(id){
    if(id==='vue')return Vue;
    if(id==='vue-i18n')return VueI18n;
    if(id==='vue-sonner')return {toast:{success:()=>{},error:error=>window.fixtureErrors.push(error)}};
    if(id==='src/i18n')return {i18n};
    if(id.endsWith('/EffectMiniPreview.vue')||id.endsWith('/BgmMiniPreview.vue'))
      return {default:{setup:()=>()=>null}};
    if(cache[id])return cache[id].exports;
    if(!factories[id])throw Error('Unexpected fixture import '+id);
    const module={exports:{}};cache[id]=module;
    factories[id](module,module.exports,name=>requireModule(resolve(id,name)));
    return module.exports;
  }
  window.fixtureErrors=[];
  const i18n=VueI18n.createI18n({legacy:false,flatJson:true,locale:'zh-CN',messages:{'zh-CN':${JSON.stringify(locales)}}});
  const component=requireModule(${JSON.stringify('src/views/AISearch/components/' + (sectionMode ? 'AnswerSections' : 'ResourceResults') + '.vue')}).default;
  const cards=${JSON.stringify(sectionMode ? groupedCards : display.cards)};
  const state=Vue.reactive({sections:${JSON.stringify(groupedSections)}});
  window.setSections=sections=>{state.sections=sections};
  Vue.createApp({setup:()=>()=>Vue.h(component,{cards,resultId:${JSON.stringify(fixtureId)},${sectionMode ? 'sections:state.sections' : ''}})}).use(i18n).mount('#results');
  window.fixtureReady=true;
  `;
  return { bundle, stylesheet: styles.join('\n') };
}
const groupedCards = [trusted[0], { ...trusted[0], resourceId: 'sound:50545', id: '50545', title: '第二个释放音', href: '/SoundEffectPlayer?id=50545' },
  trusted[1], { ...trusted[1], resourceId: 'sound:50931', id: '50931', title: '第二个不足音', href: '/SoundEffectPlayer?id=50931' }];
const groupedSections = [
  { answer: '释放道具：选用明亮上扬的短促金属声，适合生效瞬间。', resourceIds: groupedCards.slice(0, 2).map(card => card.resourceId) },
  { answer: '道具不足：选用下行或突停的短音，适合否定反馈。', resourceIds: groupedCards.slice(2).map(card => card.resourceId) },
];
function offlineWave() {
  const sampleRate = 8000, samples = sampleRate;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) data.writeInt16LE(Math.round(Math.sin(index * 0.44) * 8000 * Math.exp(-index / 1800)), 44 + index * 2);
  return data;
}
async function waitForPositions(page, positions) {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.resource-card')]
    .map(card => Number(card.dataset.resultPosition))) === JSON.stringify(expected), positions);
}
async function positions(page) {
  return page.locator('.resource-card').evaluateAll(cards => cards.map(card => Number(card.dataset.resultPosition)));
}
async function assertCard(page, position) {
  const expected = display.cards[position - 1];
  const card = page.locator('.resource-card[data-result-position="' + position + '"]');
  assert.equal(await card.isVisible(), true, 'Every returned card remains visible on its page');
  if (expected.unresolved) {
    assert.ok((await card.locator('.resource-id').textContent()).includes(expected.resourceId));
    assert.equal(await card.locator('.resource-copy-actions button').count(), 1);
    assert.equal(await card.locator('.resource-title-row,.resource-kind,.resource-icon,.asset-link,.resource-mini-preview,audio,video,canvas,img,.resource-match-badges').count(), 0,
      'Unknown IDs keep metadata, asset links and media empty');
    assert.equal(await card.locator('.resource-unresolved-preview').textContent(), '');
    assert.equal(await card.locator('.resource-details-trigger').count(), expected.matchReason ? 1 : 0);
  } else {
    assert.equal(await card.locator('h3').textContent(), expected.title);
    assert.equal(await card.locator('.asset-link').getAttribute('href'), expected.href);
    assert.equal(await card.locator('.resource-kind').textContent(), '音效');
    assert.equal(await card.locator('.resource-copy-actions button').count(), 2);
    await card.locator('.sound-mini-play').waitFor();
    assert.equal(await card.locator('.resource-details-summary').textContent(), expected.description);
  }
  await card.locator('.resource-copy-actions button').first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected.unresolved ? expected.resourceId : expected.id,
    'The actual Clipboard handler copies the exact ID');
  if (expected.matchReason) {
    const trigger = card.locator('.resource-details-trigger');
    await trigger.click();
    const tooltipId = await trigger.getAttribute('aria-describedby');
    assert.equal(tooltipId, 'resource-details-' + fixtureId + '-' + (position - 1), 'Each result occurrence has its own tooltip ID');
    const tooltip = page.locator('#' + tooltipId);
    await tooltip.waitFor({ state: 'visible' });
    assert.ok((await tooltip.locator('.match-reason').textContent()).includes(expected.matchReason));
    if (expected.unresolved) assert.equal(await tooltip.locator('.resource-details-title,.resource-details-description,.resource-details-keywords,.suggested-uses').count(), 0);
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
  }
}
async function testViewport(browser, fixture, mobile) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1650, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}), permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [], requests = [];
  const wave = offlineWave();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin !== fixtureOrigin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixture.html });
    if (url.pathname === '/runtime.js') return route.fulfill({ contentType: 'application/javascript', body: fixture.runtime });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: fixture.bundle });
    if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: fixture.stylesheet });
    if (/^\/ugc-tool-data\/SoundEffectPlayer\/audio\/(50514|50934)\.mp3$/.test(url.pathname))
      return route.fulfill({ contentType: 'audio/wav', body: wave });
    return route.fulfill({ status: 404, body: 'Unexpected offline fixture request' });
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixtureOrigin);
    await page.waitForFunction(() => window.fixtureReady);
    await page.locator('.resource-card').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.sound-mini-play') && document.querySelector('.waveform-bars'));
    assert.equal(await page.locator('.message-text').textContent(), answer);
    const pageSize = await page.locator('.resource-card').count();
    assert.equal(pageSize, mobile ? 1 : 6);
    const tooltipIds = new Set(), seen = [];
    do {
      const current = await positions(page);
      for (const position of current) {
        await assertCard(page, position);
        if (display.cards[position - 1].matchReason) {
          const id = 'resource-details-' + fixtureId + '-' + (position - 1);
          assert.equal(tooltipIds.has(id), false, 'Repeated resources do not share a details ID');
          tooltipIds.add(id);
        }
      }
      seen.push(...current);
      if (await page.locator('.results-next').isDisabled()) break;
      await page.locator('.results-next').click();
      await waitForPositions(page, Array.from({ length: Math.min(pageSize, display.cards.length - seen.length) }, (_, index) => seen.length + index + 1));
    } while (seen.length < display.cards.length);
    assert.deepEqual(seen, display.cards.map((_, index) => index + 1), 'All results and duplicate occurrences survive paging');
    while (!(await page.locator('.results-previous').isDisabled())) {
      const previous = (await positions(page))[0] - pageSize;
      await page.locator('.results-previous').click();
      await waitForPositions(page, Array.from({ length: pageSize }, (_, index) => previous + index));
    }
    if (!mobile) {
      const samePageCopies = page.locator('.resource-card').filter({ has: page.locator('h3', { hasText: trusted[0].title }) });
      assert.equal(await samePageCopies.count(), 2, 'Repeated known resources appear together on the same page');
      assert.ok((await samePageCopies.nth(0).locator('.resource-details-trigger').getAttribute('aria-label')).includes(trusted[0].title));
      await page.mouse.move(5, 5);
      await page.screenshot({ path: screenshot, fullPage: true });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'IDs and cards fit the viewport');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    assert.deepEqual(await page.evaluate(() => window.fixtureErrors), [], 'The actual copy handler succeeds');
    assert.ok(requests.every(url => new URL(url).origin === fixtureOrigin));
    assert.ok(!requests.some(url => url.includes('/api/ai-search/')), 'No search or model API calls');
    assert.ok(!requests.some(url => url.includes('10128.mp3') || url.includes('not-a-number')), 'Unknown IDs never request preview media');
  } finally { await context.close(); }
}

async function testAnswerSections(browser, fixture, mobile) {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: mobile ? { width: 390, height: 844 } : { width: 1650, height: 900 } });
  const errors = [], unexpected = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixtureOrigin) { unexpected.push(url.href); return route.abort(); }
    const entry = { '/': ['text/html', fixture.html], '/runtime.js': ['application/javascript', fixture.runtime],
      '/fixture.js': ['application/javascript', fixture.bundle], '/fixture.css': ['text/css', fixture.stylesheet] }[url.pathname];
    if (entry) return route.fulfill({ contentType: entry[0], body: entry[1] });
    if (/^\/ugc-tool-data\/SoundEffectPlayer\/audio\/(50514|50545|50934|50931)\.mp3$/.test(url.pathname)) return route.fulfill({ contentType: 'audio/wav', body: offlineWave() });
    unexpected.push(url.href); return route.fulfill({ status: 404, body: '' });
  });
  try {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixtureOrigin); await page.waitForFunction(() => window.fixtureReady);
    const groups = page.locator('.answer-section');
    assert.equal(await groups.count(), 2);
    for (let i = 0; i < 2; i++) {
      const group = groups.nth(i);
      assert.equal(await group.locator('.message-text').textContent(), groupedSections[i].answer);
      assert.deepEqual(await group.evaluate(element => [...element.children].map(child => child.tagName)), ['P', 'SECTION'], 'Each answer precedes its own card group');
      await page.waitForFunction(({ index, count }) => document.querySelectorAll('.answer-section')[index].querySelectorAll('.resource-card').length === count, { index: i, count: mobile ? 1 : 2 });
      const cards = group.locator('.resource-card');
      assert.deepEqual(await cards.locator('h3').allTextContents(), groupedCards.slice(i * 2, i * 2 + (mobile ? 1 : 2)).map(card => card.title));
    }
    if (mobile) {
      const first = groups.nth(0), second = groups.nth(1);
      assert.notEqual(await first.locator('.results-next').getAttribute('aria-controls'), await second.locator('.results-next').getAttribute('aria-controls'));
      await first.locator('.results-next').click();
      assert.equal(await first.locator('h3').textContent(), groupedCards[1].title);
      assert.equal(await second.locator('h3').textContent(), groupedCards[2].title, 'Paging the first answer never pages the second');
      await first.locator('.results-previous').click();
    }
    const top = await groups.nth(0).boundingBox(), bottom = await groups.nth(1).boundingBox();
    assert.ok(bottom.y >= top.y + top.height, 'Answers and their cards stack vertically');
    await page.screenshot({ path: path.join(screenshotDirectory, mobile ? 'ai-search-answer-sections-mobile.png' : 'ai-search-answer-sections.png'), fullPage: true });
    await page.evaluate(sections => window.setSections([...sections, { answer: '另一种反馈暂时没有合适候选。', resourceIds: [] }]), groupedSections);
    assert.equal(await groups.count(), 3); assert.equal(await groups.nth(2).locator('.resource-card').count(), 0);
    assert.equal(await groups.nth(2).locator('.message-text').textContent(), '另一种反馈暂时没有合适候选。');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { await context.close(); }
}

(async () => {
  const fixture = compileFixture();
  fixture.runtime = fs.readFileSync(path.join(path.dirname(require.resolve('vue/package.json')), 'dist/vue.runtime.global.prod.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(path.dirname(require.resolve('vue-i18n/package.json')), 'dist/vue-i18n.global.prod.js'), 'utf8');
  fixture.html = '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 搜索部分结果验证</title>' +
    '<link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f6f7fb;font-family:Arial,"Microsoft Yahei",sans-serif}.ai-search-workspace{display:block;padding:28px;max-width:1580px;margin:auto}.message-text{line-height:1.8;margin:0 0 18px}.fixture-title{margin:0 0 12px;color:#202b43;font-size:22px}@media(max-width:600px){.ai-search-workspace{padding:12px}} </style>' +
    '<div class="ai-search-workspace"><div class="message-viewport"><h1 class="fixture-title">AI 资产搜索</h1><p class="message-text">' + answer + '</p>' +
    '<p class="inline-notice warning-notice result-warning">模型返回了部分无法核对的资源 ID。已保留结果，无法读取的资源资料留空。</p><div id="results"></div></div></div>' +
    '<script src="/runtime.js"></script><script src="/fixture.js"></script></html>';
  await fsp.mkdir(experimentDirectory, { recursive: true });
  await fsp.mkdir(screenshotDirectory, { recursive: true });
  const browserTemporaryDirectory = path.join(experimentDirectory, 'browser-tmp');
  await fsp.mkdir(browserTemporaryDirectory, { recursive: true });
  process.env.TEMP = browserTemporaryDirectory;
  process.env.TMP = browserTemporaryDirectory;
  process.env.TMPDIR = browserTemporaryDirectory;
  await Promise.all([
    fsp.writeFile(path.join(experimentDirectory, 'fixture.js'), fixture.bundle),
    fsp.writeFile(path.join(experimentDirectory, 'fixture.css'), fixture.stylesheet),
    fsp.writeFile(path.join(experimentDirectory, 'fixture.html'), fixture.html),
  ]);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await testViewport(browser, fixture, false);
    await testViewport(browser, fixture, true);
    const sectionsFixture = compileFixture(true);
    sectionsFixture.runtime = fixture.runtime;
    sectionsFixture.html = fixture.html.replace(/<p class="message-text">[\s\S]*?<div id="results">/, '<div id="results">');
    const sectionExperiment = path.join(artifactRoot, 'experiments/answer-sections');
    await fsp.mkdir(sectionExperiment, { recursive: true });
    await Promise.all([fsp.writeFile(path.join(sectionExperiment, 'fixture.js'), sectionsFixture.bundle),
      fsp.writeFile(path.join(sectionExperiment, 'fixture.css'), sectionsFixture.stylesheet), fsp.writeFile(path.join(sectionExperiment, 'fixture.html'), sectionsFixture.html)]);
    await testAnswerSections(browser, sectionsFixture, false);
    await testAnswerSections(browser, sectionsFixture, true);
    console.log('PASS answer sections browser: actual Vue answer/card ordering, distinct group membership, independent mobile paging, empty-group explanations, desktop/mobile layouts, and zero API calls.');
    console.log('PASS partial results browser: actual Vue components, trusted preview/links, exact copyable unresolved IDs, blank unknown metadata/media, distinct duplicate details, complete desktop/mobile paging, and zero model calls.');
    console.log('Screenshot: ' + screenshot);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
