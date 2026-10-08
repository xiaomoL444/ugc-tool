/* Run: node scripts/test-ai-search-previews.cjs. Local fixtures only; no network or paid model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createPreviewMediaLoader } = require('../src/views/AISearch/previewMedia.ts');

const BASE = 'https://preview-fixture.invalid/ugc-tool-data';
const card = (kind, id, extras = {}) => ({ kind, id: String(id), resourceId: `${kind}:${id}`, ...extras });
const effect = (id, extras = {}) => ({
  id: String(id), title: `effectPlayer.data.${id}`, duration: 1.37, isLoop: false, tagList: [],
  icon: `${id}.png`, standPath: `${id}_h264.mp4`, hasAudio: true, audioPath: `${id}_aac.m4a`, ...extras,
});
const song = (id, extras = {}) => ({
  id, song_id: 2635292815, album_id: 250336341, time: 71, minute: 1, second: 11,
  nameI18nKey: `bgmPlayer.data.${id}`, albumI18nKey: 'bgmPlayer.album.250336341', ...extras,
});
const response = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data });

function fixtureFetcher(indexes) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, 'https://preview-fixture.invalid', 'Only configured OSS metadata may be fetched');
    const match = parsed.pathname.match(/^\/ugc-tool-data\/(EffectPlayer|BgmPlayer)\/data\.json$/);
    assert.ok(match, `Unexpected request: ${url}`);
    assert.ok(Object.prototype.hasOwnProperty.call(indexes, match[1]), `Missing local fixture: ${match[1]}`);
    return response(indexes[match[1]]);
  };
  return { fetcher, calls };
}

async function main() {
  const forbiddenFetch = async () => { throw new Error('Sound preview and rejected identities must not fetch'); };
  const loadSound = createPreviewMediaLoader(forbiddenFetch, BASE);
  const sound = await loadSound(card('sound', '51049', {
    href: 'https://untrusted.invalid/', src: 'https://untrusted.invalid/audio.mp3', preview: { src: 'javascript:alert(1)' },
  }));
  assert.deepEqual(sound, { kind: 'sound', src: `${BASE}/SoundEffectPlayer/audio/51049.mp3` });
  for (const invalid of [
    card('sound', '../51049'), card('sound', '51049?x=1'), card('sound', '51049#fragment'),
    card('sound', '51049', { resourceId: 'effect:51049' }),
    card('effect', '2', { resourceId: 'effect:3' }),
    card('bgm', '10001', { resourceId: 'bgm:10001/../../outside' }),
    card('unknown', '2'), card('sound', '1234567890123'),
  ]) assert.equal(await loadSound(invalid), null, `Unsafe identity must return no media: ${JSON.stringify(invalid)}`);

  const fixtures = fixtureFetcher({
    EffectPlayer: { effectData: {
      2: effect(2),
      38: effect(38, { tailPath: '38_tail_h264.mp4', hasAudio: false, audioPath: undefined, isLoop: true }),
      10012032: effect(10012032, { standPath: undefined, hasAudio: true, audioPath: undefined }),
      404: effect(405),
    } },
    BgmPlayer: { data: [song(10001)] },
  });
  const load = createPreviewMediaLoader(fixtures.fetcher, BASE);
  const [firstEffect, sameEffect, tailEffect] = await Promise.all([
    load(card('effect', '2')), load(card('effect', '2')), load(card('effect', '38')),
  ]);
  assert.equal(fixtures.calls.length, 1, 'Concurrent effect previews share one metadata request');
  assert.equal(firstEffect.kind, 'effect');
  assert.deepEqual(firstEffect, sameEffect);
  assert.equal(firstEffect.item.standPath, '2_h264.mp4', 'Use the actual source path, including MP4 in the webm directory');
  assert.equal(firstEffect.item.audioPath, '2_aac.m4a');
  assert.equal(firstEffect.item.hasAudio, true);
  assert.equal(tailEffect.item.tailPath, '38_tail_h264.mp4');
  assert.equal(tailEffect.item.hasAudio, false);
  assert.equal(await load(card('effect', '999')), null, 'Missing resources must not synthesize media paths');
  assert.equal(await load(card('effect', '404')), null, 'Object key and row identity must agree');
  const iconOnly = await load(card('effect', '10012032'));
  assert.equal(iconOnly.item.icon, '10012032.png');
  assert.ok(!iconOnly.item.standPath && !iconOnly.item.tailPath && !iconOnly.item.audioPath);
  assert.equal(iconOnly.item.hasAudio, false, 'Missing audioPath overrides stale hasAudio:true metadata');
  assert.equal(fixtures.calls.length, 1, 'Sequential cards also reuse the fetched effect index');

  const [bgm, duplicateBgm] = await Promise.all([load(card('bgm', '10001')), load(card('bgm', '10001'))]);
  assert.deepEqual(bgm, duplicateBgm);
  assert.equal(bgm.kind, 'bgm');
  assert.equal(bgm.songId, 2635292815, 'NetEase song ID may exceed a signed 32 bit integer');
  assert.notEqual(bgm.songId, 10001, 'Library asset ID must not be used as NetEase song ID');
  assert.equal(bgm.albumId, 250336341);
  assert.equal(bgm.duration, 71, 'Minute and second metadata represent seconds');
  assert.equal(bgm.albumI18nKey, 'bgmPlayer.album.250336341');
  assert.equal(fixtures.calls.length, 2, 'BGM and effects each fetch one project index');
  assert.equal(await load(card('bgm', '999')), null);

  const legacy = fixtureFetcher({ BgmPlayer: { musicData: [song(10002, {
    nameI18nKey: undefined, albumI18nKey: undefined, name: 'Legacy title', album: 'Legacy album', song_id: 1492281430,
  })] } });
  const oldCard = { resourceId: 'bgm:10002', id: '10002', kind: 'bgm' };
  const legacyBgm = await createPreviewMediaLoader(legacy.fetcher, BASE)(oldCard);
  assert.equal(legacyBgm.songId, 1492281430, 'Old cards work with legacy musicData metadata');
  assert.equal(legacyBgm.albumId, 250336341);

  for (const path of [
    '../outside.mp4', '/outside.mp4', 'sub/../outside.mp4', 'sub\\outside.mp4',
    'https://untrusted.invalid/outside.mp4', '//untrusted.invalid/outside.mp4',
    'javascript:alert(1)', '%2e%2e%2foutside.mp4', '2_h264.mp4?redirect=bad', '2_h264.mp4#bad',
  ]) {
    const unsafe = fixtureFetcher({ EffectPlayer: { effectData: { 2: effect(2, { standPath: path }) } } });
    const result = await createPreviewMediaLoader(unsafe.fetcher, BASE)(card('effect', '2'));
    assert.equal(result.kind, 'effect');
    assert.ok(!result.item.standPath, `Unsafe media path must be discarded: ${path}`);
    assert.equal(result.item.icon, '2.png', 'One invalid path must not discard valid media');
    assert.equal(result.item.audioPath, '2_aac.m4a');
  }
  const nested = fixtureFetcher({ EffectPlayer: { effectData: { 2: effect(2, { standPath: 'sub/2_h264.mp4' }) } } });
  assert.equal((await createPreviewMediaLoader(nested.fetcher, BASE)(card('effect', '2'))).item.standPath,
    'sub/2_h264.mp4', 'Safe relative subdirectories remain within the configured OSS media directory');
  const mixed = fixtureFetcher({ EffectPlayer: { effectData: { 2: effect(2, {
    icon: '../outside.png', tailPath: 'https://untrusted.invalid/tail.mp4', audioPath: '../outside.m4a',
  }) } } });
  const cleaned = await createPreviewMediaLoader(mixed.fetcher, BASE)(card('effect', '2'));
  assert.equal(cleaned.item.standPath, '2_h264.mp4');
  assert.ok(!cleaned.item.icon && !cleaned.item.tailPath && !cleaned.item.audioPath);
  assert.equal(cleaned.item.hasAudio, false, 'Rejected audio path must disable audio');

  const badSongs = fixtureFetcher({ BgmPlayer: { data: [
    song(1, { song_id: -1 }), song(2, { song_id: 1.5 }), song(3, { song_id: Number.MAX_SAFE_INTEGER + 1 }),
    song(4, { song_id: 'https://untrusted.invalid/' }),
  ] } });
  const loadBadSongs = createPreviewMediaLoader(badSongs.fetcher, BASE);
  for (const id of [1, 2, 3, 4]) assert.equal(await loadBadSongs(card('bgm', id)), null, 'Only positive safe integer song IDs produce embeds');

  for (const failure of ['http', 'network', 'json']) {
    let attempts = 0;
    const retryFetcher = async () => {
      attempts++;
      if (attempts === 1) {
        if (failure === 'network') throw new Error('Fixture network error');
        if (failure === 'json') return { ok: true, json: async () => { throw new SyntaxError('Fixture malformed JSON'); } };
        return response({}, false);
      }
      return response({ effectData: { 2: effect(2) } });
    };
    const retry = createPreviewMediaLoader(retryFetcher, BASE);
    const failed = await Promise.allSettled([retry(card('effect', '2')), retry(card('effect', '2'))]);
    assert.ok(failed.every(result => result.status === 'rejected'), `${failure} errors must reach the preview retry UI`);
    assert.equal(attempts, 1, 'Concurrent failures share one request');
    assert.equal((await retry(card('effect', '2'))).kind, 'effect');
    assert.equal(attempts, 2, 'A failed metadata promise must not permanently poison the cache');
  }
  console.log('AI search media preview tests passed (local fixtures only).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
