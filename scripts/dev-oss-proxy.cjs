const http = require("node:http");
const https = require("node:https");

const PREFIX = "/ugc-tool-data";
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

// Stream both indexes and media through the same development-only fallback.
function createDevOssProxy({ origin = "https://oss.xiaomol444.xyz", timeoutMs = 30000, betaPrefix = "" } = {}) {
  const upstream = new URL(origin);
  const transport = upstream.protocol === "https:" ? https : http;
  const betaPath = /^[a-z\d_-]+(?:\/[a-z\d_-]+)*$/i.test(betaPrefix) ? `/${betaPrefix}` : "";

  return (req, res, next) => {
    if (!/^\/ugc-tool-data(?:\/|\?|$)/.test(req.url) || !["GET", "HEAD"].includes(req.method)) {
      next();
      return;
    }

    const suffix = req.url.slice(PREFIX.length);
    const [pathname] = suffix.split("?", 1);
    // Keep upstream path normalization from escaping the selected directory.
    const pathSegments = pathname.replace(/%2e/gi, ".").replace(/%2f|%5c|\\/gi, "/").split("/");
    if (pathSegments.includes("..")) {
      res.writeHead(400, { "cache-control": "no-store" });
      res.end("Invalid OSS resource path");
      return;
    }

    let activeRequest;
    let activeResponse;

    // A cached production response must not hide a newly uploaded beta file.
    // Do not forward cookies, credentials or validators from the local origin.
    const requestHeaders = { "cache-control": "no-cache" };
    for (const name of ["accept", "accept-encoding", "accept-language", "range"]) {
      if (req.headers[name]) requestHeaders[name] = req.headers[name];
    }

    const fail = (error) => {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(`OSS development proxy failed: ${error.message}`);
    };

    const request = (beta) => {
      if (res.destroyed) return;
      const pending = transport.request(upstream, {
        method: req.method,
        path: `${beta ? betaPath : PREFIX}${suffix}`,
        headers: requestHeaders,
      }, (response) => {
        activeResponse = response;
        response.on("error", fail);

        // An access denial or a missing beta file permits fallback.
        if (beta && [401, 403, 404].includes(response.statusCode)) {
          response.on("end", () => request(false));
          response.resume();
          return;
        }

        const headers = { ...response.headers };
        const connectionHeaders = (headers.connection || "").split(",").map((name) => name.trim().toLowerCase());
        for (const name of [...HOP_BY_HOP, ...connectionHeaders]) delete headers[name];
        headers["cache-control"] = "no-store";
        headers["x-ugc-data-source"] = beta ? "beta" : "production";
        res.writeHead(response.statusCode, headers);
        response.pipe(res);
      });
      activeRequest = pending;
      pending.on("error", fail);
      pending.setTimeout(timeoutMs, () => pending.destroy(new Error("Upstream request timed out")));
      pending.end();
    };

    res.on("close", () => {
      activeRequest?.destroy();
      activeResponse?.destroy();
    });
    // Use the socket address so clients cannot opt in through forwarded headers.
    const clientAddress = req.socket.remoteAddress;
    const isLoopback = clientAddress === "::1" || /^(?:::ffff:)?127\./.test(clientAddress);
    request(Boolean(betaPath) && betaPath !== PREFIX && isLoopback);
  };
}

module.exports = { createDevOssProxy };
