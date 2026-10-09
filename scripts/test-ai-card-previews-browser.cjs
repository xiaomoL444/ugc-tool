/* NODE_PATH=<bundled playwright modules> node scripts/test-ai-card-previews-browser.cjs [base URL] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv.slice(2).find(argument => !argument.startsWith('--')) || 'http://127.0.0.1:8080';
const detailsOnly = process.argv.includes('--details-only');
const outputDirectory = path.resolve(__dirname, '../../ugc-ai-search-file/verification/browser');
const effect = { id: '64', duration: 12, isLoop: false, tagList: [], icon: '64.png', standPath: '64.mp4', tailPath: '64-tail.mp4', hasAudio: true, audioPath: '64.m4a' };
const bgm = { id: 1, song_id: 2635292815, album_id: 250336341, time: 180000, minute: 3, second: 0, nameI18nKey: 'bgmPlayer.data.1', albumI18nKey: 'bgmPlayer.album.250336341', category: 101 };
const longDescription = '远处先传来低沉的滚动雷声，随后响度逐渐上升，中段伴随密集而细碎的轰鸣，最后留下缓慢消散的低频尾音。声音没有对白和音乐，适合需要持续雷鸣的环境。完整描述应该在浮层中可以阅读，卡片里只占一行。' + '可以分辨多次雷鸣之间的细微间隔，音色由模糊的低频逐渐变得厚重，再回到远处的环境底噪。这段详细说明用于验证长资产资料可以通过浮层滚动完整阅读，而不展开整个卡片或移动聊天记录。'.repeat(12) + '<b>这是一段普通文本，不能变成 HTML。</b>';
const longBgmDescription = '轻柔的木管旋律伴随弦乐铺底，音乐逐渐展开，保持平稳而舒适的节奏，适合森林探索与安静的户外场景。' + '细听时可以分辨弦乐与木管之间的呼应，旋律在不同段落中缓慢变化，低声部维持温暖的和声。中段逐步加入明亮的点缀，尾段回到平静主题。这段完整音乐说明用于验证宽浮层能显示更多文字，同时在短视口和移动设备上仍然能够滚动阅读。'.repeat(10);
const detailKeywords = ['雷声', '低沉', '持续', '轰鸣', '自然环境', '阴沉', '雷雨前奏', '远处'];
const detailUses = ['暴风雨场景', '紧张气氛', '夜间探索'];
const detailReason = '完整匹配原因：低沉且持续的真实声音特征符合查询；尾音较长，可在原资产页进一步确认。';
const cards = [
  { kind: 'sound', id: '10001', title: '环境_雷声_低沉', description: longDescription, keywords: detailKeywords, suggestedUses: detailUses, matchReason: detailReason, matchType: 'feature', duration: 12 },
  { kind: 'sound', id: '10002', title: '环境_雷声_短促', description: '另一段声音，用于检查切换试听会停止上一段。', duration: 12 },
  { kind: 'effect', id: '64', title: '蓝色法阵', description: '蓝色光环与拖尾效果，悬停试听同步音轨。', duration: 12, hasAudio: true },
  { kind: 'bgm', id: '1', title: '森林探索', description: longBgmDescription, keywords: ['木管', '弦乐', '舒缓', '森林', '探索'], suggestedUses: ['户外探索', '宁静村庄'], matchReason: '完整匹配原因：舒缓旋律与森林探索场景相符。', duration: 180 },
].map(card => ({ keywords: [], suggestedUses: [], ...card, resourceId: `${card.kind}:${card.id}`, href: '/ignored-history-url' }));
const history = [
  { id: 'preview-fixture', title: '预览验证', updatedAt: 2, contextStart: 0, messages: [
    { id: 'preview-reply', role: 'assistant', status: 'complete', mode: 'basic', source: 'basic', content: '音效、特效与 BGM 可以直接预览，也可以复制名称和数字 ID。', cards },
    { id: 'preview-repeat', role: 'assistant', status: 'complete', mode: 'basic', source: 'basic', content: '同一特效也可在另一条回复中独立预览。', cards: [cards[2]] },
  ] },
  { id: 'empty-fixture', title: '空白会话', updatedAt: 1, contextStart: 0, messages: [] },
];

function makeWav(seconds = 12, frequency = 180) {
  const sampleRate = 22050;
  const samples = seconds * sampleRate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRate;
    const envelope = 0.1 + 0.5 * (0.5 + 0.5 * Math.sin(time * 1.7)) ** 2;
    const wave = Math.sin(2 * Math.PI * frequency * time) + 0.2 * Math.sin(2 * Math.PI * (frequency + 73) * time);
    bytes.writeInt16LE(Math.round(19000 * envelope * wave), 44 + index * 2);
  }
  return bytes;
}
const wav = makeWav();
const secondWav = makeWav(12, 280);
const effectArtwork = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="14" fill="#101d32"/><circle cx="50" cy="50" r="33" fill="none" stroke="#4ccaff" stroke-width="3"/><circle cx="50" cy="50" r="24" fill="none" stroke="#a7e7ff" stroke-width="2"/><path d="M50 13 72 69 20 35H80L28 69Z" fill="none" stroke="#70d5ff" stroke-width="2"/></svg>';
const albumArtwork = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#5d806e"/><circle cx="76" cy="22" r="14" fill="#dedbbc"/><path d="M0 90 15 42 28 82 45 25 59 83 80 45 100 92Z" fill="#213e35"/></svg>';

function fulfillWav(route, bytes) {
  const range = /^bytes=(\d+)-(\d*)$/u.exec(route.request().headers().range || '');
  const headers = { 'accept-ranges': 'bytes' };
  if (!range) return route.fulfill({ contentType: 'audio/wav', headers, body: bytes });
  const start = Number(range[1]);
  const end = Math.min(bytes.length - 1, range[2] ? Number(range[2]) : bytes.length - 1);
  if (start > end) return route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${bytes.length}` } });
  return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
}

async function install(context, state) {
  await context.addInitScript(seed => {
    localStorage.setItem('ugc-tools.ai-search.history.v1', JSON.stringify(seed));
    window.__previewClipboard = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__previewClipboard.push(value); } } });
    // Keep all audio real: waveform decoding, metadata, seeking and playback
    // below use generated WAV bytes. Stub only video decoding for this fixture.
    const paused = new WeakMap();
    Object.defineProperty(HTMLVideoElement.prototype, 'src', { configurable: true, get() { return this.dataset.testSrc || ''; }, set(value) { this.dataset.testSrc = value; } });
    Object.defineProperty(HTMLVideoElement.prototype, 'paused', { configurable: true, get() { return paused.get(this) !== false; } });
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get() { return 4; } });
    Object.defineProperty(HTMLVideoElement.prototype, 'duration', { configurable: true, get() { return 12; } });
    HTMLVideoElement.prototype.play = function() { paused.set(this, false); return Promise.resolve(); };
    HTMLVideoElement.prototype.pause = function() { paused.set(this, true); };
    HTMLVideoElement.prototype.load = function() {};
  }, history);
  await context.route('**/api/ai-search/**', route => {
    state.apiRequests = (state.apiRequests || 0) + 1;
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    if (endpoint === 'config') return route.fulfill({ json: { configured: false, available: false, retrieval: { available: true } } });
    if (endpoint === 'catalog') return route.fulfill({ json: { catalogVersion: 'preview-browser-v1', counts: { total: 4 }, mode: 'keyword', coverage: { description: 1 } } });
    if (endpoint === 'search') return route.fulfill({ json: { catalogVersion: 'preview-browser-v1', mode: 'keyword', total: 4, hasMore: false, coverage: { description: 1 }, items: cards } });
    if (endpoint === 'assets') return route.fulfill({ json: { catalogVersion: 'preview-browser-v1', items: cards } });
    state.modelRequests++;
    return route.fulfill({ status: 500, body: 'No model call is expected for history previews.' });
  });
  await context.route('**/ugc-tool-data/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    assert.ok(!pathname.endsWith('/AISearch/SystemPrompt.md'), 'History previews and basic searches do not download a model prompt');
    if (pathname.endsWith('/EffectPlayer/data.json')) {
      state.effectCatalogues++;
      if (state.effectMetadataReady) await state.effectMetadataReady;
      return route.fulfill({ json: { effectData: { 64: effect }, TagData: {} } });
    }
    if (pathname.endsWith('/BgmPlayer/data.json')) {
      state.bgmCatalogues++;
      return route.fulfill({ json: { musicData: [bgm], category: [] } });
    }
    if (pathname.includes('/SoundEffectPlayer/audio/')) return fulfillWav(route, pathname.includes('10002') ? secondWav : wav);
    if (pathname.endsWith('/EffectPlayer/audio/64.m4a')) return fulfillWav(route, wav);
    if (pathname.endsWith('/EffectPlayer/icon/64.png')) return route.fulfill({ contentType: 'image/svg+xml', body: effectArtwork });
    if (pathname.endsWith('/BgmPlayer/album_pic/250336341.jpg')) return route.fulfill({ contentType: 'image/svg+xml', body: albumArtwork });
    if (pathname.includes('/i18n/')) return route.fulfill({ json: {} });
    return route.fulfill({ status: 404, body: 'Fixture asset not found.' });
  });
  await context.route('**/music.163.com/**', route => {
    if (route.request().url().includes('/outchain/player')) state.musicFrames++;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:8px;background:#f9f8fd;color:#786096;font:13px sans-serif"><button type="button">▶</button> 森林探索 · 音乐播放器</body></html>' });
  });
}

async function waitForCards(page) {
  await page.locator('.chat-message').first().locator('.resource-card').first().waitFor();
  await page.locator('.retrieval-status').waitFor();
  await page.waitForFunction(() => !document.querySelector('.inline-notice')?.textContent?.includes('读取'));
  assert.equal(await page.locator('.model-trigger').getAttribute('data-search-mode'), 'free', 'Restored history keeps the current default site-model selection without making any model request');
}
async function showPreviewPosition(page, position) {
  const reply = page.locator('.chat-message').first();
  const previous = reply.locator('.results-previous');
  while (await previous.count() && await previous.isEnabled()) await previous.click();
  const card = reply.locator(`.resource-card[data-result-position="${position}"]`);
  for (let index = 0; !await card.count() && index < cards.length; index++) {
    const next = reply.locator('.results-next');
    assert.ok(await next.count() && await next.isEnabled(), `Preview result ${position} is reachable`);
    await next.click();
  }
  await card.waitFor();
  return card;
}

async function observeWaveformProgress(soundCard, milliseconds, blockTimeUpdates = false) {
  return soundCard.locator('.sound-mini-preview').evaluate(async (preview, options) => {
    const audio = preview.querySelector('audio');
    const slider = preview.querySelector('.waveform');
    const cursor = preview.querySelector('.waveform-cursor');
    // Wait for the click/event render to settle before measuring visible motion.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const positions = new Set([slider.getAttribute('aria-valuenow')]);
    const cursorPositions = new Set([cursor.style.left]);
    let blockedTimeUpdates = 0;
    const blockUpdate = event => {
      blockedTimeUpdates++;
      event.stopImmediatePropagation();
    };
    const observer = new MutationObserver(() => {
      positions.add(slider.getAttribute('aria-valuenow'));
      cursorPositions.add(cursor.style.left);
    });
    observer.observe(slider, { attributes: true, attributeFilter: ['aria-valuenow'] });
    observer.observe(cursor, { attributes: true, attributeFilter: ['style'] });
    if (options.blockTimeUpdates) audio.addEventListener('timeupdate', blockUpdate, true);
    const startTime = audio.currentTime;
    try {
      await new Promise(resolve => setTimeout(resolve, options.milliseconds));
      return {
        positions: [...positions].map(Number),
        cursorPositions: [...cursorPositions],
        blockedTimeUpdates,
        advancedSeconds: audio.currentTime - startTime,
      };
    } finally {
      observer.disconnect();
      audio.removeEventListener('timeupdate', blockUpdate, true);
    }
  }, { milliseconds, blockTimeUpdates });
}

async function testDesktop(browser) {
  const state = { modelRequests: 0, effectCatalogues: 0, bgmCatalogues: 0, musicFrames: 0 };
  let releaseEffectMetadata;
  state.effectMetadataReady = new Promise(resolve => { releaseEffectMetadata = resolve; });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1800, height: 1600 } });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/AISearch`);
  await waitForCards(page);
  const soundOne = page.locator('.resource-sound').nth(0);
  const soundTwo = page.locator('.resource-sound').nth(1);
  const effectCard = page.locator('.resource-effect').nth(0);
  const repeatedEffect = page.locator('.resource-effect').nth(1);
  const bgmCard = page.locator('.resource-bgm');
  await soundOne.scrollIntoViewIfNeeded();
  await soundOne.locator('.waveform-bars').first().waitFor();
  await soundTwo.locator('.waveform-bars').first().waitFor();
  const bars = await soundOne.locator('.waveform-bars').first().getAttribute('d');
  assert.ok((bars.match(/M/g) || []).length >= 80, 'Decoded PCM produces a detailed waveform');
  assert.ok(new Set(bars.match(/V[\d.]+/g)).size > 20, 'Waveform peaks reflect varying real sample amplitudes');
  const slider = soundOne.locator('.waveform');
  await page.waitForFunction(() => document.querySelector('.resource-sound .waveform')?.getAttribute('aria-disabled') === 'false');
  const bounds = await slider.boundingBox();
  await slider.click({ position: { x: bounds.width * 0.5, y: bounds.height * 0.5 } });
  const seekState = await soundOne.locator('audio').evaluate(audio => ({ time: audio.currentTime, duration: audio.duration, ready: audio.readyState, source: audio.src, seekable: [...Array(audio.seekable.length)].map((_, index) => [audio.seekable.start(index), audio.seekable.end(index)]) }));
  assert.ok(Math.abs(seekState.time - 6) < 0.4, `Waveform click seeks the real audio element: ${JSON.stringify(seekState)}`);
  await soundOne.locator('.sound-mini-play').click();
  await page.waitForFunction(() => !document.querySelectorAll('.resource-sound audio')[0].paused);
  const smoothProgress = await observeWaveformProgress(soundOne, 450, true);
  assert.ok(smoothProgress.blockedTimeUpdates >= 1, 'Native low-frequency timeupdate events were suppressed during the smoothness check');
  assert.ok(smoothProgress.advancedSeconds > 0.25, 'The real WAV audio advances during the smoothness check');
  assert.ok(smoothProgress.positions.length >= 8, `Waveform progress keeps updating while timeupdate is blocked: ${JSON.stringify(smoothProgress)}`);
  assert.ok(smoothProgress.cursorPositions.length >= 8, 'The visible waveform cursor moves continuously rather than jumping on timeupdate');
  assert.ok(smoothProgress.positions.every((position, index, positions) => index === 0 || position > positions[index - 1]), 'Playback progress moves forward without jitter');
  await soundOne.locator('.sound-mini-play').click();
  await page.waitForFunction(() => document.querySelectorAll('.resource-sound audio')[0].paused);
  const pausedProgress = await observeWaveformProgress(soundOne, 300);
  assert.equal(pausedProgress.positions.length, 1, 'Paused waveform progress is frozen');
  assert.equal(pausedProgress.cursorPositions.length, 1, 'Paused waveform cursor is frozen');
  assert.equal(pausedProgress.advancedSeconds, 0, 'Pausing stops real audio playback');
  await soundOne.locator('.sound-mini-play').click();
  await page.waitForFunction(() => !document.querySelectorAll('.resource-sound audio')[0].paused);
  await soundTwo.locator('.sound-mini-play').click();
  await page.waitForFunction(() => document.querySelectorAll('.resource-sound audio')[0].paused && !document.querySelectorAll('.resource-sound audio')[1].paused);

  await effectCard.locator('h3').hover();
  assert.equal(await soundTwo.locator('audio').evaluate(audio => audio.paused), false, 'A loading effect has not claimed audio yet');
  releaseEffectMetadata();
  await effectCard.scrollIntoViewIfNeeded();
  await effectCard.locator('.preview-icon').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.resource-sound audio')].every(audio => audio.paused));
  await repeatedEffect.scrollIntoViewIfNeeded();
  await repeatedEffect.hover();
  await repeatedEffect.locator('.preview-icon').waitFor();
  assert.equal(await effectCard.locator('video').count(), 2, 'The first visible effect retains both of its video panes');
  assert.equal(await repeatedEffect.locator('video').count(), 2, 'A duplicate visible effect has independent video panes');
  assert.equal(await page.locator('.resource-effect audio').count(), 2, 'A duplicate visible effect has independent audio elements');
  const originalVideo = await effectCard.locator('video').first().elementHandle();
  assert.match(await effectCard.locator('.preview-icon').getAttribute('src'), /\/EffectPlayer\/icon\/64\.png$/);
  assert.equal(await effectCard.locator('.effect-video-links a[href$="/64.mp4"]').count(), 0, 'The main effect video has no separate external link');
  assert.match(await effectCard.locator('.effect-video-links a').first().getAttribute('href'), /\/EffectPlayer\/webm\/64-tail\.mp4$/);
  await effectCard.hover();
  await page.waitForFunction(() => {
    const audio = document.querySelector('.resource-effect audio');
    return audio && !audio.muted && !audio.paused && [...document.querySelectorAll('.resource-sound audio')].every(sound => sound.paused);
  });
  await repeatedEffect.hover();
  await page.waitForFunction(() => {
    const card = document.querySelectorAll('.resource-effect')[1];
    const audio = card?.querySelector('audio');
    return audio && (!audio.paused && !audio.muted || card.querySelector('.audio-status')?.textContent?.includes('点击预览以开启声音'));
  });
  if (await repeatedEffect.locator('audio').evaluate(audio => audio.paused || audio.muted)) {
    assert.equal(await repeatedEffect.locator('.audio-status').innerText(), '点击预览以开启声音', 'Blocked hover audio explains the required user gesture');
    await repeatedEffect.locator('.effect-media').click();
  }
  try {
    await page.waitForFunction(() => {
      const effects = document.querySelectorAll('.resource-effect audio');
      return effects.length === 2 && effects[0].paused && effects[0].muted && !effects[1].paused && !effects[1].muted;
    }, undefined, { timeout: 5000 });
  } catch (error) {
    const tracks = await page.locator('.resource-effect audio').evaluateAll(elements => elements.map(audio => ({ paused: audio.paused, muted: audio.muted, time: audio.currentTime, ended: audio.ended,
      ready: audio.readyState, hover: audio.closest('.resource-effect').matches(':hover'), suspended: audio.closest('.effect-media').__vueParentComponent.props.suspended,
      state: audio.closest('.effect-media').__vueParentComponent.setupState.lease?.value?.state })));
    throw new Error(`Duplicate effect audio did not switch: ${JSON.stringify(tracks)}`, { cause: error });
  }
  assert.equal(await originalVideo.evaluate(video => document.querySelectorAll('.resource-effect')[0].contains(video)), true, 'Hovering a duplicate card does not move the original video DOM');
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => [...document.querySelectorAll('.resource-effect audio')].every(audio => audio.muted));
  await effectCard.locator('.resource-copy-actions button').nth(0).click();
  await effectCard.locator('.resource-copy-actions button').nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.__previewClipboard), ['64', '蓝色法阵'], 'Copy actions preserve the numeric asset ID and display name');

  await bgmCard.scrollIntoViewIfNeeded();
  await bgmCard.locator('.bgm-mini-preview').waitFor();
  await bgmCard.locator('.bgm-preview-icon img').waitFor();
  assert.match(await bgmCard.locator('.bgm-preview-icon img').getAttribute('src'), /\/BgmPlayer\/album_pic\/250336341\.jpg$/);
  assert.equal(await bgmCard.locator('.bgm-preview-duration').innerText(), '3:00');
  assert.equal(await page.locator('.bgm-player-wrap iframe').count(), 0, 'History does not mount external music players');
  assert.equal(state.musicFrames, 0, 'History previews do not request NetEase before a click');
  await bgmCard.locator('.bgm-preview-toggle').click();
  await bgmCard.locator('iframe').waitFor();
  assert.match(await bgmCard.locator('iframe').getAttribute('src'), /id=2635292815&auto=0&height=66$/);
  await soundOne.locator('.sound-mini-play').click();
  await page.waitForFunction(() => !document.querySelector('.bgm-player-wrap iframe'));
  assert.equal(await bgmCard.locator('.bgm-preview-toggle').getAttribute('aria-expanded'), 'false', 'Starting a sound removes the external music player');
  await soundOne.locator('.sound-mini-play').click();
  await bgmCard.locator('.bgm-preview-toggle').click();
  await page.frameLocator('.bgm-player-wrap iframe').getByRole('button', { name: '▶', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDirectory, 'ai-card-previews-desktop.png'), fullPage: true });

  // A shorter scrolling surface makes the off-screen stop observable even
  // when the large desktop viewport can otherwise display every result card.
  await page.locator('.message-viewport').evaluate(viewport => { viewport.style.flex = '0 0 300px'; });
  await bgmCard.scrollIntoViewIfNeeded();
  if (await bgmCard.locator('iframe').count() === 0) await bgmCard.locator('.bgm-preview-toggle').click();
  await repeatedEffect.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('.bgm-player-wrap iframe'));
  await page.locator('.message-viewport').evaluate(viewport => { viewport.style.removeProperty('flex'); });
  await bgmCard.scrollIntoViewIfNeeded();
  await bgmCard.locator('.bgm-preview-toggle').click();
  const effectAudioHandles = await page.locator('.resource-effect audio').elementHandles();
  await page.getByRole('button', { name: '空白会话', exact: true }).click();
  assert.equal(await page.locator('.resource-card iframe').count(), 0, 'Changing conversations unmounts music players');
  for (const audio of effectAudioHandles) {
    assert.deepEqual(await audio.evaluate(element => ({ paused: element.paused, muted: element.muted, connected: element.isConnected })), { paused: true, muted: true, connected: false }, 'Changing conversations stops and parks each independent effect audio element');
  }
  await page.getByRole('button', { name: '预览验证', exact: true }).click();
  await waitForCards(page);
  await page.locator('.resource-bgm .bgm-mini-preview').waitFor();
  assert.equal(await page.locator('.bgm-player-wrap iframe').count(), 0, 'Returning to history does not restart music');
  await page.setViewportSize({ width: 780, height: 1600 });
  await page.waitForFunction(() => document.querySelector('.chat-message')?.querySelectorAll('.resource-card').length === 2);
  const reply = page.locator('.chat-message').first();
  const beforePagingApi = state.apiRequests;
  const pagingSound = await showPreviewPosition(page, 1);
  await pagingSound.locator('.waveform-bars').first().waitFor();
  const soundAudio = await pagingSound.locator('audio').elementHandle();
  await pagingSound.locator('.sound-mini-play').click();
  await page.waitForFunction(audio => !audio.paused, soundAudio);
  await reply.locator('.results-next').click();
  assert.deepEqual(await soundAudio.evaluate(audio => ({ paused: audio.paused, connected: audio.isConnected })), { paused: true, connected: false }, 'Changing result pages stops and unmounts real sound playback');
  const pagingEffect = await showPreviewPosition(page, 3);
  await pagingEffect.locator('.preview-icon').waitFor();
  await pagingEffect.hover();
  const pagingEffectAudio = await pagingEffect.locator('audio').elementHandle();
  const pagingEffectHandle = await pagingEffect.elementHandle();
  await page.waitForFunction(card => { const audio = card.querySelector('audio'); return audio && (!audio.paused && !audio.muted || card.querySelector('.audio-status')?.textContent?.includes('点击预览以开启声音')); }, pagingEffectHandle, { timeout: 5000 });
  if (await pagingEffectAudio.evaluate(audio => audio.paused || audio.muted)) {
    assert.equal(await pagingEffect.locator('.audio-status').innerText(), '点击预览以开启声音');
    await pagingEffect.locator('.effect-media').click();
  }
  await page.waitForFunction(audio => !audio.paused && !audio.muted, pagingEffectAudio, { timeout: 5000 });
  await reply.locator('.results-previous').click();
  assert.deepEqual(await pagingEffectAudio.evaluate(audio => ({ paused: audio.paused, muted: audio.muted, connected: audio.isConnected })), { paused: true, muted: true, connected: false }, 'Changing result pages stops and parks the audible effect track');
  const pagingMusic = await showPreviewPosition(page, 4);
  await pagingMusic.locator('.bgm-preview-toggle').click();
  await pagingMusic.locator('iframe').waitFor();
  const musicFrame = await pagingMusic.locator('iframe').elementHandle();
  await reply.locator('.results-previous').click();
  assert.equal(await musicFrame.evaluate(frame => frame.isConnected), false, 'Changing result pages removes the external BGM player');
  assert.equal(await reply.locator('iframe').count(), 0);
  assert.equal(state.apiRequests, beforePagingApi, 'Page changes request no AI/search API calls');
  await page.setViewportSize({ width: 1800, height: 1600 });
  await page.waitForFunction(() => document.querySelector('.chat-message')?.querySelectorAll('.resource-card').length === 4);
  assert.equal(state.effectCatalogues, 1, 'Effect metadata is shared across card remounts');
  assert.equal(state.bgmCatalogues, 1, 'BGM metadata is shared across card remounts');
  assert.equal(state.modelRequests, 0);
  assert.deepEqual(errors, []);
  await context.close();
}

async function testMobile(browser) {
  const state = { modelRequests: 0, effectCatalogues: 0, bgmCatalogues: 0, musicFrames: 0 };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/AISearch`);
  await waitForCards(page);
  const reply = page.locator('.chat-message').first();
  const beforeMobilePagingApi = state.apiRequests;
  const visited = [];
  for (let position = 1; position <= cards.length; position++) {
    const card = await showPreviewPosition(page, position);
    assert.equal(await reply.locator('.resource-card').count(), 1, 'Mobile previews show only one resource per reply page');
    visited.push(await card.locator('.asset-link').getAttribute('href'));
  }
  assert.deepEqual(visited, ['/SoundEffectPlayer?id=10001', '/SoundEffectPlayer?id=10002', '/EffectPlayer?id=64', '/BgmPlayer?id=1'], 'Mobile pages retain all archived preview kinds and their original order');
  assert.equal(state.apiRequests, beforeMobilePagingApi, 'Mobile history paging does not call search or model APIs');
  const bgmCard = await showPreviewPosition(page, 4);
  await bgmCard.scrollIntoViewIfNeeded();
  await bgmCard.locator('.bgm-preview-toggle').click();
  await bgmCard.locator('iframe').waitFor();
  await page.frameLocator('.bgm-player-wrap iframe').getByRole('button', { name: '▶', exact: true }).waitFor();
  const dimensions = await page.evaluate(() => {
    const workspace = document.querySelector('.ai-search-workspace');
    return { document: document.documentElement.scrollWidth, viewport: innerWidth, workspace: workspace.scrollWidth, client: workspace.clientWidth,
      overflowingCards: [...document.querySelectorAll('.resource-card')].filter(card => card.scrollWidth > card.clientWidth + 1).length };
  });
  assert.ok(dimensions.document <= dimensions.viewport + 1, 'Mobile page has no horizontal overflow');
  assert.ok(dimensions.workspace <= dimensions.client + 1, 'Mobile search workspace has no horizontal overflow');
  assert.equal(dimensions.overflowingCards, 0, 'Mini previews fit mobile resource cards');
  await page.screenshot({ path: path.join(outputDirectory, 'ai-card-previews-mobile.png'), fullPage: true });
  assert.equal(state.modelRequests, 0);
  assert.deepEqual(errors, []);
  await context.close();
}

async function assertDetailsContent(page, expectedCard = cards[0]) {
  const popover = page.locator('.resource-details-popover');
  await popover.waitFor();
  assert.equal(await popover.getAttribute('role'), 'tooltip');
  assert.equal(await popover.locator('.resource-details-description').innerText(), expectedCard.description, 'The complete description remains readable as plain text');
  assert.equal(await popover.locator('.resource-details-description b').count(), 0, 'Description markup is displayed as literal text');
  assert.deepEqual(await popover.locator('.resource-details-keywords .resource-details-tags>span').allTextContents(), expectedCard.keywords, 'All keywords are available in details');
  if (expectedCard.matchReason) assert.ok((await popover.locator('.match-reason').innerText()).includes(expectedCard.matchReason), 'Details include the complete matching reason');
  else assert.equal(await popover.locator('.match-reason').count(), 0);
  assert.deepEqual(await popover.locator('.suggested-uses .use-tag').allTextContents(), expectedCard.suggestedUses, 'All suggested uses are available in details');
  const geometry = await popover.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, panelHeight: rect.height, width: innerWidth, height: innerHeight, clippedParent: !!element.closest('.message-viewport') }; });
  assert.equal(geometry.clippedParent, false, 'Details are teleported outside the scrolling message viewport');
  assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.width + 1 && geometry.bottom <= geometry.height + 1, `Complete details stay inside the screen: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.panelHeight <= Math.min(420, geometry.height * 0.6) + 1, `Every detail panel respects the 420px and 60vh height ceilings: ${JSON.stringify(geometry)}`);
  return popover;
}

async function testDetailsDesktop(browser) {
  const state = { modelRequests: 0, effectCatalogues: 0, bgmCatalogues: 0, musicFrames: 0 };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 } });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/AISearch`);
    await waitForCards(page);
    const reply = page.locator('.chat-message').first();
    const card = await showPreviewPosition(page, 1);
    await card.locator('.waveform-bars').first().waitFor();
    assert.ok(await reply.locator('.resource-card').count() >= 3, 'The compact desktop row fits at least three previews beside the independent history panel at 1366px');
    assert.ok(await reply.locator('.resource-card').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1 && [...element.querySelectorAll('.resource-mini-preview')].every(preview => preview.scrollWidth <= preview.clientWidth + 1))), 'Sound, effect and BGM previews fit the compact desktop card width');
    assert.equal(await card.locator('.match-reason,.resource-tags,.suggested-uses').count(), 0, 'Long explanations and tags do not expand the default card');
    assert.equal(await page.locator('.resource-details-popover').count(), 0);
    const trigger = card.locator('.resource-details-trigger');
    const summary = await trigger.locator('.resource-details-summary').evaluate(element => { const styles = getComputedStyle(element); return { whitespace: styles.whiteSpace, overflow: styles.overflow, ellipsis: styles.textOverflow, decoration: styles.textDecorationLine, truncated: element.scrollWidth > element.clientWidth, height: element.getBoundingClientRect().height }; });
    assert.deepEqual([summary.whitespace, summary.overflow, summary.ellipsis], ['nowrap', 'hidden', 'ellipsis'], 'The default description uses a single ellipsis line');
    assert.ok(summary.truncated && summary.height <= 24);
    assert.equal(summary.decoration, 'none', 'An idle description has no underline');
    const cardHeight = (await card.boundingBox()).height;
    const scrollHeight = await page.locator('.message-viewport').evaluate(element => element.scrollHeight);
    const beforeDetailsApi = state.apiRequests;
    await trigger.hover();
    assert.equal(await trigger.locator('.resource-details-summary').evaluate(element => getComputedStyle(element).textDecorationLine), 'underline', 'Hovering an unpinned description shows its clickable underline');
    const popover = await assertDetailsContent(page);
    assert.ok(Math.abs((await popover.boundingBox()).width - 640) < 1, 'Long non-music details use the wider 640px panel');
    assert.ok((await popover.boundingBox()).height <= 420, 'Long details keep the same 420px height ceiling as compact details');
    assert.equal(await trigger.getAttribute('aria-describedby'), await popover.getAttribute('id'), 'The focused or hovered trigger identifies its tooltip');
    assert.ok(Math.abs((await card.boundingBox()).height - cardHeight) < 1, 'Showing complete details does not grow the card');
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollHeight), scrollHeight, 'Showing details does not grow the scrolling message surface');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-desktop.png'), fullPage: true });
    assert.equal(await popover.evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'A temporary hover preview does not accept pointer interaction');
    const previewPoint = await popover.evaluate(element => { const bounds = element.getBoundingClientRect(); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }; });
    await page.mouse.move(previewPoint.x, previewPoint.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await popover.count(), 0, 'Moving off the summary into its temporary preview closes it immediately');
    console.log('Desktop hover preview closes by the next animation frame after leaving its summary');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await trigger.locator('.resource-details-summary').click();
    await assertDetailsContent(page);
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Clicking the description leaves focus on its trigger');
    assert.equal(await trigger.locator('.resource-details-summary').evaluate(element => getComputedStyle(element).textDecorationLine), 'none', 'Pinning details removes the description underline');
    assert.equal(await popover.evaluate(element => getComputedStyle(element).pointerEvents), 'auto', 'Clicking the description pins interactive details for reading and scrolling');
    const tooltipPoint = await popover.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const points = [{ x: bounds.left + 18, y: bounds.top + 18 }, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, { x: bounds.right - 18, y: bounds.bottom - 18 }];
      return points.find(point => document.elementFromPoint(point.x, point.y)?.closest('.resource-details-popover'));
    });
    assert.ok(tooltipPoint, 'The fixture has an interactive coordinate inside complete details');
    assert.equal(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)?.closest('.resource-details-popover'), tooltipPoint), true, 'Hit testing reaches the visible details rather than content underneath');
    await page.mouse.move(tooltipPoint.x, tooltipPoint.y);
    await page.waitForTimeout(220);
    assert.equal(await popover.count(), 1, 'Moving from the clicked summary into pinned details keeps the panel open');
    const mouseMessageScrollTop = await page.locator('.message-viewport').evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => document.querySelector('.resource-details-popover')?.scrollTop > 0);
    assert.equal(await popover.count(), 1, 'Native mouse-wheel scrolling inside details keeps the panel open');
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), mouseMessageScrollTop, 'Scrolling inside complete details does not move the chat viewport');
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => { const panel = document.querySelector('.resource-details-popover'); return panel && panel.scrollTop >= panel.scrollHeight - panel.clientHeight - 1; });
    assert.ok(await popover.locator('.use-tag').last().evaluate(element => { const bounds = element.getBoundingClientRect(); const panelBounds = element.closest('.resource-details-popover').getBoundingClientRect(); return bounds.top >= panelBounds.top && bounds.bottom <= panelBounds.bottom; }), 'Native wheel scrolling reaches the final suggested use inside the panel');
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), mouseMessageScrollTop, 'Reading the final detail content does not move the chat viewport');
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), mouseMessageScrollTop, 'Native wheel gestures at the details bottom boundary do not move the chat viewport');
    console.log('Desktop native details:', JSON.stringify(await popover.evaluate(element => ({ id: element.id, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, messageScrollTop: document.querySelector('.message-viewport').scrollTop }))));
    const scrollbarPoint = await popover.evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.right - 4, y: rect.top + rect.height * 0.8 }; });
    await page.mouse.click(scrollbarPoint.x, scrollbarPoint.y);
    await page.waitForTimeout(220);
    assert.equal(await popover.count(), 1, 'Clicking the native details scrollbar does not dismiss the panel');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-scrollbar-desktop.png'), fullPage: true });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(220);
    assert.equal(await popover.count(), 1, 'Pinned details remain open after moving away from both the trigger and the panel');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-pinned-desktop.png'), fullPage: true });
    await trigger.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await popover.count(), 0, 'Clicking the same description again closes pinned details without reopening on hover');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.locator('.resource-details-summary').evaluate(element => getComputedStyle(element).textDecorationLine), 'underline', 'Closing pinned details restores the description underline');
    await page.mouse.move(5, 5);
    assert.equal(await trigger.locator('.resource-details-summary').evaluate(element => getComputedStyle(element).textDecorationLine), 'none', 'Moving away from the unpinned description removes its underline');
    await trigger.locator('svg').click();
    await assertDetailsContent(page);
    assert.equal(await popover.evaluate(element => getComputedStyle(element).pointerEvents), 'auto', 'Clicking the info icon also pins the details');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(220);
    assert.equal(await popover.count(), 1, 'Details pinned with the info icon remain open after the pointer leaves');
    await page.mouse.click(5, 5);
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden', timeout: 1500 });
    assert.equal(await popover.count(), 0, 'An outside mouse click closes pinned details');
    await trigger.hover();
    const firstTooltipId = await (await assertDetailsContent(page)).getAttribute('id');
    const adjacentTrigger = reply.locator('.resource-card').nth(1).locator('.resource-details-trigger');
    await adjacentTrigger.hover();
    await page.waitForFunction(previousId => { const panels = document.querySelectorAll('.resource-details-popover'); return panels.length === 1 && panels[0].id !== previousId; }, firstTooltipId);
    const adjacentTooltip = page.locator('.resource-details-popover');
    await adjacentTooltip.waitFor();
    assert.equal(await adjacentTooltip.count(), 1, 'Moving directly to another description leaves only its own tooltip');
    assert.notEqual(await adjacentTooltip.getAttribute('id'), firstTooltipId);
    assert.equal(await adjacentTooltip.locator('.resource-details-description').innerText(), cards[1].description, 'The adjacent description has no stale content from the prior tooltip');
    await page.mouse.move(5, 5);
    await adjacentTooltip.waitFor({ state: 'hidden', timeout: 1500 });
    assert.equal(await page.locator('.resource-details-popover').count(), 0);
    const musicCard = await showPreviewPosition(page, 4);
    await musicCard.locator('.resource-details-trigger').hover();
    const musicDetails = await assertDetailsContent(page, cards[3]);
    assert.ok(Math.abs((await musicDetails.boundingBox()).width - 720) < 1, 'Music details use a 720px panel for the longer musical description');
    assert.ok((await musicDetails.boundingBox()).height <= 420, 'Music details keep the same 420px height ceiling');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-bgm-desktop.png'), fullPage: true });
    await page.mouse.move(5, 5);
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden' });
    await showPreviewPosition(page, 1);
    // Same-task enter/leave must still close immediately, even if
    // show() was waiting for its first Vue tick when the pointer left.
    await trigger.evaluate(element => {
      element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      element.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.resource-details-popover').count(), 0, 'A pending positioning promise cannot reopen a hover preview after pointer leave');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await page.locator('#asset-query').focus();
    await trigger.focus();
    await assertDetailsContent(page);
    await page.keyboard.press('Escape');
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'Escape closes details opened by keyboard focus');
    await trigger.press('Enter');
    await assertDetailsContent(page);
    assert.equal(await page.locator('.resource-details-popover').evaluate(element => getComputedStyle(element).pointerEvents), 'auto', 'Keyboard Enter pins interactive details');
    await trigger.press('Enter');
    assert.equal(await page.locator('.resource-details-popover').count(), 0, 'Repeating keyboard activation closes pinned details');
    await trigger.press('Space');
    await assertDetailsContent(page);
    await page.keyboard.press('Escape');
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden' });
    await page.keyboard.press('Tab');
    await page.setViewportSize({ width: 1366, height: 480 });
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await trigger.hover();
    await trigger.focus();
    await trigger.press('Enter');
    const scrollingDetails = await assertDetailsContent(page);
    const keyboardScrollState = await scrollingDetails.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    assert.ok(keyboardScrollState.scrollHeight > keyboardScrollState.clientHeight, 'The short viewport requires scrolling the complete details');
    const messageScrollTop = await page.locator('.message-viewport').evaluate(element => element.scrollTop);
    const scrollingDetailsId = await scrollingDetails.getAttribute('id');
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => document.querySelector('.resource-details-popover')?.scrollTop > 0);
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), messageScrollTop, 'The wheel on the summary scrolls only complete details, not the chat viewport');
    assert.equal(await scrollingDetails.getAttribute('id'), scrollingDetailsId, 'The summary wheel scrolls the same complete details panel');
    assert.equal(await scrollingDetails.count(), 1, 'The wheel keeps complete details open while the pointer stays on the summary');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-scroll-desktop.png'), fullPage: true });
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction(() => document.querySelector('.resource-details-popover')?.scrollTop === 0);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), messageScrollTop, 'Wheel gestures at the details boundary do not leak into the chat viewport');
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('.resource-details-popover')?.scrollTop > 0);
    await page.keyboard.press('End');
    assert.ok(await scrollingDetails.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1), 'Keyboard End reaches the final detail content');
    assert.ok(await scrollingDetails.locator('.use-tag').last().evaluate(element => element.getBoundingClientRect().bottom <= element.closest('.resource-details-popover').getBoundingClientRect().bottom), 'The final suggested use can be read after keyboard scrolling');
    assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), messageScrollTop, 'Details keyboard scrolling does not move the chat viewport');
    assert.equal(await scrollingDetails.count(), 1, 'Scrolling inside complete details keeps the panel open');
    await page.keyboard.press('Home');
    assert.equal(await scrollingDetails.evaluate(element => element.scrollTop), 0);
    await scrollingDetails.focus();
    await page.keyboard.press('End');
    assert.ok(await scrollingDetails.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1), 'A focused details panel also supports keyboard End');
    await page.keyboard.press('Home');
    assert.equal(await scrollingDetails.evaluate(element => element.scrollTop), 0, 'A focused details panel also supports keyboard Home');
    await page.keyboard.press('Escape');
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Escape from the focused panel restores focus to its summary');
    await page.keyboard.press('Tab');
    await page.mouse.move(5, 5);
    await page.setViewportSize({ width: 780, height: 900 });
    await page.waitForFunction(() => document.querySelector('.chat-message')?.querySelectorAll('.resource-card').length === 2);
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await trigger.focus();
    const openDetails = await assertDetailsContent(page);
    const oldPopover = await openDetails.elementHandle();
    const oldTrigger = await trigger.elementHandle();
    // Click the pagination control without moving focus first, so this probes
    // destruction of an open teleported tooltip when its card is unmounted.
    await reply.locator('.results-next').evaluate(button => button.click());
    assert.equal(await oldPopover.evaluate(element => element.isConnected), false, 'Changing pages destroys an open teleported details panel');
    assert.equal(await oldTrigger.evaluate(element => element.isConnected), false);
    assert.equal(await page.locator('.resource-details-popover').count(), 0);
    assert.equal(state.apiRequests, beforeDetailsApi, 'Opening, closing and paging details calls no AI/search API');
    assert.equal(state.modelRequests, 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function testDetailsMobile(browser) {
  const state = { modelRequests: 0, effectCatalogues: 0, bgmCatalogues: 0, musicFrames: 0 };
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await install(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/AISearch`);
    await waitForCards(page);
    const card = await showPreviewPosition(page, 1);
    await card.locator('.waveform-bars').first().waitFor();
    const beforeDetailsApi = state.apiRequests;
    const trigger = card.locator('.resource-details-trigger');
    const height = (await card.boundingBox()).height;
    await trigger.tap();
    const touchDetails = await assertDetailsContent(page);
    assert.equal(await touchDetails.evaluate(element => getComputedStyle(element).pointerEvents), 'auto', 'Pinned mobile details allow touch interaction inside the panel');
    assert.ok(await touchDetails.evaluate(element => element.scrollHeight > element.clientHeight), 'The long mobile fixture requires detail scrolling');
    const messageScrollTop = await page.locator('.message-viewport').evaluate(element => element.scrollTop);
    const bounds = await touchDetails.boundingBox();
    const touchSession = await context.newCDPSession(page);
    try {
      const x = bounds.x + bounds.width / 2;
      const start = bounds.y + bounds.height - 60;
      const end = bounds.y + 60;
      const point = y => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 });
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(start)] });
      for (let index = 1; index <= 10; index++) {
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(start + (end - start) * index / 10)] });
        await page.waitForTimeout(20);
      }
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => document.querySelector('.resource-details-popover')?.scrollTop > 0);
      assert.equal(await touchDetails.count(), 1, 'A native touch swipe inside pinned details does not close the panel');
      assert.equal(await page.locator('.message-viewport').evaluate(element => element.scrollTop), messageScrollTop, 'A touch swipe scrolls complete details without moving the chat viewport');
      await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-touch-scroll-mobile.png'), fullPage: true });
    } finally { await touchSession.detach(); }
    assert.ok(Math.abs((await card.boundingBox()).height - height) < 1, 'Tapping details does not expand a mobile card');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-mobile.png'), fullPage: true });
    await page.locator('#asset-query').tap();
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'A tap outside closes pinned mobile details');
    await trigger.tap();
    await assertDetailsContent(page);
    await trigger.tap();
    assert.equal(await page.locator('.resource-details-popover').count(), 0, 'Tapping the same description again closes pinned mobile details');
    const musicCard = await showPreviewPosition(page, 4);
    await musicCard.locator('.resource-details-trigger').tap();
    const musicDetails = await assertDetailsContent(page, cards[3]);
    assert.ok(Math.abs((await musicDetails.boundingBox()).width - (390 - 24)) < 1, 'Music details clamp the 720px preferred width to the mobile viewport with 12px margins');
    assert.ok((await musicDetails.boundingBox()).height <= 420 && (await musicDetails.boundingBox()).height <= 844 * 0.6, 'Mobile music details respect the same panel and viewport height ceilings');
    await page.screenshot({ path: path.join(outputDirectory, 'ai-search-resource-details-bgm-mobile.png'), fullPage: true });
    await page.locator('#asset-query').tap();
    await page.locator('.resource-details-popover').waitFor({ state: 'hidden' });
    await showPreviewPosition(page, 1);
    await trigger.tap();
    const popover = await assertDetailsContent(page);
    const oldPopover = await popover.elementHandle();
    await page.locator('.chat-message').first().locator('.results-next').evaluate(button => button.click());
    assert.equal(await oldPopover.evaluate(element => element.isConnected), false, 'Mobile paging destroys its open tooltip');
    assert.equal(await page.locator('.resource-details-popover').count(), 0);
    assert.equal(state.apiRequests, beforeDetailsApi);
    assert.equal(state.modelRequests, 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.AI_SEARCH_BROWSER_CHANNEL || 'msedge', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    if (!detailsOnly) { await testDesktop(browser); await testMobile(browser); }
    await testDetailsDesktop(browser);
    await testDetailsMobile(browser);
    console.log(detailsOnly ? 'PASS AISearch compact details: single-line ellipsis, complete plain text, all tags/reasons/uses, 640px details and 720px BGM widths, shared 420px/60vh height limits, hover preview closes immediately on leaving the summary, description/info click pins mouse-readable details, native wheel to final content and scrollbar interaction without moving chat, pinned details persist away from both regions, repeated activation/outside click/Escape close, summary wheel and keyboard scroll isolation, native touch scrolling, pending positioning and page cleanup, fixed card height, no AI/search calls.' : 'PASS AISearch card previews and compact details: real WAV waveform and seek, smooth cursor without timeupdate, frozen paused progress, exclusive audio playback, effect icon/video links/hover audio, copy ID/name, trusted BGM song/album IDs, lazy iframe, scroll/conversation/page cleanup, cached metadata, mobile one-card pages preserve result order, no API requests on paging, mobile layout, temporary hover previews and click-pinned interactive details, keyboard/mobile access and fixed card height.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
