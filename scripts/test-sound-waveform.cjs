const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const moduleScope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/views/SoundEffectPlayer/waveform.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: moduleScope.exports });
const peaks = (...args) => Array.from(moduleScope.exports.samplePeaks(...args));
assert.deepEqual(peaks([new Float32Array(8)], 4), [0, 0, 0, 0]);
assert.deepEqual(peaks([], 4), []);
assert.deepEqual(peaks([Float32Array.of(0, 0, 0, 0, 1)], 2), [0, 1]);
assert.deepEqual(peaks([Float32Array.of(0.5, 1), Float32Array.of(-0.5, -1)], 2), [0.5, 1]);
assert.deepEqual(peaks([Float32Array.of(0.2, 0.4)], 128), [0.5, 1]);
assert.deepEqual(peaks([Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0)], 2), [1, 0]);
console.log('PASS sample peaks: silence, empty, trailing samples, opposite stereo channels, short audio, transients');

// Run browser coverage against a local dev server with WAVEFORM_PLAYWRIGHT pointing to Playwright.
if (process.env.WAVEFORM_PLAYWRIGHT) runBrowser().catch(error => { console.error(error); process.exitCode = 1; });

function wav(variant = 0) {
  const rate = 22050, frames = rate * 6;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const time = i / rate;
    const envelope = variant ? Math.exp(-time) : (time < 2 ? Math.sin(time * Math.PI / 2) ** 2 : time > 3 ? Math.exp(-(time - 3) * 2) : 0);
    buffer.writeInt16LE(Math.round(Math.sin(time * 440 * Math.PI * 2) * envelope * 22000), 44 + i * 2);
  }
  return buffer;
}

async function runBrowser() {
  const { chromium } = require(process.env.WAVEFORM_PLAYWRIGHT);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let delayNextWaveform = false;
  await page.route('**/ugc-tool-data/**', async route => {
    const url = route.request().url();
    if (url.includes('/SoundEffectPlayer/data.json')) {
      return route.fulfill({ json: { category: [{ id: 1, nameI18nKey: 'test.category' }], data: [1, 2, 3, 4].map(id => ({ id: String(id), category: 1, nameI18nKey: `test.sound${id}`, duration: '6.000' })) } });
    }
    const match = url.match(/\/audio\/(\d+)\.mp3/);
    if (match) {
      const id = Number(match[1]);
      if (route.request().resourceType() === 'fetch') {
        if (id === 3) return route.fulfill({ status: 503, body: 'Unavailable' });
        if (id === 4 && delayNextWaveform) await new Promise(resolve => setTimeout(resolve, 900));
      }
      const body = wav(id === 2 ? 1 : 0);
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        return route.fulfill({ status: 206, contentType: 'audio/wav', headers: {
          'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`,
          'content-length': String(end - start + 1),
        }, body: body.subarray(start, end + 1) });
      }
      return route.fulfill({ contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-length': String(body.length) }, body });
    }
    return route.fulfill({ json: {} });
  });
  const check = (condition, message) => assert.ok(condition, message);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.12, `${a} should be near ${b}`);
  const slider = page.getByRole('slider', { name: '音频波形', exact: true });
  const audio = () => page.locator('audio').evaluate(el => ({ current: el.currentTime, duration: el.duration, paused: el.paused, ended: el.ended }));
  const pause = async () => { const state = await audio(); if (!state.paused) await page.getByRole('button', { name: '暂停', exact: true }).click(); };
  const select = async index => {
    await page.locator('.sound-card').nth(index).click();
    await page.waitForFunction(() => document.querySelector('.waveform')?.getAttribute('aria-disabled') === 'false');
    await pause();
  };
  try {
    await page.goto(process.env.WAVEFORM_URL || 'http://127.0.0.1:8088/SoundEffectPlayer', { waitUntil: 'domcontentloaded' });
    await slider.waitFor();
    assert.equal(await slider.getAttribute('aria-disabled'), 'true');
    await page.getByRole('button', { name: '全部展开', exact: true }).click();
    await select(0);
    await page.locator('.waveform-played path').waitFor();
    const firstPath = await page.locator('.waveform-played path').getAttribute('d');
    check(firstPath.split('M').length === 129, 'real decoded waveform should have 128 peaks');
    const box = await slider.boundingBox();
    await slider.click({ position: { x: box.width / 4, y: box.height / 2 } });
    near((await audio()).current, 1.5);
    check((await audio()).paused, 'click must preserve paused state');
    const clip = await page.locator('.waveform-played').evaluate(el => Number(el.style.clipPath.match(/([\d.]+)%/)[1]));
    check(Math.abs(clip - 75) < .5, 'played clip follows seek');
    assert.equal(await page.locator('.waveform-played path').evaluate(el => getComputedStyle(el).stroke), 'rgb(23, 78, 166)');
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height / 2, { steps: 8 });
    near((await audio()).current, 4.5);
    await page.mouse.move(box.x - 30, box.y + box.height / 2);
    await page.mouse.up();
    near((await audio()).current, 0);
    await slider.press('End'); near((await audio()).current, 6);
    await slider.press('Home'); near((await audio()).current, 0);
    await slider.press('ArrowRight'); near((await audio()).current, .3);
    console.log('PASS decoded waveform, click, drag, pointer capture bounds, keyboard, paused state and dark blue progress');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('.waveform').getAttribute('aria-valuenow')) > .6);
    await pause();
    near(Number(await slider.getAttribute('aria-valuenow')), (await audio()).current);
    await select(1);
    await page.waitForFunction(previous => document.querySelector('.waveform-played path')?.getAttribute('d') !== previous, firstPath);
    check((await audio()).current < .5, 'track change resets time');
    delayNextWaveform = true;
    await select(3);
    await select(1);
    const secondPath = await page.locator('.waveform-played path').getAttribute('d');
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('.waveform-played path').getAttribute('d'), secondPath);
    await select(2);
    await page.getByRole('status').filter({ hasText: '波形加载失败' }).waitFor();
    await slider.click({ position: { x: box.width / 2, y: box.height / 2 } });
    near((await audio()).current, 3);
    console.log('PASS playback sync, source reset, stale request isolation, decode failure still allows seeking');
    await select(0);
    await slider.press('End');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime < 1 && !document.querySelector('audio').paused);
    await pause();
    await page.locator('.switch').click();
    await slider.click({ position: { x: box.width * .98, y: box.height / 2 } });
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime < 1 && !document.querySelector('audio').paused);
    await pause();
    await page.locator('.switch').click();
    await slider.click({ position: { x: box.width * .4, y: box.height / 2 } });
    const output = path.join(__dirname, '../node_modules/.cache/sound-waveform-qa');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'waveform.png') });
    await page.setViewportSize({ width: 1000, height: 800 });
    check(await page.locator('.player').evaluate(el => el.scrollWidth <= el.clientWidth), 'player should fit narrow pane');
    check(errors.length === 0, errors.join('\n'));
    console.log('PASS replay, loop, responsive pane and no runtime errors');
  } finally { await browser.close(); }
}
