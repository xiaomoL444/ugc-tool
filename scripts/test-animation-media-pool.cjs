// Run with: node scripts/test-animation-media-pool.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { reactive } = require('vue');

const created = [];
class FakeVideo {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.currentTime = 0;
    this.playbackRate = 1;
    this.paused = true;
    this.src = '';
    this.loads = 0;
    this.plays = 0;
    this.removed = false;
    this.playError = null;
    created.push(this);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
  addEventListener(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
  }
  removeEventListener(event, callback) { this.listeners.get(event)?.delete(callback); }
  emit(event) { this.listeners.get(event)?.forEach((callback) => callback({ type: event, target: this })); }
  play() {
    this.plays += 1;
    if (this.playError) return Promise.reject(this.playError);
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  load() { this.loads += 1; this.currentTime = 0; }
  remove() { this.removed = true; }
}
global.document = { createElement: (tag) => { assert.equal(tag, 'video'); return new FakeVideo(); } };

function loadTypescript(filename) {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
  });
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (name) => {
    if (name === 'vue') return { reactive };
    if (name === '@/utils/oss') return { createOss: (scope) => ({ path: (value) => `${scope}/${value}` }) };
    if (name.startsWith('.')) {
      const candidate = path.resolve(path.dirname(filename), `${name}.ts`);
      if (fs.existsSync(candidate)) return loadTypescript(candidate);
    }
    return originalRequire(name);
  };
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}
const { acquireAnimationMedia, tryAcquireCachedAnimationMedia } = loadTypescript(path.resolve(__dirname, '../src/views/AnimationViewer/cachedAnimationMedia.ts'));
const { createMediaPool } = loadTypescript(path.resolve(__dirname, '../src/views/EffectPlayer/mediaPool.ts'));

(async () => {
  const lruPool = createMediaPool(2);
  const resource = () => ({ disposals: 0, dispose() { this.disposals += 1; } });
  const lruA = lruPool.acquire('a', resource); lruA.release();
  const lruB = lruPool.acquire('b', resource); lruB.release();
  assert.equal(lruPool.tryAcquireCached('missing'), null);
  const lruC = lruPool.acquire('c', resource); lruC.release();
  assert.equal(lruA.value.disposals, 1, 'A cache-only miss preserves the existing idle LRU order');
  const recentB = lruPool.tryAcquireCached('b');
  assert.ok(recentB);
  assert.equal(recentB.value, lruB.value);
  lruB.release();
  assert.equal(lruPool.tryAcquireCached('b'), null, 'A stale release cannot free a cache-only lease');
  recentB.release();
  const lruD = lruPool.acquire('d', resource); lruD.release();
  assert.equal(lruC.value.disposals, 1, 'Releasing a cache-only hit refreshes its LRU order');
  assert.equal(lruB.value.disposals, 0, 'The recently reused cached resource remains available');

  assert.equal(tryAcquireCachedAnimationMedia('video/original.mp4', 'card', 'skill:0'), null);
  assert.equal(created.length, 0, 'A cache-only miss creates no video');
  const first = acquireAnimationMedia('video/original.mp4', 'card', 'skill:0');
  const media = first.value;
  const element = media.element;
  assert.equal(tryAcquireCachedAnimationMedia('video/original.mp4', 'card', 'skill:0'), null,
    'A cache-only lookup cannot take a currently leased player');
  assert.equal(created.length, 1, 'An active-player cache miss creates no additional video');
  assert.equal(element.src, 'AnimationViewer/video/original.mp4', 'The original media path is passed through unchanged');
  assert.equal(element.muted, true);
  assert.equal(element.loop, true);
  assert.equal(element.playsInline, true);
  assert.equal(element.preload, 'auto');
  media.configure('第一段');
  media.setActive(true);
  await Promise.resolve();
  assert.equal(element.paused, false);
  assert.equal(element.playbackRate, 1, 'Playback keeps the native rate');
  element.currentTime = 2.75;
  element.emit('canplay');
  assert.equal(media.state.ready, true);
  media.park();
  first.release();
  first.release();
  assert.equal(element.paused, true);
  assert.equal(element.removed, true);
  assert.equal(element.currentTime, 2.75, 'Parking preserves the playback position');
  assert.equal(element.loads, 0, 'Parking does not reload or clear buffered media');
  const cached = tryAcquireCachedAnimationMedia('video/original.mp4', 'card', 'skill:0');
  assert.ok(cached, 'A parked player can be acquired synchronously without creating one');
  assert.equal(cached.value, media, 'A cache-only hit restores the same player');
  assert.equal(cached.value.state.ready, true, 'A cache-only hit preserves readiness');
  assert.equal(cached.value.element.currentTime, 2.75, 'A cache-only hit preserves the paused position');
  assert.equal(created.length, 1, 'A cache-only hit creates no additional video');
  assert.equal(tryAcquireCachedAnimationMedia('video/original.mp4', 'card', 'skill:0'), null,
    'A cache-only hit owns its lease exclusively');
  cached.release();
  const second = acquireAnimationMedia('video/original.mp4', 'card', 'skill:0');
  assert.equal(second.value, media, 'Revisiting a virtual card reuses the same player');
  assert.equal(second.value.state.ready, true, 'Revisits retain readiness');
  second.value.configure('New locale name');
  assert.equal(element.currentTime, 2.75, 'Changing locale does not reset playback');
  assert.equal(element.attributes.get('aria-label'), 'New locale name');
  assert.equal(element.playbackRate, 1, 'Reattaching cached media keeps the native rate');
  assert.ok([...element.listeners.values()].every((listeners) => listeners.size === 1), 'Reattachment does not duplicate event handlers');

  const simultaneous = acquireAnimationMedia('video/original.mp4', 'card', 'skill:0');
  const modal = acquireAnimationMedia('video/original.mp4', 'modal', 'skill:0');
  const otherCard = acquireAnimationMedia('video/original.mp4', 'card', 'other-skill:0');
  assert.notEqual(simultaneous.value, media, 'Live leases own their player exclusively');
  assert.notEqual(modal.value, media, 'Modal playback cannot steal the card player');
  assert.notEqual(otherCard.value, media, 'Repeated resources keep independent card positions');

  second.value.setActive(false);
  const playsBefore = element.plays;
  element.emit('canplay');
  assert.equal(element.plays, playsBefore, 'Preloading offscreen media does not start playback');
  second.value.setActive(true);
  second.value.setActive(false);
  await Promise.resolve();
  assert.equal(element.paused, true, 'A pending play promise cannot restart a parked player');
  element.playError = new DOMException('Autoplay denied', 'NotAllowedError');
  second.value.setActive(true);
  await Promise.resolve();
  assert.equal(second.value.state.autoplayBlocked, true);
  element.playError = null;
  second.value.setActive(true);
  await Promise.resolve();
  assert.equal(second.value.state.autoplayBlocked, false);
  element.emit('error');
  assert.equal(second.value.state.failed, true);
  second.value.retry();
  assert.equal(second.value.state.failed, false);
  assert.equal(element.loads, 1, 'Only explicit retry resets an errored player');

  second.value.park();
  second.release();
  const releasedElements = [element];
  for (let index = 0; index < 80; index += 1) {
    const lease = acquireAnimationMedia(`video/${index}.mp4`, 'card', `${index}`);
    releasedElements.push(lease.value.element);
    lease.value.park();
    lease.release();
  }
  assert.equal(releasedElements.filter((video) => video.src).length, 64, 'Only 64 idle players retain a source');
  assert.equal(element.src, '', 'The oldest idle player is evicted');
  assert.equal(element.loads, 2, 'Eviction releases its source');
  assert.ok([...element.listeners.values()].every((listeners) => listeners.size === 0), 'Eviction removes all event handlers');
  const beforeCacheMiss = created.map(video => ({ src: video.src, loads: video.loads }));
  assert.equal(tryAcquireCachedAnimationMedia('video/original.mp4', 'card', 'skill:0'), null,
    'An evicted player is a cache-only miss');
  assert.equal(tryAcquireCachedAnimationMedia('video/never-loaded.mp4', 'card'), null);
  assert.deepEqual(created.map(video => ({ src: video.src, loads: video.loads })), beforeCacheMiss,
    'Cache-only misses neither create media nor dispose existing idle players');
  assert.ok(simultaneous.value.element.src, 'Active card leases are never evicted by idle trimming');
  assert.ok(modal.value.element.src, 'Active modal leases are never evicted by idle trimming');
  for (const lease of [simultaneous, modal, otherCard]) { lease.value.park(); lease.release(); }
  const recreated = acquireAnimationMedia('video/original.mp4', 'card', 'skill:0');
  assert.notEqual(recreated.value, media, 'A revisited evicted card acquires a fresh player');
  recreated.value.park();
  recreated.release();
  console.log('Animation media pool checks passed (cache-only hits/misses, reuse, exclusive leases, viewport pause, retry, and 64-player idle limit).');
})().catch((error) => { console.error(error); process.exitCode = 1; });
