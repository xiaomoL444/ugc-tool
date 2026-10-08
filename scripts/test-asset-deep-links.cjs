const assert = require('node:assert/strict');
// Run against a dev server with Playwright available through node_modules or NODE_PATH.
const { chromium } = require('playwright');
const baseUrl = process.env.AI_SEARCH_TEST_URL || 'http://127.0.0.1:8080';
const effects = Object.fromEntries(Array.from({length:140}, (_, index) => {
  const id = String(index + 1);
  return [id, {id, nameI18nKey:`effectPlayer.effect.${id}`, duration:2, isLoop:false, tagList:[], icon:'', standPath:`${id}.webm`, hasAudio:true, audioPath:`${id}.opus`, giVersion:index % 2 ? '7.0' : '7.1'}];
}));
const bgm = Array.from({length:140}, (_, index) => ({id:index+1, nameI18nKey:`bgmPlayer.data.${index+1}`, song_id:2000000+index, album_id:3000000, albumI18nKey:'bgmPlayer.album.3000000', time:120, minute:2, second:0, category:index<70 ? 101 : 102, order:index, giVersion:index%2 ? '7.0':'7.1'}));
async function main() {
  const browser = await chromium.launch({headless:true, channel:'msedge'});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', error => {if (!error.message.includes('ResizeObserver loop')) errors.push(error.message)});
  await page.addInitScript(() => {
    const paused = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {configurable:true, get() {return this.getAttribute('data-test-src') || ''}, set(value) {this.setAttribute('data-test-src', value)}});
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {configurable:true, get() {return paused.get(this) !== false}});
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {configurable:true, get() {return 4}});
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {configurable:true, get() {return 5}});
    HTMLMediaElement.prototype.play = function() {paused.set(this,false); this.dataset.testPlays = String(Number(this.dataset.testPlays || 0)+1); return Promise.resolve()};
    HTMLMediaElement.prototype.pause = function() {paused.set(this,true)};
    HTMLMediaElement.prototype.load = function() {};
  });
  await page.route('**/ugc-tool-data/EffectPlayer/data.json*', route => route.fulfill({json:{effectData:effects, TagData:{}, category:{}}}));
  await page.route('**/ugc-tool-data/BgmPlayer/data.json*', route => route.fulfill({json:{data:bgm, category:[{id:101,nameI18nKey:'bgmPlayer.category.101'},{id:102,nameI18nKey:'bgmPlayer.category.102'}]}}));
  await page.route('**/ugc-tool-data/*/i18n/*.json*', route => route.fulfill({json:{}}));
  await page.route('**/music.163.com/**', route => route.fulfill({body:'<!doctype html><title>Test player</title>'}));
  await page.goto(`${baseUrl}/EffectPlayer?id=140`);
  await page.locator('.modal-id').filter({hasText:'140'}).waitFor();
  await page.locator('.modal .start-preview').waitFor();
  assert.equal(await page.locator('.modal video,.modal audio').count(),2,'Deep link loads the requested main video and audio');
  assert.equal(await page.locator('.modal video,.modal audio').evaluateAll(media => media.every(item => item.paused)),true,'Deep-link effect media starts paused');
  await page.locator('.modal .start-preview').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.modal video,.modal audio')].every(media => !media.paused));
  await page.locator('.close-button').click();
  const targetVisible = await page.locator('[data-effect-id="140"]').evaluate(item => {
    const list = document.querySelector('.effect-list');
    const a=item.getBoundingClientRect(), b=list.getBoundingClientRect(); return a.bottom>b.top && a.top<b.bottom;
  });
  assert.equal(targetVisible,true,'Deep-linked effect card is scrolled into view');
  await page.locator('#effect-search').fill('nothing-matches');
  await page.evaluate(() => {history.pushState({},'', '/EffectPlayer?id=1');window.dispatchEvent(new PopStateEvent('popstate'))});
  await page.waitForFunction(() => /(?:^|[：:\s])1$/.test(document.querySelector('.modal-id')?.textContent?.trim() || ''));
  assert.equal(await page.locator('#effect-search').inputValue(),'');
  await page.evaluate(() => {history.pushState({},'', '/EffectPlayer?id=99999999');window.dispatchEvent(new PopStateEvent('popstate'))});
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await page.goto(`${baseUrl}/BgmPlayer?id=140`);
  await page.locator('[data-bgm-id="140"][aria-current="true"]').waitFor();
  assert.match(await page.locator('.metadata-panel iframe').getAttribute('src'),/id=2000139&auto=0/,'BGM asset id resolves to its own song_id without autoplay');
  const bgmVisible = await page.locator('[data-bgm-id="140"]').evaluate(item => {
    const list=document.querySelector('.song-list-scroll'),a=item.getBoundingClientRect(),b=list.getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom;
  });
  assert.equal(bgmVisible,true,'Deep-linked BGM is scrolled into view');
  await page.locator('#bgm-search').fill('nothing-matches');
  await page.evaluate(() => {history.pushState({},'', '/BgmPlayer?id=1');window.dispatchEvent(new PopStateEvent('popstate'))});
  await page.locator('[data-bgm-id="1"][aria-current="true"]').waitFor();
  assert.equal(await page.locator('#bgm-search').inputValue(),'');
  assert.match(await page.locator('.metadata-panel iframe').getAttribute('src'),/id=2000000&auto=0/);
  await page.evaluate(() => {history.pushState({},'', '/BgmPlayer?id=99999999');window.dispatchEvent(new PopStateEvent('popstate'))});
  await page.waitForFunction(() => !document.querySelector('.metadata-panel iframe'));
  await page.evaluate(() => {history.pushState({},'', '/BgmPlayer?id=1&id=2');window.dispatchEvent(new PopStateEvent('popstate'))});
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.metadata-panel iframe').count(),0,'Repeated query ids cannot select a media source');
  assert.deepEqual(errors,[]);
  console.log('PASS Effect/BGM deep links: real asset IDs, distant scroll, paused effect preview, explicit play, query changes, filter reset, invalid/repeated IDs, runtime errors');
  await browser.close();
}
main().catch(error=>{console.error(error);process.exitCode=1});
