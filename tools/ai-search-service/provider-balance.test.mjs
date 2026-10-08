import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createProviderBalanceGuard, minimumBalanceCny, PROVIDER_BALANCE_REASONS } from "./provider-balance.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const config = { upstream: "https://api.deepseek.com/chat/completions", minBalanceCny: 20 };
const env = { UPSTREAM_API_KEY: "balance-test-key" };
const data = (balance = "20.00", available = true) => ({ is_available: available,
  balance_infos: [{ currency: "CNY", total_balance: balance, granted_balance: balance, topped_up_balance: "0.00" }] });
const response = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const check = value => createProviderBalanceGuard().check(config, env, { fetcher: async () => response(value) });
const unavailable = (status, reason) => {
  assert.equal(status.available, false); assert.equal(status.error.code, "PROVIDER_BALANCE_UNAVAILABLE");
  assert.equal(Object.hasOwn(status, "balance"), false);
  assert.ok(PROVIDER_BALANCE_REASONS.includes(status.error.reason));
  if (reason) assert.equal(status.error.reason, reason);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("minimum balance is a positive validated threshold with a safe 20 CNY default", () => {
  assert.equal(minimumBalanceCny(), 20);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "2e1", "1000001", null]) {
    assert.equal(minimumBalanceCny({ MIN_BALANCE_CNY: value }), 20);
  }
  assert.equal(minimumBalanceCny({ MIN_BALANCE_CNY: "25.5" }), 25.5);
});

test("exact CNY total balance boundaries include grants and never round a value below 20 up", async () => {
  for (const balance of ["19.99", "19.999999999999999999", "0.00", "-0.01"]) {
    const status = await check(data(balance)); assert.equal(status.error.code, "PROVIDER_BALANCE_LOW");
    assert.equal(Object.hasOwn(status.error, "reason"), false);
  }
  for (const balance of ["20", "20.00", "20.01", "999999999999999999"]) {
    assert.deepEqual(await check(data(balance)), { available: true });
  }
  const status = await createProviderBalanceGuard().check({ ...config, minBalanceCny: 25.5 }, env,
    { fetcher: async () => response(data("25.499999999999999999")) });
  assert.equal(status.error.code, "PROVIDER_BALANCE_LOW");
});

test("unavailable accounts always stop calls without asserting a healthy balance is low", async () => {
  unavailable(await check(data("99.99", false)), "ACCOUNT_UNAVAILABLE");
  assert.equal((await check(data("19.00", false))).error.code, "PROVIDER_BALANCE_LOW");
  unavailable(await check({ is_available: false }), "INVALID_RESPONSE");
});

test("missing, conflicting or malformed CNY balances fail closed", async () => {
  for (const value of [null, {}, { ...data(), is_available: "true" },
    { ...data(), balance_infos: [...data().balance_infos, ...data().balance_infos] },
    { ...data(), balance_infos: Array(17).fill(data().balance_infos[0]) },
    { ...data(), balance_infos: [{ currency: "EUR", total_balance: "500" }] },
    { ...data(), balance_infos: [{ currency: "USD", total_balance: "not-decimal" }] },
    { ...data(), balance_infos: [{ currency: "USD", total_balance: "500" }, { currency: "USD", total_balance: "500" }] },
    { ...data(), balance_infos: [{ ...data().balance_infos[0], granted_balance: 20 }] },
    { ...data(), balance_infos: [{ ...data().balance_infos[0], topped_up_balance: "mock-test-only" }] },
    ...[20, "20usd", "2e1", "NaN", "Infinity", "", "20.0000000000000000000"].map(balance => data(balance)),
  ]) unavailable(await check(value), "INVALID_RESPONSE");
});

test("a valid response without CNY is diagnosed separately without converting USD", async () => {
  for (const balance_infos of [[], [{ currency: "USD", total_balance: "500" }]]) {
    unavailable(await check({ ...data(), balance_infos }), "CNY_MISSING");
  }
});

test("balance query is restricted to the official URL and server key with redirects disabled", async () => {
  let calls = 0;
  const status = await createProviderBalanceGuard().check(config, env, { fetcher: async (url, options) => {
    calls += 1; assert.equal(url, "https://api.deepseek.com/user/balance");
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store"); assert.equal(options.headers.authorization, "Bearer balance-test-key");
    return response(data());
  } });
  assert.deepEqual(status, { available: true }); assert.equal(calls, 1);
  assert.deepEqual(await createProviderBalanceGuard().check(config, { UPSTREAM_API_KEY: " \r\nbalance-test-key\t " },
    { fetcher: async (_url, options) => {
      assert.equal(options.headers.authorization, "Bearer balance-test-key"); return response(data());
    } }), { available: true });
  for (const upstream of ["https://provider.example/chat", "https://api.deepseek.com.evil.example/chat", "https://deepseek.com/chat"]) {
    const result = await createProviderBalanceGuard().check({ ...config, upstream }, env,
      { fetcher: async () => { throw new Error("must not query another provider's balance"); } });
    assert.deepEqual(result, { available: true });
  }
});

test("every redirect is rejected without following its location or forwarding the server key", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const result = await createProviderBalanceGuard().check(config, env, { fetcher: async (url, options) => {
      calls += 1; assert.equal(url, "https://api.deepseek.com/user/balance");
      assert.equal(options.redirect, "manual");
      return new Response("", { status, headers: { location: "https://untrusted.example/balance" } });
    } });
    unavailable(result, "UPSTREAM_ERROR"); assert.equal(calls, 1);
  }
});

test("provider HTTP failures, invalid bodies and exceptions expose no provider details or secrets", async () => {
  for (const [fetcher, reason] of [
    ...[[401, "AUTH"], [403, "FORBIDDEN"], [429, "RATE_LIMIT"], [302, "UPSTREAM_ERROR"],
      [404, "UPSTREAM_ERROR"], [500, "UPSTREAM_ERROR"], [503, "UPSTREAM_ERROR"]]
      .map(([status, reason]) => [async () => new Response("balance-test-key 99999.42", { status }), reason]),
    [async () => new Response("not json balance-test-key 99999.42"), "INVALID_RESPONSE"],
    [async () => new Response(" ".repeat(17000)), "INVALID_RESPONSE"],
    [async () => new Response(null), "INVALID_RESPONSE"],
    [async () => new Response(new Uint8Array([0xff])), "INVALID_RESPONSE"],
    [async () => { throw new Error("balance-test-key 99999.42"); }, "NETWORK"],
  ]) {
    const status = await createProviderBalanceGuard().check(config, env, { fetcher }); unavailable(status, reason);
    assert.doesNotMatch(JSON.stringify(status), /balance-test-key|99999\.42|balance_infos|total_balance/);
  }
  for (const value of [undefined, null, 123, "", " \t\r\n"]) {
    unavailable(await createProviderBalanceGuard().check(config, { UPSTREAM_API_KEY: value },
      { fetcher: async () => { throw new Error("must not fetch without key"); } }), "MISSING_KEY");
  }
});

test("timeout covers a stalled fetch and a stalled response body, cancelling both", async () => {
  let fetchSignal;
  unavailable(await createProviderBalanceGuard().check(config, env, { timeoutMs: 15,
    fetcher: async (_url, options) => { fetchSignal = options.signal; return new Promise(() => {}); } }), "TIMEOUT");
  assert.equal(fetchSignal.aborted, true);
  let cancelled = false;
  unavailable(await createProviderBalanceGuard().check(config, env, { timeoutMs: 15,
    fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) }), "TIMEOUT");
  assert.equal(cancelled, true);
});

test("a parent abort before or during the check prevents a usable balance decision", async () => {
  const before = new AbortController(); before.abort(); let calls = 0;
  unavailable(await createProviderBalanceGuard().check(config, env, { signal: before.signal,
    fetcher: async () => { calls += 1; return response(data()); } }), "ABORTED");
  assert.equal(calls, 0);
  const during = new AbortController(), started = deferred(); let providerSignal;
  const pending = createProviderBalanceGuard().check(config, env, { signal: during.signal,
    fetcher: async (_url, options) => { providerSignal = options.signal; started.resolve(); return new Promise(() => {}); } });
  await started.promise; during.abort(); unavailable(await pending, "ABORTED"); assert.equal(providerSignal.aborted, true);
});

test("config requests share one short cache while fresh chat checks bypass it and refresh its status", async () => {
  const guard = createProviderBalanceGuard(), started = deferred(), held = deferred(); let calls = 0;
  const fetcher = async () => { calls += 1; started.resolve(); return held.promise; };
  const first = guard.check(config, env, { cached: true, fetcher }); await started.promise;
  const second = guard.check(config, env, { cached: true, fetcher });
  held.resolve(response(data())); assert.deepEqual(await first, { available: true });
  assert.deepEqual(await second, { available: true }); assert.equal(calls, 1);
  const cached = await guard.check(config, env, { cached: true, fetcher }); cached.available = false;
  assert.deepEqual(await guard.check(config, env, { cached: true, fetcher }), { available: true });
  assert.equal(calls, 1);
  const fresh = await guard.check(config, env, { fetcher: async () => { calls += 1; return response(data("19.99")); } });
  assert.equal(fresh.error.code, "PROVIDER_BALANCE_LOW"); assert.equal(calls, 2);
  assert.deepEqual(await guard.check(config, env, { cached: true, fetcher }), fresh); assert.equal(calls, 2);
  await guard.check(config, { UPSTREAM_API_KEY: "other-server-key" }, { cached: true, fetcher: async () => { calls += 1; return response(data()); } });
  await guard.check({ ...config, minBalanceCny: 25 }, env, { cached: true, fetcher: async () => { calls += 1; return response(data()); } });
  assert.equal(calls, 4, "key and threshold isolate cached decisions");
});

test("an older pending config query cannot replace a newer fresh chat block", async () => {
  const guard = createProviderBalanceGuard(), started = deferred(), held = deferred();
  const old = guard.check(config, env, { cached: true, fetcher: async () => { started.resolve(); return held.promise; } });
  await started.promise;
  const fresh = await guard.check(config, env, { fetcher: async () => response(data("19.99")) });
  held.resolve(response(data("99.99"))); assert.deepEqual(await old, { available: true });
  assert.deepEqual(await guard.check(config, env, { cached: true, fetcher: async () => { throw new Error("cache should contain fresh status"); } }), fresh);
});

test("public availability decisions expire after 30 seconds without storing balance figures", async () => {
  const guard = createProviderBalanceGuard(), originalNow = Date.now; let now = 1000000, calls = 0;
  const fetcher = async () => { calls += 1; return response(data(calls === 1 ? "19.99" : "20.00")); };
  Date.now = () => now;
  try {
    assert.equal((await guard.check(config, env, { cached: true, fetcher })).error.code, "PROVIDER_BALANCE_LOW");
    now += 29999;
    assert.equal((await guard.check(config, env, { cached: true, fetcher })).error.code, "PROVIDER_BALANCE_LOW");
    assert.equal(calls, 1);
    now += 1;
    assert.deepEqual(await guard.check(config, env, { cached: true, fetcher }), { available: true });
    assert.equal(calls, 2);
  } finally { Date.now = originalNow; }
});
