/* Synthetic Vue lifecycle and fake clocks only. No network, paid models, or files generated. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRenderer, nextTick } = require('vue');
const { createI18n } = require('vue-i18n');
const agentModule = require('../src/views/AISearch/agentSearchService.ts');
const originalAgentSearch = agentModule.requestAgentSearch;
const { useAISearch, restoreConversations } = require('../src/views/AISearch/useAISearch.ts');
const { serializeAISearchArchive } = require('../src/views/AISearch/archiveStorage.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const originals = { fetch: global.fetch, localStorage: global.localStorage, sessionStorage: global.sessionStorage,
  now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
const timers = new Map(); let now = 1800000000000, timerId = 0;
global.setTimeout = (callback, delay = 0, ...args) => { const id = ++timerId; timers.set(id, { at: now + delay, callback, args }); return id; };
global.clearTimeout = id => timers.delete(id);
Date.now = () => now;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const calls = [];
agentModule.requestAgentSearch = (_payload, options) => {
  const gate = deferred(), aborted = () => gate.reject(options.signal.reason);
  calls.push({ gate, options });
  options.signal.addEventListener('abort', aborted, { once: true });
  return gate.promise.finally(() => options.signal.removeEventListener('abort', aborted));
};
global.fetch = async url => {
  if (String(url).includes('/AISearch/index.json')) return Response.json({ data: 'fixture-version' });
  if (String(url).endsWith('/config')) return Response.json({ configured: true, available: true, model: 'fixture',
    retrieval: { available: true, total: 1, mode: 'keyword', catalogVersion: 'fixture' }, agent: { available: true } });
  if (String(url).endsWith('/catalog')) return Response.json({ total: 1, mode: 'keyword', catalogVersion: 'fixture' });
  throw new Error(`Unexpected real request in progress lifecycle fixture: ${url}`);
};
class MemoryStorage {
  constructor() { this.files = new Map(); this.writes = 0; }
  setProject() { return this; }
  async exists(path) { return this.files.has(path); }
  async mkdir() {}
  async readFile(path) { return this.files.get(path); }
  async writeFile(path, source) { this.writes++; this.files.set(path, source); }
}
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
  insert: (node, parent) => { parent.children.push(node); }, remove() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
async function flush() { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick(); }
async function waitUntil(test) { for (let index = 0; index < 100; index++) { await flush(); if (test()) return; } throw new Error('Progress fixture did not settle'); }
async function advance(milliseconds) {
  const target = now + milliseconds;
  for (;;) {
    const first = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!first) break;
    now = first[1].at; timers.delete(first[0]); first[1].callback(...first[1].args); await flush();
  }
  now = target; await flush();
}
const final = { answer: 'Validated final answer.', matches: [], sections: [{ answer: 'Validated grouped explanation.', resourceIds: [] }] };
let mounted;
async function mountSearch() {
  let state; const storage = new MemoryStorage();
  const app = renderer.createApp({ setup() { state = useAISearch(); return () => null; } });
  app.provide('storage', storage);
  const messages = JSON.parse(fs.readFileSync(require.resolve('../src/i18n/locales/aiSearch/en-us.json'), 'utf8'));
  app.use(createI18n({ legacy: false, flatJson: true, locale: 'en-US', messages: { 'en-US': messages } }));
  app.mount({ children: [] }); mounted = app;
  await waitUntil(() => !state.loadingArchive.value && !state.loadingCatalog.value && state.freeStatus.value !== 'checking');
  state.mode.value = 'custom';
  state.modelConfig.value = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKey: 'fixture-key-only', rememberKey: false };
  await flush();
  return { state, storage, unmount() { if (mounted === app) { mounted = undefined; app.unmount(); } } };
}
(async () => {
  const fixture = await mountSearch(), { state, storage } = fixture;
  const firstRun = state.send('fixture search'); await waitUntil(() => calls.length === 1);
  const first = calls[0], reply = state.messages.value.at(-1);
  assert.equal(reply.progress.phase, 'waiting');
  await flush(); const savedWrites = storage.writes;
  const preview = 'A partial streamed answer that has not passed validation.';
  first.options.onProgress({ phase: 'generating', round: 3, receivedCharacters: 64, answerPreview: preview });
  await flush();
  assert.equal(reply.progress.answerPreview, preview);
  assert.equal(reply.content, '', 'A stream preview never becomes a final answer before validation');
  assert.deepEqual(reply.cards, []); assert.equal(reply.sections, undefined);
  await advance(2100);
  assert.equal(reply.progress.elapsedMs, 2000, 'Elapsed progress updates even while no new network chunk arrives');
  assert.equal(storage.writes, savedWrites, 'Streaming chunks and elapsed time must not enqueue archive writes');
  assert.ok(!storage.files.get('/archive.json').includes(preview));
  const archive = serializeAISearchArchive({ conversations: state.conversations.value, activeConversationId: state.activeConversationId.value, selectedMode: state.mode.value });
  assert.ok(!archive.includes('progress') && !archive.includes(preview), 'Archives exclude previews regardless of the storage watcher');
  const restored = restoreConversations([{ id: 'injected', messages: [{ ...reply, progress: { answerPreview: preview } }] }]);
  assert.equal(restored[0].messages[0].progress, undefined, 'Restoration ignores injected progress fields');
  first.options.onProgress({ phase: 'generating', round: 3, receivedCharacters: 90 });
  assert.equal(reply.progress.answerPreview, undefined, 'A safely filtered preview must clear the previous fragment');
  first.options.onProgress({ phase: 'searching', round: 2 });
  assert.equal(reply.progress.answerPreview, undefined, 'Tool execution never carries an old answer fragment');
  state.stop(); const canceled = JSON.stringify(reply);
  assert.equal(reply.progress, undefined); assert.equal(reply.status, 'canceled');
  first.options.onProgress({ phase: 'generating', round: 3, answerPreview: 'late invalid fragment' });
  assert.equal(JSON.stringify(reply), canceled, 'Canceled requests cannot mutate the reply with late progress');
  await firstRun;
  assert.equal(timers.size, 0, 'Stopping disposes both the search deadline and progress clock');
  const secondRun = state.send('second fixture'); await waitUntil(() => calls.length === 2);
  const secondReply = state.messages.value.at(-1);
  first.options.onProgress({ phase: 'generating', round: 3, answerPreview: 'older run fragment' });
  assert.equal(secondReply.progress.answerPreview, undefined, 'A previous run cannot mutate the new reply');
  first.gate.resolve(final); await firstRun;
  calls[1].options.onProgress({ phase: 'generating', round: 3, receivedCharacters: 120, answerPreview: preview });
  calls[1].gate.resolve(final); await secondRun; await flush();
  assert.equal(secondReply.status, 'complete'); assert.equal(secondReply.progress, undefined);
  assert.equal(secondReply.content, final.answer); assert.deepEqual(secondReply.sections, final.sections, 'Existing final section rendering remains intact');
  assert.equal(timers.size, 0, 'Completing disposes the progress clock');
  const errorRun = state.send('error fixture'); await waitUntil(() => calls.length === 3);
  const errorReply = state.messages.value.at(-1);
  calls[2].options.onProgress({ phase: 'generating', round: 1, answerPreview: preview });
  calls[2].gate.reject(new Error('Fixture rejection')); await errorRun;
  assert.equal(errorReply.status, 'error'); assert.equal(errorReply.progress, undefined);
  assert.ok(!errorReply.content.includes(preview)); assert.equal(timers.size, 0);
  const leaveRun = state.send('unmount fixture'); await waitUntil(() => calls.length === 4);
  const leavingReply = state.messages.value.at(-1); fixture.unmount();
  await leaveRun;
  assert.equal(leavingReply.progress, undefined); assert.equal(timers.size, 0, 'Unmount disposes all progress timers');
  calls[3].options.onProgress({ phase: 'generating', round: 1, answerPreview: preview });
  assert.equal(leavingReply.progress, undefined);
  calls[3].gate.resolve(final); await leaveRun;
  for (const locale of ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru']) {
    const localized = JSON.parse(fs.readFileSync(require.resolve(`../src/i18n/locales/aiSearch/${locale}.json`), 'utf8'));
    for (const key of ['waiting', 'thinking', 'generating', 'searching', 'loading_details', 'round', 'elapsed', 'received']) {
      assert.equal(typeof localized[`aiSearch.progress.${key}`], 'string', `${locale} has a progress label for ${key}`);
    }
  }
  console.log('PASS AI search progress: ephemeral previews, archive isolation, ticking elapsed time, final sections, canceled and stale events, errors, unmount cleanup, and five locales');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  mounted?.unmount(); agentModule.requestAgentSearch = originalAgentSearch;
  global.fetch = originals.fetch; global.localStorage = originals.localStorage; global.sessionStorage = originals.sessionStorage;
  Date.now = originals.now; global.setTimeout = originals.setTimeout; global.clearTimeout = originals.clearTimeout;
});
