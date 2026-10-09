const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertSuggestedUsesPreserved } = require('./export-ai-asset-features.cjs');

const ROOT = path.resolve(__dirname, '..');
const EXPORTS = path.join(ROOT, 'exports');
const LOCALES = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru'];
const PROJECTS = {
  sound: { project: 'SoundEffectPlayer', namespace: 'soundEffectPlayer', parts: ['audio'] },
  bgm: { project: 'BgmPlayer', namespace: 'bgmPlayer', parts: ['audio'] },
  effect: { project: 'EffectPlayer', namespace: 'effectPlayer', parts: ['standVisual', 'tailVisual', 'audio'] },
};
const json = value => JSON.stringify(value, null, 2) + '\n';

function draft(kind = 'sound', ids = ['1'], uses = 2) {
  const { project, namespace, parts } = PROJECTS[kind];
  const result = { schemaVersion: 1, project, kind, resources: {}, i18n: Object.fromEntries(LOCALES.map(locale => [locale, {}])) };
  for (const id of ids) {
    const metadata = { schemaVersion: 1 };
    for (const part of parts) {
      const refs = Array.from({ length: uses }, (_, index) => `${namespace}.search.${id}.${part}.suggested_uses.${index}`);
      metadata[part] = { sourceSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), suggestedUsesI18nKeys: refs };
      for (const locale of LOCALES) for (const [index, key] of refs.entries()) result.i18n[locale][key] = `${locale} ${part} use ${index}`;
    }
    result.resources[id] = { searchMetadata: metadata };
  }
  return result;
}

function snapshot(kind, ids = ['1']) {
  const rows = ids.map(id => ({ id }));
  return { project: PROJECTS[kind].project, kind, data: kind === 'effect' ? { effectData: Object.fromEntries(rows.map(row => [row.id, row])) } : { data: rows } };
}

async function write(filename, contents) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, contents);
}

async function published(output, previous, transformDictionary = value => value) {
  const sidecar = structuredClone(previous);
  delete sidecar.i18n;
  sidecar.i18nSource = 'project-i18n-v1';
  await write(path.join(output, previous.project, 'features.json'), json(sidecar));
  for (const locale of LOCALES) await write(path.join(output, previous.project, 'i18n', locale + '.json'), json(transformDictionary(previous.i18n[locale], locale)));
}

async function tree(directory) {
  const result = [];
  async function visit(current, relative = '') {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(current, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'Test fixtures must not contain symbolic links');
      if (entry.isDirectory()) {
        result.push([name, 'directory']);
        await visit(filename, name);
      } else {
        assert.ok(entry.isFile(), `Unexpected fixture entry: ${name}`);
        result.push([name, 'file', await fs.readFile(filename)]);
      }
    }
  }
  await visit(directory);
  return result;
}

async function withFixture(run) {
  await fs.mkdir(EXPORTS, { recursive: true });
  const directory = await fs.mkdtemp(path.join(EXPORTS, '.export-suggestion-guard-test-'));
  const fixture = { directory, output: path.join(directory, 'publication') };
  try { return await run(fixture); }
  finally {
    const absolute = path.resolve(directory), relative = path.relative(path.resolve(EXPORTS), absolute);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Test cleanup must remain inside exports');
    assert.ok(path.basename(absolute).startsWith('.export-suggestion-guard-test-'), 'Only this test fixture may be removed');
    await fs.rm(absolute, { recursive: true, force: true });
  }
}

async function checkGuard(fixture, drafts, snapshots, rejected = false) {
  assert.equal(typeof assertSuggestedUsesPreserved, 'function');
  const before = await tree(fixture.directory), originalDrafts = structuredClone(drafts), originalSnapshots = structuredClone(snapshots);
  let failure;
  try { await assertSuggestedUsesPreserved(fixture.output, drafts, snapshots); }
  catch (error) { failure = error; }
  assert.deepEqual(await tree(fixture.directory), before, 'Guard must not change any fixture file bytes or tree entries');
  assert.deepEqual(drafts, originalDrafts, 'Guard must not mutate candidate drafts');
  assert.deepEqual(snapshots, originalSnapshots, 'Guard must not mutate base snapshots');
  if (rejected instanceof RegExp) {
    assert.ok(failure instanceof Error, 'Expected invalid base data to be rejected');
    assert.match(failure.message, rejected);
  } else if (rejected) {
    assert.ok(failure, 'Expected suggested uses loss to be rejected');
    assert.equal(failure.code, 'ASSET_SUGGESTED_USES_LOSS');
    assert.match(failure.message, /Suggested uses preservation failed/);
  } else if (failure) throw failure;
}

test('first publication and previously empty suggestions are permitted without writes', async t => {
  for (const kind of Object.keys(PROJECTS)) {
    await t.test(`${kind}: no features file`, () => withFixture(async fixture => {
      await checkGuard(fixture, [draft(kind, ['1'], 0)], [snapshot(kind)]);
    }));
    await t.test(`${kind}: previous suggestion arrays are empty`, () => withFixture(async fixture => {
      const previous = draft(kind, ['1'], 0);
      await published(fixture.output, previous);
      const next = draft(kind); next.resources = {};
      await checkGuard(fixture, [next], [snapshot(kind)]);
    }));
  }
});

test('same source cannot lose a protected media part, resource, metadata, or suggestion array', async t => {
  const losses = {
    'empty suggestion array': (next, part) => { next.resources[1].searchMetadata[part].suggestedUsesI18nKeys = []; },
    'missing suggestion array': (next, part) => { delete next.resources[1].searchMetadata[part].suggestedUsesI18nKeys; },
    'missing media part': (next, part) => { delete next.resources[1].searchMetadata[part]; },
    'missing search metadata': next => { delete next.resources[1].searchMetadata; },
    'missing resource': next => { delete next.resources[1]; },
  };
  for (const [kind, { parts }] of Object.entries(PROJECTS)) for (const part of parts) for (const [name, lose] of Object.entries(losses)) {
    await t.test(`${kind}/${part}: ${name}`, () => withFixture(async fixture => {
      const previous = draft(kind), next = structuredClone(previous);
      await published(fixture.output, previous); lose(next, part);
      await checkGuard(fixture, [next], [snapshot(kind)], true);
    }));
  }
});

test('every candidate reference must resolve to nonblank text in every locale', async t => {
  const corruptions = {
    empty: (table, key) => { table[key] = ''; },
    whitespace: (table, key) => { table[key] = ' \t\r\n '; },
    missing: (table, key) => { delete table[key]; },
  };
  for (const [kind, { parts }] of Object.entries(PROJECTS)) for (const part of parts) for (const locale of LOCALES) for (const [name, corrupt] of Object.entries(corruptions)) {
    await t.test(`${kind}/${part}/${locale}: one ${name} reference with another valid reference`, () => withFixture(async fixture => {
      const previous = draft(kind), next = structuredClone(previous);
      await published(fixture.output, previous);
      corrupt(next.i18n[locale], next.resources[1].searchMetadata[part].suggestedUsesI18nKeys[1]);
      await checkGuard(fixture, [next], [snapshot(kind)], true);
    }));
  }
  for (const locale of LOCALES) await t.test(`missing candidate locale ${locale}`, () => withFixture(async fixture => {
    const previous = draft(), next = structuredClone(previous);
    await published(fixture.output, previous); delete next.i18n[locale];
    await checkGuard(fixture, [next], [snapshot('sound')], true);
  }));
  await t.test('one invalid key with another valid reference', () => withFixture(async fixture => {
    const previous = draft(), next = structuredClone(previous);
    await published(fixture.output, previous); next.resources[1].searchMetadata.audio.suggestedUsesI18nKeys[1] = null;
    await checkGuard(fixture, [next], [snapshot('sound')], true);
  }));
});

test('only two complete, valid, independently changed media hashes permit empty new-source suggestions', async t => {
  const cases = [
    ['both hashes match', {}, {}, true],
    ['only source hash changes', {}, { sourceSha256: 'c'.repeat(64) }, true],
    ['only input hash changes', {}, { inputSha256: 'd'.repeat(64) }, true],
    ['case differences still match', { sourceSha256: 'A'.repeat(64), inputSha256: 'B'.repeat(64) }, {}, true],
    ['both complete hashes change', {}, { sourceSha256: 'c'.repeat(64), inputSha256: 'd'.repeat(64) }, false],
  ];
  for (const owner of ['old', 'candidate']) for (const field of ['sourceSha256', 'inputSha256']) for (const [label, value] of [['missing', undefined], ['empty', ''], ['invalid', 'not-a-sha256']]) {
    const changed = { sourceSha256: 'c'.repeat(64), inputSha256: 'd'.repeat(64) };
    cases.push([`${owner} ${field} ${label}`, owner === 'old' ? { [field]: value } : {}, owner === 'candidate' ? { ...changed, [field]: value } : changed, true]);
  }
  for (const [kind, { parts }] of Object.entries(PROJECTS)) for (const part of parts) for (const [name, oldHashes, candidateHashes, rejected] of cases) {
    await t.test(`${kind}/${part}: ${name}`, () => withFixture(async fixture => {
      const previous = draft(kind), next = structuredClone(previous);
      Object.assign(previous.resources[1].searchMetadata[part], oldHashes);
      Object.assign(next.resources[1].searchMetadata[part], candidateHashes);
      next.resources[1].searchMetadata[part].suggestedUsesI18nKeys = [];
      await published(fixture.output, previous);
      await checkGuard(fixture, [next], [snapshot(kind)], rejected);
    }));
  }
});

test('legal deletions, nonempty rewrites, and shortened suggestion lists remain permitted', async t => {
  for (const kind of Object.keys(PROJECTS)) {
    await t.test(`${kind}: deleted base ID is skipped`, () => withFixture(async fixture => {
      await published(fixture.output, draft(kind));
      await checkGuard(fixture, [draft(kind, ['2'], 0)], [snapshot(kind, ['2'])]);
    }));
    await t.test(`${kind}: unchanged suggestions`, () => withFixture(async fixture => {
      const previous = draft(kind); await published(fixture.output, previous);
      await checkGuard(fixture, [structuredClone(previous)], [snapshot(kind)]);
    }));
    await t.test(`${kind}: nonempty rewrite and shortened list`, () => withFixture(async fixture => {
      const previous = draft(kind), next = structuredClone(previous);
      for (const part of PROJECTS[kind].parts) {
        const metadata = next.resources[1].searchMetadata[part], removed = metadata.suggestedUsesI18nKeys.pop();
        for (const locale of LOCALES) { delete next.i18n[locale][removed]; next.i18n[locale][metadata.suggestedUsesI18nKeys[0]] = `${locale} rewritten use`; }
      }
      await published(fixture.output, previous);
      await checkGuard(fixture, [next], [snapshot(kind)]);
    }));
  }
});

test('invalid base data and IDs cannot bypass protection as resource deletions', async t => {
  const cases = [
    ['bgm', 'musicData is not an array', { musicData: {} }, 'data'],
    ['bgm', 'duplicate legacy IDs', { musicData: [{ id: '1' }, { id: 1 }] }, 'IDs'],
    ['bgm', 'invalid legacy ID', { musicData: [{ id: 'invalid' }] }, 'IDs'],
    ['sound', 'data is not an array', { data: { 1: { id: '1' } } }, 'data'],
    ['effect', 'effectData is an array', { effectData: [] }, 'data'],
    ['effect', 'effectData is a primitive', { effectData: 'invalid' }, 'data'],
    ['effect', 'effectData is missing', {}, 'data'],
    ['sound', 'duplicate normalized IDs', { data: [{ id: '1' }, { id: 1 }] }, 'IDs'],
    ['effect', 'duplicate normalized IDs', { effectData: { first: { id: '1' }, second: { id: 1 } } }, 'IDs'],
    ['sound', 'invalid ID', { data: [{ id: 'invalid' }] }, 'IDs'],
    ['effect', 'missing ID', { effectData: { 1: {} } }, 'IDs'],
  ];
  for (const [kind, name, data, category] of cases) for (const hasOutput of [false, true]) {
    await t.test(`${kind}: ${name}, ${hasOutput ? 'existing' : 'missing'} output features`, () => withFixture(async fixture => {
      const previous = draft(kind), next = structuredClone(previous);
      if (hasOutput) await published(fixture.output, previous);
      next.resources = {};
      const invalidSnapshot = { project: previous.project, kind, data: structuredClone(data) };
      await checkGuard(fixture, [next], [invalidSnapshot], new RegExp(`^${previous.project}: invalid base ${category}\\b`));
    }));
  }
});

test('legacy BGM musicData preserves suggestions and rejects loss before any writes', () => withFixture(async fixture => {
  const previous = draft('bgm'), next = structuredClone(previous), base = snapshot('bgm');
  base.data.musicData = base.data.data; delete base.data.data;
  await published(fixture.output, previous);
  await checkGuard(fixture, [next], [base]);
  next.resources[1].searchMetadata.audio.suggestedUsesI18nKeys = [];
  await checkGuard(fixture, [next], [base], true);
}));

test('namespace-short and nested published dictionaries resolve canonical references', () => withFixture(async fixture => {
  const previous = draft('effect'), next = structuredClone(previous), namespace = PROJECTS.effect.namespace;
  await published(fixture.output, previous, table => ({ translations: Object.fromEntries(Object.entries(table).map(([key, value]) => [key.slice(namespace.length + 1), value])), revision: 'base' }));
  for (const locale of LOCALES) next.i18n[locale] = { translations: Object.fromEntries(Object.entries(next.i18n[locale]).map(([key, value]) => [key.slice(namespace.length + 1), value])) };
  await checkGuard(fixture, [next], [snapshot('effect')]);
}));

test('unresolved published suggestions fail read-only instead of masking an invalid baseline', async t => {
  for (const locale of LOCALES) {
    await t.test(`missing old reference in ${locale}`, () => withFixture(async fixture => {
      const previous = draft(), next = structuredClone(previous), key = previous.resources[1].searchMetadata.audio.suggestedUsesI18nKeys[0];
      delete previous.i18n[locale][key]; await published(fixture.output, previous);
      await checkGuard(fixture, [next], [snapshot('sound')], true);
    }));
    await t.test(`missing old dictionary ${locale}`, () => withFixture(async fixture => {
      const previous = draft(); await published(fixture.output, previous);
      await fs.unlink(path.join(fixture.output, previous.project, 'i18n', locale + '.json'));
      await checkGuard(fixture, [structuredClone(previous)], [snapshot('sound')], true);
    }));
  }
});

async function cliFixture(fixture, kindWithLoss, sameSource) {
  const source = path.join(fixture.directory, 'source');
  if (sameSource) fixture.output = source;
  const baselines = path.join(fixture.directory, 'baselines');
  for (const kind of ['sound', 'effect', 'bgm']) {
    const config = PROJECTS[kind] || { project: 'BgmPlayer', namespace: 'bgmPlayer' };
    const row = { id: '1', nameI18nKey: `${config.namespace}.data.1`, duration: 1, path: 'original/media.mp3', hasAudio: true, audioPath: '1.mp3' };
    const originalData = kind === 'effect' ? { effectData: { 1: row }, TagData: {}, category: [] } : { data: [row], category: [] };
    const currentData = structuredClone(originalData), previous = draft(kind);
    if (previous) {
      const nextMetadata = structuredClone(previous.resources[1].searchMetadata);
      if (kind === kindWithLoss) nextMetadata.audio.suggestedUsesI18nKeys = [];
      (kind === 'effect' ? currentData.effectData[1] : currentData.data[0]).searchMetadata = nextMetadata;
      // Deliberately minimal features cannot reach the compiler successfully;
      // the guard must reject before the compiler or any writer is reached.
      await published(fixture.output, previous);
      if (kind !== 'bgm') await write(path.join(baselines, config.project, 'data.json'), '\r\n' + JSON.stringify(originalData, null, 3) + '\r\n');
    }
    await write(path.join(source, config.project, 'data.json'), json(currentData));
    for (const locale of LOCALES) {
      const ordinary = { [`${config.namespace}.data.1`]: `${locale} original title` };
      await write(path.join(source, config.project, 'i18n', locale + '.json'), json({ ...ordinary, ...previous?.i18n[locale] }));
      if (kind !== 'bgm') await write(path.join(baselines, config.project, kind === 'sound' ? '' : 'i18n', locale + '.json'), JSON.stringify(ordinary, null, 4) + '\r\n');
    }
    if (!sameSource && previous) await write(path.join(fixture.output, config.project, 'data.json'), 'existing target data sentinel\r\n');
  }
  const identities = path.join(fixture.directory, 'identities.json'), manifest = path.join(fixture.directory, 'manifest.json');
  await write(identities, 'existing identities sentinel\r\n');
  await write(manifest, 'existing manifest sentinel\r\n');
  await write(path.join(fixture.directory, 'backups', 'existing', 'sentinel.bin'), Buffer.from([0, 1, 2, 255]));
  await write(path.join(fixture.directory, 'auxiliary', 'BgmPlayer', 'sentinel.bin'), Buffer.from([254, 253, 0]));
  return [path.join(ROOT, 'scripts', 'export-ai-asset-features.cjs'), '--source', source, '--output', fixture.output,
    '--backups', path.join(fixture.directory, 'backups'), '--bgm-source-output', path.join(fixture.directory, 'auxiliary'),
    '--sound-baseline', path.join(baselines, 'SoundEffectPlayer'), '--effect-baseline', path.join(baselines, 'EffectPlayer'), '--identities', identities, '--manifest', manifest];
}

test('CLI rejects suggestion loss before all backup, identities, manifest, auxiliary, and target writes', async t => {
  for (const kind of Object.keys(PROJECTS)) for (const sameSource of [false, true]) {
    await t.test(`${kind}: ${sameSource ? 'source equals output with stale empty inline suggestions' : 'independent source and output'}`, () => withFixture(async fixture => {
      const args = await cliFixture(fixture, kind, sameSource), before = await tree(fixture.directory);
      const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 15000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /Suggested uses preservation failed/);
      assert.match(result.stderr, new RegExp(`${PROJECTS[kind].project}/1/audio`));
      assert.equal(result.stdout, '', 'Failed export must not emit a success manifest');
      assert.deepEqual(await tree(fixture.directory), before, 'Failed CLI export must preserve every file byte and the complete fixture tree');
    }));
  }
});
