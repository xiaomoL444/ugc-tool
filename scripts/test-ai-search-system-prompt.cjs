/* Mock-only system prompt integration. No asset host, AI, or balance requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
global.fetch = async () => { throw new Error('Unexpected network request in prompt tests'); };
const { loadSystemPrompt, buildSystemPrompt } = require('../src/views/AISearch/systemPrompt.ts');
const { buildSearchPayload, requestSearch } = require('../src/views/AISearch/aiSearchService.ts');
const { buildAgentSearchPayload, requestAgentSearch } = require('../src/views/AISearch/agentSearchService.ts');
const source = '# Independent fixture\nCustom rule from the file. CURRENT query selects the object. Return up to RESULT\\_LIMIT resources. Values: \\[sample\\].\n';
const plainSource = '# Unescaped fixture\nReturn up to RESULT_LIMIT resources.\n';
const promptResponse = (body = source) => new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
const isPrompt = url => String(url).split('?')[0].endsWith('/AISearch/SystemPrompt.md');
const answer = { answer: '找到', matches: [] };
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const modelFinal = matches => json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...answer, matches: matches ?? [] }) } }] });
const toolCall = (name, args, id) => json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const config = { baseUrl: 'https://model.invalid/v1', model: 'fixture-model', apiKey: 'fixture-model-key', rememberKey: false };
const options = (fetcher, signal = new AbortController().signal) => ({ mode: 'custom', config, freeBase: '/api/ai-search', signal, fetcher });
const legacyPayload = count => buildSearchPayload('音效', 'zh-CN', 'all', [], [], `legacy-${count}`, count);
const agentPayload = count => buildAgentSearchPayload('音效', 'zh-CN', 'all', [], true, `agent-${count}`, count);
const unavailable = error => error.code === 'PROMPT_UNAVAILABLE';

(async () => {
  let reads = 0;
  const cacheFetch = async (url, init) => {
    reads++;
    assert.equal(String(url).split('?')[0], 'https://fixture.invalid/ugc-tool-data/AISearch/SystemPrompt.md');
    assert.equal(init.headers?.Authorization, undefined, 'The model key is never sent to asset storage');
    assert.equal(init.credentials, 'omit');
    return promptResponse();
  };
  const signal = new AbortController().signal;
  const first = await loadSystemPrompt(signal, cacheFetch, 'https://fixture.invalid/ugc-tool-data/');
  assert.ok(first.includes('Independent fixture'));
  await loadSystemPrompt(signal, cacheFetch, 'https://fixture.invalid/ugc-tool-data');
  assert.equal(reads, 1, 'One successful file read is reused during the cache window');
  const clock = Date.now;
  try {
    Date.now = () => clock() + 60001;
    await loadSystemPrompt(signal, cacheFetch, 'https://fixture.invalid/ugc-tool-data');
    assert.equal(reads, 2, 'An expired file is refreshed rather than permanently pinning its first version');
  } finally { Date.now = clock; }
  for (const workflow of ['agent', 'candidates']) for (const count of [5, 10, 20]) {
    const built = buildSystemPrompt(first, workflow, count);
    assert.ok(built.includes(`up to ${count} resources`));
    assert.ok(built.includes('[sample]'), 'Markdown bracket escapes are normalized');
    assert.ok(!built.includes('RESULT_LIMIT') && !built.includes('RESULT\\_LIMIT'));
    assert.ok(buildSystemPrompt(plainSource, workflow, count).includes(`up to ${count} resources`));
  }

  let releaseOld, raceReads = 0;
  const oldRead = new Promise(resolve => { releaseOld = resolve; });
  const raceFetch = async () => ++raceReads === 1 ? oldRead : promptResponse('# New prompt version\nUpdated rule.');
  const firstRace = loadSystemPrompt(signal, raceFetch, 'https://fixture.invalid/race');
  const secondRace = await loadSystemPrompt(signal, raceFetch, 'https://fixture.invalid/race');
  releaseOld(promptResponse('# Old prompt version\nOld rule.'));
  await firstRace;
  const cachedRace = await loadSystemPrompt(signal, raceFetch, 'https://fixture.invalid/race');
  assert.equal(cachedRace, secondRace, 'An older slow request cannot replace a newer successful cached prompt');
  assert.equal(raceReads, 2);
  const literalHtml = '# Valid Markdown\nDo not produce <html> or HTML players. Return RESULT_LIMIT assets.';
  assert.ok((await loadSystemPrompt(signal, async () => promptResponse(literalHtml), 'https://fixture.invalid/literal')).includes('<html>'), 'A legitimate Markdown instruction may mention literal HTML without being rejected as a page');


  // R2 uploads can lack Content-Type metadata; generic files are decoded and
  // checked as text instead of being rejected solely by their response MIME.
  for (const mime of ['', 'application/octet-stream']) {
    const headers = mime ? { 'Content-Type': mime } : {};
    let genericReads = 0;
    const genericFetch = async () => { genericReads++; return new Response(new TextEncoder().encode(source), { headers }); };
    const base = 'https://fixture.invalid/generic-' + (mime ? 'download' : 'missing');
    const loaded = await loadSystemPrompt(signal, genericFetch, base);
    assert.ok(loaded.includes('Custom rule from the file'), 'Valid UTF-8 Markdown loads with missing/generic MIME');
    assert.equal(await loadSystemPrompt(signal, genericFetch, base), loaded);
    assert.equal(genericReads, 1, 'A successfully validated generic source retains the normal cache');
    for (const [label, bytes] of [
      ['empty', new TextEncoder().encode(' \n ')],
      ['HTML', new TextEncoder().encode('<!doctype html><html>Gateway error</html>')],
      ['control bytes', new Uint8Array([65, 0, 66])],
      ['oversized', new TextEncoder().encode('中'.repeat(6000))],
      ['invalid UTF-8', new Uint8Array([0xc3, 0x28])],
    ]) {
      const invalidFetch = async () => new Response(bytes, { headers });
      await assert.rejects(() => loadSystemPrompt(signal, invalidFetch, base + '/invalid'), unavailable, label);
    }
  }
  let legacyReads = 0, legacyModels = 0;
  const legacyFetch = async (url, init) => {
    if (isPrompt(url)) { legacyReads++; return promptResponse(); }
    legacyModels++;
    const sent = JSON.parse(init.body);
    assert.equal(sent.messages[0].role, 'system');
    assert.ok(sent.messages[0].content.includes('Custom rule from the file'));
    assert.ok(sent.messages[0].content.includes('up to 20 resources'));
    assert.equal(init.headers.Authorization, 'Bearer fixture-model-key');
    return modelFinal();
  };
  await requestSearch(legacyPayload(20), [], options(legacyFetch));
  await requestSearch(legacyPayload(20), [], options(legacyFetch));
  assert.equal(legacyReads, 1, 'Legacy custom search uses the same successful file cache');
  assert.equal(legacyModels, 2);

  const asset = { resourceId: 'sound:11', kind: 'sound', title: '短促音效', description: '短促音效', keywords: ['短促'] };
  let agentReads = 0, agentModels = 0;
  const systems = [];
  const agentFetch = async (url, init) => {
    if (isPrompt(url)) { agentReads++; return promptResponse(); }
    if (String(url).endsWith('/chat/completions')) {
      agentModels++;
      const sent = JSON.parse(init.body);
      systems.push(sent.messages[0].content);
      assert.ok(systems.at(-1).includes('Custom rule from the file'));
      assert.ok(systems.at(-1).includes('up to 10 resources'));
      if (agentModels === 1) return toolCall('search_assets', { query: '短促', scope: 'sound' }, 'fixture-search');
      if (agentModels === 2) return toolCall('get_assets', { ids: [asset.resourceId] }, 'fixture-details');
      return modelFinal([{ resourceId: asset.resourceId, reason: '短促描述', matchType: 'feature' }]);
    }
    if (String(url).endsWith('/search')) return json({ catalogVersion: 'prompt-v1', mode: 'keyword', total: 1, items: [asset], hasMore: false });
    if (String(url).endsWith('/assets')) return json({ catalogVersion: 'prompt-v1', items: [asset], missingIds: [] });
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const agentReply = await requestAgentSearch(agentPayload(10), options(agentFetch));
  assert.equal(agentReply.matches[0].resourceId, asset.resourceId);
  assert.equal(agentModels, 3);
  assert.equal(agentReads, 1, 'One agent turn reads the file once for all tool/model rounds');
  assert.equal(new Set(systems).size, 1, 'Tool rounds retain the prompt snapshot used at the start of the turn');

  const failures = [
    ['missing', () => new Response('Not found', { status: 404 })],
    ['empty', () => promptResponse(' \n ')],
    ['HTML body', () => promptResponse('<!doctype html><html><body>Asset not found</body></html>')],
    ['HTML type', () => new Response('Apparently a prompt', { headers: { 'Content-Type': 'text/html' } })],
    ['nontext type', () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })],
    ['redirected', () => { const response = promptResponse(); Object.defineProperty(response, 'redirected', { value: true }); return response; }],
    ['oversized', () => promptResponse('中'.repeat(6000))],
    ['invalid UTF-8', () => promptResponse(new Uint8Array([0xc3, 0x28]))],
  ];
  for (const [label, response] of failures) for (const workflow of ['agent', 'candidates']) {
    let promptReads = 0, modelCalls = 0;
    const fetcher = async url => { if (isPrompt(url)) { promptReads++; return response(); } modelCalls++; return modelFinal(); };
    const run = () => workflow === 'agent' ? requestAgentSearch(agentPayload(10), options(fetcher)) : requestSearch(legacyPayload(10), [], options(fetcher));
    await assert.rejects(run, unavailable, `${workflow}: ${label} is explained as prompt unavailable`);
    await assert.rejects(run, unavailable, `${workflow}: failed prompt reads are retried rather than cached`);
    assert.equal(promptReads, 2);
    assert.equal(modelCalls, 0, 'An unreadable external prompt cannot trigger a paid model request');
  }

  let timedOut = false;
  const stalled = async (url, init) => new Response(new ReadableStream({
    start(controller) { init.signal.addEventListener('abort', () => { timedOut = true; controller.error(new DOMException('Aborted', 'AbortError')); }, { once: true }); },
  }), { headers: { 'Content-Type': 'text/markdown' } });
  const started = Date.now();
  await assert.rejects(() => loadSystemPrompt(new AbortController().signal, stalled, 'https://fixture.invalid/stalled'), unavailable);
  assert.equal(timedOut, true, 'A stalled body is cancelled after the timeout');
  assert.ok(Date.now() - started >= 4500 && Date.now() - started < 7500, 'The complete request including its body has a five-second bound');

  for (const workflow of ['agent', 'candidates']) {
    const controller = new AbortController();
    let promptStarted, startedRequest = new Promise(resolve => { promptStarted = resolve; }), modelCalls = 0, requestAborted = false;
    const fetcher = async (url, init) => {
      if (!isPrompt(url)) { modelCalls++; return modelFinal(); }
      promptStarted();
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { requestAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true }));
    };
    const run = workflow === 'agent' ? requestAgentSearch(agentPayload(10), options(fetcher, controller.signal)) : requestSearch(legacyPayload(10), [], options(fetcher, controller.signal));
    await startedRequest;
    controller.abort();
    await assert.rejects(() => run, error => error.name === 'AbortError', 'User cancellation stays cancellation rather than a prompt error');
    assert.equal(requestAborted, true);
    assert.equal(modelCalls, 0);
  }
  let freeCalls = 0;
  const freeFetch = async url => { freeCalls++; assert.equal(url, '/api/ai-search/chat', 'Free browser requests only the Worker'); return json({ ...answer, catalogVersion: 'prompt-v1', resources: [], model: 'fixture-free' }); };
  await requestSearch(legacyPayload(10), [], { ...options(freeFetch), mode: 'free' });
  await requestAgentSearch(agentPayload(10), { ...options(freeFetch), mode: 'free' });
  assert.equal(freeCalls, 2, 'Both free paths omit browser-side file downloads');
  console.log('PASS external system prompt: real system content, limits, one read per tool turn, cache refresh, unreadable-file fail closed, body timeout, cancellation, and Worker-only free mode');
})().catch(error => { console.error(error); process.exitCode = 1; });
