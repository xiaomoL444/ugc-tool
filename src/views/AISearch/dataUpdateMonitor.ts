import { createOss, OSS_BASE_URL } from "../../utils/oss";

const REQUEST_TIMEOUT_MS = 5000;
type VersionStorage = Pick<Storage, "getItem" | "setItem">;

/** Observe the public release marker without changing an ongoing search. */
export function createDataUpdateMonitor(onUpdate: (version: string) => void, fetcher: typeof fetch = fetch, base = OSS_BASE_URL, storage?: VersionStorage) {
  const url = createOss("AISearch", base).path("index.json");
  const storageKey = `ugc-tools.ai-search.data-version.v1:${url}`;
  let version = "";
  try {
    storage ??= localStorage;
    version = storage.getItem(storageKey) || "";
  } catch { /* Storage restrictions still allow an in-memory baseline. */ }
  let disposed = false;
  let pending: AbortController | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;

  async function check(notifyOnFirstLoad = false) {
    if (disposed || pending) return;
    const controller = new AbortController();
    pending = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    requestTimer = timer;
    try {
      const response = await fetcher(`${url}?_t=${Date.now()}`, {
        method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal,
      });
      if (!response.ok || disposed || controller.signal.aborted) return;
      const index: unknown = await response.json();
      if (disposed || controller.signal.aborted || !index || typeof index !== "object" || Array.isArray(index)) return;
      const data = (index as Record<string, unknown>).data;
      if (typeof data !== "string" || !data.trim() || data.length > 256) return;
      const nextVersion = data.trim();
      const changed = version ? version !== nextVersion : notifyOnFirstLoad;
      version = nextVersion;
      try { storage?.setItem(storageKey, nextVersion); } catch { /* Keep the current baseline in memory. */ }
      if (changed) onUpdate(nextVersion);
    } catch { /* A missing marker or transient network error must not interrupt search. */ }
    finally {
      clearTimeout(timer);
      if (pending === controller) { pending = undefined; requestTimer = undefined; }
    }
  }

  function dispose() {
    disposed = true;
    clearTimeout(requestTimer);
    pending?.abort();
  }
  return { check, dispose };
}
