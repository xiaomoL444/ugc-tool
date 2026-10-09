/* Real browser CORS, localhost mocks only. Requires the shared Playwright runtime via NODE_PATH. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { chromium } = require('playwright');

const fakeKey = 'mock-local-cors-key-never-use-real';
function browserBundle() {
  const entries = ['./responseDiagnostics', './requestDiagnostics'].map(name => {
    const filename = path.join(__dirname, '..', 'src', 'views', 'AISearch', `${name.slice(2)}.ts`);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    return `${JSON.stringify(name)}: function(module, exports, require) {\n${source}\n}`;
  });
  return `(function() { const factories = {${entries.join(',\n')}}; const loaded = {};
    function load(name) { if (loaded[name]) return loaded[name].exports;
      if (!factories[name]) throw new Error('Unbundled diagnostic dependency: ' + name);
      const module = { exports: {} }; loaded[name] = module; factories[name](module, module.exports, load); return module.exports; }
    window.__requestDiagnostics = load('./requestDiagnostics'); })();`;
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function closeServer(server) {
  if (!server.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
}

(async () => {
  const requests = [];
  const blockedOutbound = [];
  let appOrigin, providerOrigin, browser;
  const bundle = browserBundle();
  const app = http.createServer((request, response) => {
    // Also act as a rejecting proxy for every non-localhost browser request.
    // Browser-level request interception changes CORS preflight behavior, so
    // the two fixture origins must go through the browser's normal network path.
    if (/^https?:\/\//i.test(request.url)) {
      const url = new URL(request.url);
      blockedOutbound.push(`${url.protocol}//${url.hostname}${url.pathname}`);
      response.writeHead(403); response.end(); return;
    }
    if (request.url === '/diagnostics.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(bundle); return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><head><title>Local CORS diagnostic fixture</title></head><body><script src="/diagnostics.js"></script></body></html>');
  });
  app.on('connect', (request, socket) => {
    blockedOutbound.push(`CONNECT ${request.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  const provider = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, method: request.method, origin: request.headers.origin,
      requestedMethod: request.headers['access-control-request-method'], requestedHeaders: request.headers['access-control-request-headers'],
      authorization: request.headers.authorization });
    // Consume the tiny mock body, with no outbound calls or real credentials.
    request.resume();
    if (url.pathname === '/blocked') {
      response.writeHead(request.method === 'OPTIONS' ? 204 : 400); response.end(); return;
    }
    const cors = { 'access-control-allow-origin': appOrigin, vary: 'Origin',
      'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type',
      'access-control-expose-headers': 'x-request-id' };
    if (request.method === 'OPTIONS') { response.writeHead(204, cors); response.end(); return; }
    if (url.pathname === '/timeout') {
      // The browser aborts this deliberately pending local request.
      const timer = setTimeout(() => { if (!response.destroyed) { response.writeHead(200, cors); response.end('{}'); } }, 1500);
      response.once('close', () => clearTimeout(timer)); return;
    }
    const status = url.pathname === '/rate-limit' ? 429 : 400;
    response.writeHead(status, { ...cors, 'content-type': 'application/json', 'x-request-id': status === 429 ? 'local-rate-request' : 'local-invalid-request' });
    response.end(JSON.stringify({ error: { code: status === 429 ? 'rate_limit_exceeded' : 'unsupported_parameter',
      param: status === 400 ? 'max_tokens' : undefined, message: status === 429 ? 'Mock local rate limit' : `Use max_completion_tokens instead. ${fakeKey}` },
      privateEnvelope: 'PRIVATE_FIXTURE_ENVELOPE' }));
  });
  try {
    appOrigin = await listen(app); providerOrigin = await listen(provider);
    browser = await chromium.launch({ channel: 'msedge', headless: true,
      proxy: { server: appOrigin, bypass: '127.0.0.1,localhost,[::1]' },
      args: ['--disable-background-networking', '--disable-component-update', '--dns-prefetch-disable',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    const browserFailures = [];
    const fixtureOutbound = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        fixtureOutbound.push(`${url.protocol}//${url.hostname}${url.pathname}`);
      }
    });
    page.on('requestfailed', request => browserFailures.push({ url: request.url().split('?')[0], message: request.failure()?.errorText }));
    page.on('console', message => { if (message.type() === 'error') browserFailures.push({ message: message.text().replaceAll(fakeKey, '[REDACTED]') }); });
    await page.goto(appOrigin, { waitUntil: 'load' });
    const run = async endpoint => page.evaluate(async ({ providerOrigin, endpoint, fakeKey }) => {
      const url = `${providerOrigin}/${endpoint}?api_key=${encodeURIComponent(fakeKey)}`;
      const requestContext = { stage: 'model', endpoint: url, model: 'mock-local-model', round: 1, startedAt: Date.now() };
      try {
        const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${fakeKey}`, 'Content-Type': 'application/json' }, body: '{"model":"mock-local-model"}' });
        const diagnostic = await window.__requestDiagnostics.httpRequestDiagnostic(response, requestContext, [fakeKey]);
        return { readable: true, diagnostic };
      } catch (error) {
        return { readable: false, browserName: error.name,
          diagnostic: window.__requestDiagnostics.transportRequestDiagnostic(error, requestContext, undefined, [fakeKey]) };
      }
    }, { providerOrigin, endpoint, fakeKey });

    const blocked = await run('blocked');
    assert.equal(blocked.readable, false); assert.equal(blocked.browserName, 'TypeError');
    assert.equal(blocked.diagnostic.stage, 'model'); assert.equal(blocked.diagnostic.kind, 'network');
    assert.equal(Object.hasOwn(blocked.diagnostic, 'status'), false, 'Blocked preflight provides no readable HTTP response');
    assert.equal(blocked.diagnostic.endpoint, `${providerOrigin}/blocked`);
    assert.equal(JSON.stringify(blocked.diagnostic).includes(fakeKey), false);
    const blockedRequests = requests.filter(request => request.path === '/blocked');
    assert.ok(blockedRequests.some(request => request.method === 'OPTIONS'), `Browser sends a genuine cross-origin preflight: ${JSON.stringify({ requests: blockedRequests, browserFailures, blockedOutbound })}`);
    assert.equal(blockedRequests.some(request => request.method === 'POST'), false, 'Rejected preflight prevents the model request itself');

    const invalid = await run('invalid-parameter');
    assert.equal(invalid.readable, true); assert.equal(invalid.diagnostic.kind, 'http'); assert.equal(invalid.diagnostic.status, 400);
    assert.equal(invalid.diagnostic.providerCode, 'unsupported_parameter'); assert.equal(invalid.diagnostic.parameter, 'max_tokens');
    assert.equal(invalid.diagnostic.requestId, 'local-invalid-request'); assert.match(invalid.diagnostic.providerMessage, /max_completion_tokens/);
    assert.equal(invalid.diagnostic.endpoint, `${providerOrigin}/invalid-parameter`);
    assert.doesNotMatch(JSON.stringify(invalid.diagnostic), /mock-local-cors-key|PRIVATE_FIXTURE_ENVELOPE/);
    const validRequests = requests.filter(request => request.path === '/invalid-parameter');
    const preflight = validRequests.find(request => request.method === 'OPTIONS');
    assert.ok(preflight); assert.equal(preflight.origin, appOrigin); assert.equal(preflight.requestedMethod, 'POST');
    assert.match(preflight.requestedHeaders, /authorization/); assert.match(preflight.requestedHeaders, /content-type/);
    assert.equal(validRequests.filter(request => request.method === 'POST').length, 1, 'HTTP 400 causes no paid retry');

    const limited = await run('rate-limit');
    assert.equal(limited.readable, true); assert.equal(limited.diagnostic.kind, 'http'); assert.equal(limited.diagnostic.status, 429);
    assert.equal(limited.diagnostic.providerCode, 'rate_limit_exceeded'); assert.equal(limited.diagnostic.requestId, 'local-rate-request');
    assert.equal(requests.filter(request => request.path === '/rate-limit' && request.method === 'POST').length, 1);

    const timedOut = await page.evaluate(async ({ providerOrigin, fakeKey }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 150);
      const requestContext = { stage: 'model', endpoint: `${providerOrigin}/timeout`, model: 'mock-local-model', round: 1, startedAt: Date.now() };
      try {
        await fetch(requestContext.endpoint, { method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${fakeKey}`, 'Content-Type': 'application/json' }, body: '{}' });
        return { unexpectedlyCompleted: true };
      } catch (error) {
        return { browserName: error.name, diagnostic: window.__requestDiagnostics.transportRequestDiagnostic(error, requestContext, controller.signal, [fakeKey]) };
      } finally { clearTimeout(timer); }
    }, { providerOrigin, fakeKey });
    assert.equal(timedOut.browserName, 'AbortError'); assert.equal(timedOut.diagnostic.kind, 'timeout');
    assert.equal(Object.hasOwn(timedOut.diagnostic, 'status'), false);
    assert.equal(requests.filter(request => request.path === '/timeout' && request.method === 'POST').length, 1);
    assert.deepEqual(fixtureOutbound, [], 'The test page made only localhost requests; browser background traffic is rejected by the local proxy');
    console.log('PASS localhost browser CORS: blocked preflight is no-response network; allowed HTTP400/429 are readable with safe request IDs; abort is timeout. Network diagnostics alone do not establish CORS as the cause.');
    if (blockedOutbound.length) console.log(`Local rejecting proxy blocked ${blockedOutbound.length} browser background requests; none were forwarded.`);
  } finally {
    await browser?.close();
    await Promise.all([closeServer(app), closeServer(provider)]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
