// Run with: node scripts/test-dev-oss-proxy.cjs. Uses local HTTP servers only.
const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { createDevOssProxy } = require("./dev-oss-proxy.cjs");

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function get(origin, path, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin + path, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({
        status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
      }));
    });
    request.on("error", reject);
    request.setTimeout(2000, () => request.destroy(new Error("Test request timed out")));
    request.end();
  });
}

async function fixture(t, reply, options = {}) {
  const calls = [];
  const origin = await listen(t, (req, res) => {
    calls.push({ url: req.url, method: req.method, headers: req.headers });
    reply(req, res);
  });
  const middleware = createDevOssProxy({ origin, ...options });
  const proxy = await listen(t, (req, res) => middleware(req, res, () => {
    res.writeHead(418);
    res.end("next middleware");
  }));
  return { calls, proxy, get: (path, options) => get(proxy, path, options) };
}

test("beta index wins as a complete file; query and encoded path are preserved", async (t) => {
  const json = '{"items":[{"id":1},{"id":2,"beta":true}]}';
  const f = await fixture(t, (req, res) => {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=3600" });
    res.end(json);
  });
  const suffix = "/EffectPlayer/%E6%B5%8B%E8%AF%95%20data.json?_t=123&name=a%2Fb";
  const result = await f.get("/ugc-tool-data" + suffix);
  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), json);
  assert.equal(result.headers["x-ugc-data-source"], "beta");
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(f.calls.map((call) => call.url), ["/ugc-tool-data-beta" + suffix]);
});

test("404 falls back per file for indexes, translations, images, audio and video", async (t) => {
  const paths = ["/EffectPlayer/data.json", "/EffectPlayer/i18n/zh-cn.json",
    "/Public/CustomUIImage/icon/1.png", "/SoundEffectPlayer/audio/1.ogg", "/EffectPlayer/webm/1.webm"];
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71]);
  const f = await fixture(t, (req, res) => {
    const missing = req.url.startsWith("/ugc-tool-data-beta/");
    res.writeHead(missing ? 404 : 200, { "content-type": "application/octet-stream" });
    res.end(missing ? "beta missing" : bytes);
  });
  for (const path of paths) {
    const result = await f.get("/ugc-tool-data" + path);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, bytes);
    assert.equal(result.headers["x-ugc-data-source"], "production");
  }
  assert.deepEqual(f.calls.map((call) => call.url),
    paths.flatMap((path) => ["/ugc-tool-data-beta" + path, "/ugc-tool-data" + path]));
});

test("HEAD preserves method and metadata across fallback", async (t) => {
  const f = await fixture(t, (req, res) => {
    const missing = req.url.startsWith("/ugc-tool-data-beta/");
    res.writeHead(missing ? 404 : 200, { "content-type": "image/png", "content-length": "123" });
    res.end();
  });
  const result = await f.get("/ugc-tool-data/EffectPlayer/icon/1.png", { method: "HEAD" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-length"], "123");
  assert.equal(result.headers["content-type"], "image/png");
  assert.equal(result.body.length, 0);
  assert.deepEqual(f.calls.map((call) => call.method), ["HEAD", "HEAD"]);
});

for (const betaMissing of [false, true]) {
  test(`media Range streams 206 from ${betaMissing ? "production" : "beta"}`, async (t) => {
    const f = await fixture(t, (req, res) => {
      if (betaMissing && req.url.startsWith("/ugc-tool-data-beta/")) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(206, { "content-type": "video/webm", "accept-ranges": "bytes",
        "content-range": "bytes 2-5/10", "content-length": "4" });
      res.end("2345");
    });
    const result = await f.get("/ugc-tool-data/EffectPlayer/webm/1.webm", { headers: { range: "bytes=2-5" } });
    assert.equal(result.status, 206);
    assert.equal(result.body.toString(), "2345");
    assert.equal(result.headers["content-range"], "bytes 2-5/10");
    assert.equal(result.headers["accept-ranges"], "bytes");
    assert.equal(result.headers["content-type"], "video/webm");
    assert.ok(f.calls.every((call) => call.headers.range === "bytes=2-5"));
    assert.equal(f.calls.length, betaMissing ? 2 : 1);
  });
}

for (const status of [403, 416, 429, 500, 503]) {
  test(`beta HTTP ${status} remains visible without fallback`, async (t) => {
    const f = await fixture(t, (req, res) => { res.writeHead(status); res.end("beta error"); });
    const result = await f.get("/ugc-tool-data/EffectPlayer/data.json");
    assert.equal(result.status, status);
    assert.equal(result.body.toString(), "beta error");
    assert.equal(f.calls.length, 1);
  });
}

test("missing from both directories returns the production 404", async (t) => {
  const f = await fixture(t, (req, res) => { res.writeHead(404); res.end(req.url); });
  const result = await f.get("/ugc-tool-data/EffectPlayer/missing.json");
  assert.equal(result.status, 404);
  assert.equal(result.body.toString(), "/ugc-tool-data/EffectPlayer/missing.json");
  assert.equal(f.calls.length, 2);
});

test("invalid beta JSON is not silently replaced with production JSON", async (t) => {
  const f = await fixture(t, (req, res) => { res.writeHead(200); res.end("{broken"); });
  const result = await f.get("/ugc-tool-data/EffectPlayer/data.json");
  assert.throws(() => JSON.parse(result.body.toString()));
  assert.equal(f.calls.length, 1);
});

test("upstream connection failure and timeout return 502 without fallback", async (t) => {
  for (const mode of ["disconnect", "timeout"]) {
    await t.test(mode, async (t) => {
      const f = await fixture(t, (req) => { if (mode === "disconnect") req.socket.destroy(); }, { timeoutMs: 50 });
      const result = await f.get("/ugc-tool-data/EffectPlayer/data.json");
      assert.equal(result.status, 502);
      assert.equal(f.calls.length, 1);
    });
  }
});

test("a new beta file supersedes production; client validators and credentials are not forwarded", async (t) => {
  let betaExists = false;
  const f = await fixture(t, (req, res) => {
    const beta = req.url.startsWith("/ugc-tool-data-beta/");
    res.writeHead(beta && !betaExists ? 404 : 200);
    res.end(beta ? "beta" : "production");
  });
  const path = "/ugc-tool-data/EffectPlayer/icon/1.png";
  assert.equal((await f.get(path)).body.toString(), "production");
  betaExists = true;
  const result = await f.get(path, { headers: {
    "if-none-match": '"production-etag"', "if-modified-since": "Wed, 16 Sep 2026 00:00:00 GMT",
    cookie: "local=private", authorization: "Bearer local-only",
  } });
  assert.equal(result.body.toString(), "beta");
  assert.equal(result.headers["cache-control"], "no-store");
  const headers = f.calls.at(-1).headers;
  for (const name of ["if-none-match", "if-modified-since", "cookie", "authorization"]) {
    assert.equal(headers[name], undefined);
  }
  assert.equal(headers["cache-control"], "no-cache");
  assert.equal(f.calls.length, 3);
});

test("unrelated routes and write methods continue to the next middleware", async (t) => {
  const f = await fixture(t, () => assert.fail("Unrelated request reached OSS"));
  for (const path of ["/", "/app.js", "/ugc-tool-data-beta/EffectPlayer/data.json", "/ugc-tool-database/test"]) {
    assert.equal((await f.get(path)).status, 418);
  }
  assert.equal((await f.get("/ugc-tool-data/EffectPlayer/data.json", { method: "POST" })).status, 418);
  assert.equal(f.calls.length, 0);
});

test("closing a media request cancels its upstream stream", async (t) => {
  let closeUpstream;
  const upstreamClosed = new Promise((resolve) => { closeUpstream = resolve; });
  const f = await fixture(t, (req, res) => {
    res.on("close", closeUpstream);
    res.writeHead(200, { "content-type": "video/webm" });
    res.write("first chunk");
  });
  await new Promise((resolve, reject) => {
    const request = http.get(f.proxy + "/ugc-tool-data/EffectPlayer/webm/1.webm", (response) => {
      response.once("data", () => { response.destroy(); resolve(); });
    });
    request.on("error", reject);
  });
  await Promise.race([upstreamClosed, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Upstream was not cancelled")), 1000);
    timer.unref();
    upstreamClosed.then(() => clearTimeout(timer));
  })]);
  assert.equal(f.calls.length, 1);
});
