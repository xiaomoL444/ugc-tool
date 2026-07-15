const ALLOWED_ORIGINS = new Set([
  "https://xiaomol444.xyz",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const API_HOSTS = new Set([
  "cht-ugc-api.hoyoverse.com",
  "asia-ugc-api.hoyoverse.com",
  "en-ugc-api.hoyoverse.com",
  "us-ugc-api.hoyoverse.com",
]);

const BINARY_DOWNLOAD_HOSTS = new Set([
  "cht-ugc-upload.hoyoverse.com",
  "asia-ugc-upload.hoyoverse.com",
  "en-ugc-upload.hoyoverse.com",
  "us-ugc-upload.hoyoverse.com",
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return jsonError("Origin not allowed", 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return jsonError("Method not allowed", 405, origin);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400, origin);
    }

    const {
      url,
      cookie,
      secret,
      ua,
      method = "GET",
      data,
    } = body ?? {};

    if (
      typeof url !== "string" ||
      typeof cookie !== "string" ||
      typeof secret !== "string" ||
      typeof ua !== "string" ||
      typeof method !== "string"
    ) {
      return jsonError(
        "url, cookie, secret, ua and method must be valid",
        400,
        origin,
      );
    }

    const upstreamMethod = method.toUpperCase();
    if (upstreamMethod !== "GET" && upstreamMethod !== "POST") {
      return jsonError("Upstream method not allowed", 405, origin);
    }

    if (
      upstreamMethod === "POST" &&
      (data === null || typeof data !== "object" || Array.isArray(data))
    ) {
      return jsonError("POST data must be a JSON object", 400, origin);
    }

    if (!ua || ua.length > 1024 || /[\r\n]/.test(ua)) {
      return jsonError("Invalid ua", 400, origin);
    }

    if (
      typeof env.PROXY_SECRET !== "string" ||
      !safeEqual(secret, env.PROXY_SECRET)
    ) {
      return jsonError("Invalid secret", 401, origin);
    }

    let target;

    try {
      target = new URL(url);
    } catch {
      return jsonError("Invalid URL", 400, origin);
    }

    if (
      target.protocol !== "https:" ||
      target.port !== "" ||
      target.username !== "" ||
      target.password !== "" ||
      !(
        API_HOSTS.has(target.hostname) ||
        (upstreamMethod === "GET" &&
          BINARY_DOWNLOAD_HOSTS.has(target.hostname))
      )
    ) {
      return jsonError("Target host not allowed", 403, origin);
    }

    try {
      const upstreamHeaders = new Headers({
        Accept: "*/*",
        "Accept-Language": "zh-cn,zh;q=0.9",
        Cookie: cookie,
        Origin: "https://act.hoyoverse.com",
        Referer: "https://act.hoyoverse.com/",
        "User-Agent": ua,
        "x-rpc-device_id": "",
        "x-rpc-lang": "zh-cn",
      });

      if (upstreamMethod === "POST") {
        upstreamHeaders.set("Content-Type", "application/json");
      }

      const upstream = await fetch(url, {
        method: upstreamMethod,
        headers: upstreamHeaders,
        body: upstreamMethod === "POST" ? JSON.stringify(data) : undefined,
        redirect: "manual",
      });

      const headers = new Headers(upstream.headers);
      applyCorsHeaders(headers, origin);

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch {
      return jsonError("Upstream request failed", 502, origin);
    }
  },
};

function corsHeaders(origin) {
  const headers = new Headers();
  applyCorsHeaders(headers, origin);
  return headers;
}

function applyCorsHeaders(headers, origin) {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.append("Vary", "Origin");
}

function jsonError(message, status, origin) {
  const headers = origin ? corsHeaders(origin) : new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers,
  });
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}
