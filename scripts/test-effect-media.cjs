// node scripts/test-effect-media.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const frames = new Map();
let nextFrame = 0;
let now = 0;
const intervals = new Map();
let intervalId = 0;
const context = { exports: {}, performance: { now: () => now }, setInterval: (fn) => { intervals.set(++intervalId, fn); return intervalId; }, clearInterval: (id) => intervals.delete(id), requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: (id) => frames.delete(id) };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/views/EffectPlayer/synchronizedMedia.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const create = context.exports.createSynchronizedMedia;
class Media extends EventTarget {
  constructor(duration) { super(); Object.assign(this, { duration, readyState: 4, seeking: false, paused: true, ended: false, muted: true, loop: false, time: 0, seeks: 0, plays: 0 }); }
  get currentTime() { return this.time; }
  set currentTime(t) { this.seeks++; this.time = t; this.ended = t >= this.duration; }
  play() { this.plays++; if (this.rejectAudible && !this.muted) return Promise.reject({ name: 'NotAllowedError' }); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.removed = true; }
  load() { this.loaded = true; }
  end() { this.time = this.duration; this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
}
function frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()); }
async function main() {
  const settle = () => new Promise(setImmediate);
  // Each of stand, tail, and audio can be the longest track.
  for (const lengths of [[5, 2, 3], [2, 5, 3], [2, 3, 5], [3]]) {
    const tracks = lengths.map((length) => new Media(length));
    const c = create(tracks, tracks[2] ?? null);
    c.setActive(true);
    await settle();
    assert.ok(tracks.every((m) => !m.paused));
    const longest = tracks[lengths.indexOf(Math.max(...lengths))];
    tracks.filter((m) => m !== longest).forEach((m) => m.end());
    frame();
    assert.ok(tracks.every((m) => m.seeks === 0), 'Short tracks cannot independently loop');
    longest.end(); frame();
    assert.ok(tracks.every((m) => m.currentTime === 0 && m.plays === 2), 'The group restarts together');
    c.dispose();
    assert.ok(tracks.every((m) => m.paused && m.removed && m.loaded));
    assert.equal(frames.size, 0);
  }
  const video = new Media(5), audio = new Media(3);
  const restartTracks = [new Media(5), new Media(3), new Media(6)];
  const restartGroup = create(restartTracks, restartTracks[2]);
  restartGroup.setActive(true);
  await settle();
  now += 1500;
  restartTracks.forEach((m) => { m.time = 1.5; });
  restartGroup.restart();
  restartGroup.setAudible(true);
  assert.ok(restartTracks.every((m) => m.currentTime === 0 && !m.paused), 'Hover restart resets every track together');
  assert.ok(restartTracks.every((m) => !m.loaded && !m.removed), 'Restart reuses loaded media without downloading again');
  assert.equal(restartTracks[2].muted, false);
  restartGroup.dispose();
  const c = create([video, audio], audio);
  c.setActive(true);
  await settle();
  now += 1200;
  video.time = audio.time = 1.2;
  c.setAudible(true);
  assert.equal(audio.muted, false);
  c.setAudible(false);
  assert.equal(audio.muted, true);
  assert.equal(audio.currentTime, 1.2);
  assert.equal(audio.seeks, 0, 'Hover only changes mute; it cannot restart audio');
  c.setActive(false);
  assert.ok(video.paused && audio.paused);
  c.setActive(true);
  assert.equal(video.currentTime, 1.2, 'Offscreen suspension preserves progress');
  audio.time = 0.5; frame();
  assert.equal(audio.currentTime, video.currentTime, 'Video follows the actual audio clock');
  assert.equal(audio.seeks, 0, 'Drift correction never seeks the audio');
  audio.readyState = 2; audio.dispatchEvent(new Event('waiting'));
  assert.equal(video.paused, false, 'Audio buffering must not freeze video');
  video.readyState = 1; video.dispatchEvent(new Event('waiting'));
  assert.equal(audio.paused, false, 'Video buffering cannot interrupt audio');
  video.readyState = 4;
  audio.readyState = 4; audio.dispatchEvent(new Event('canplay'));
  await settle();
  [...intervals.values()].forEach((recover) => recover());
  assert.ok(!video.paused && !audio.paused);
  c.dispose();

  const ready = new Media(2), broken = new Media(4);
  broken.readyState = 0;
  const errors = create([ready, broken], null);
  errors.setActive(true);
  assert.ok(ready.paused, 'Wait for all tracks before starting');
  broken.dispatchEvent(new Event('error'));
  assert.equal(ready.paused, false, 'An unavailable file cannot block the remaining tracks');
  await settle();
  ready.end(); frame();
  assert.equal(ready.currentTime, 0);
  errors.setActive(false);
  errors.retryFailed();
  assert.equal(broken.loaded, true, 'A cached failed resource can be retried');
  assert.equal(ready.loaded, undefined, 'Retry does not reload healthy media');
  errors.dispose();

  const autoVideo = new Media(2), autoAudio = new Media(4);
  autoAudio.rejectAudible = true;
  let blocked = false;
  const autoplay = create([autoVideo, autoAudio], autoAudio, (value) => { blocked = value; });
  autoplay.setAudible(true); autoplay.setActive(true);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(blocked, true);
  assert.equal(autoAudio.muted, true);
  now += 2500;
  autoVideo.end(); frame();
  assert.equal(autoVideo.currentTime, 2, 'Blocked longer audio still determines the loop duration');
  assert.equal(autoAudio.currentTime, 0, 'Blocked audio uses the virtual clock without repeatedly seeking');
  autoAudio.rejectAudible = false;
  autoplay.setAudible(true);
  assert.equal(autoAudio.paused, false);
  assert.equal(autoAudio.currentTime, 2.5, 'Enabling audio joins the current timeline');
  await settle();
  now += 1500; frame();
  assert.equal(autoAudio.currentTime, 2.5, 'Wall time cannot truncate an audio track');
  autoAudio.end(); frame();
  assert.equal(autoVideo.currentTime, 0);
  assert.equal(autoAudio.currentTime, 0);
  autoplay.dispose();

  const lateVideo = new Media(5), lateAudio = new Media(4);
  lateVideo.readyState = 2;
  lateAudio.readyState = 0;
  const late = create([lateVideo, lateAudio], lateAudio);
  late.setActive(true);
  assert.equal(lateVideo.paused, false, 'A first video frame is sufficient to attempt playback');
  assert.equal(lateAudio.paused, true, 'Loading audio does not block video startup');
  now += 1000;
  lateAudio.readyState = 4;
  lateAudio.dispatchEvent(new Event('canplay'));
  assert.equal(lateAudio.paused, false);
  assert.equal(lateAudio.currentTime, 0, 'Delayed audio starts intact instead of skipping its beginning');
  await settle();
  late.setActive(false);
  const plays = lateVideo.plays;
  late.setActive(true);
  assert.ok(lateVideo.plays > plays, 'Cached media resumes without source reload');
  assert.equal(lateVideo.removed, undefined);
  await settle();
  lateVideo.paused = true;
  [...intervals.values()].forEach((recover) => recover());
  assert.equal(lateVideo.paused, false, 'Recovery handles a missed playback event');
  late.dispose();
  assert.equal(intervals.size, 0);

  // Reproduce tablet startup/buffering: wall time passes but audio barely advances.
  const tabletVideo = new Media(1.38), tabletAudio = new Media(1.393167);
  const tablet = create([tabletVideo, tabletAudio], tabletAudio);
  tablet.setAudible(true);
  tablet.setActive(true);
  await settle();
  tabletAudio.time = 0.1;
  tabletVideo.time = 0.6;
  now += 2200;
  frame();
  assert.equal(tabletAudio.currentTime, 0.1);
  assert.equal(tabletAudio.seeks, 0, 'Slow audio is never forced forward or reset');
  assert.equal(tabletAudio.paused, false);
  tabletVideo.end();
  tabletAudio.readyState = 1;
  tabletAudio.dispatchEvent(new Event('waiting'));
  now += 3000; frame();
  assert.equal(tabletVideo.currentTime, 1.38, 'Completed video waits for buffered audio');
  assert.equal(tabletAudio.seeks, 0);
  tabletAudio.readyState = 4;
  tabletAudio.end(); frame();
  assert.equal(tabletAudio.currentTime, 0, 'Only actual completion restarts the group');
  assert.equal(tabletVideo.currentTime, 0);
  tablet.dispose();

  const poolContext = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/views/EffectPlayer/mediaPool.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, poolContext);
  const pool = poolContext.exports.createMediaPool(2);
  let created = 0, disposed = 0;
  const factory = () => ({ id: ++created, time: 1.5, dispose() { disposed++; } });
  const a = pool.acquire('a', factory); a.release();
  const again = pool.acquire('a', factory);
  assert.equal(again.value, a.value, 'Returning to a page reuses the same media instance');
  assert.equal(again.value.time, 1.5);
  const b = pool.acquire('b', factory); b.release();
  const d = pool.acquire('d', factory); d.release();
  const e = pool.acquire('e', factory); e.release();
  assert.equal(disposed, 1, 'Only least-recently-used idle media is evicted');
  assert.equal(pool.acquire('a', factory).value, again.value, 'An active media instance cannot be evicted');
  console.log('PASS shared longest-track loops, hover mute, drift correction, suspension, buffering, errors, autoplay, cleanup');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
