import { escapeMessageText } from "./messageText";

export interface TranslationTable {
  version: 1;
  namespace: string;
  locale: string;
  /** text (default) preserves punctuation; message enables Vue I18n placeholders/plurals. */
  format?: "text" | "message";
  translations: Record<string, string | null>;
}

export interface MessageTree { [key: string]: string | MessageTree }

export interface TranslationMessageStore {
  getLocaleMessage(locale: string): MessageTree;
  setLocaleMessage(locale: string, messages: MessageTree): void;
}

export interface RemoteTranslationSource {
  namespace: string;
  locale: string;
  url: string;
  /** Adapt historic numeric category keys at the shared boundary. */
  keyPrefix?: string;
}

export type RemoteTranslationResult =
  | { status: "loaded"; namespace: string; locale: string; entries: number }
  | { status: "missing"; namespace: string; locale: string }
  | { status: "failed"; namespace: string; locale: string; error: Error };

export interface RemoteTranslationOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface RemoteTranslationLoadOptions {
  /** Successful snapshots are reused unless refresh is explicitly requested. */
  refresh?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
// Dynamic data can introduce category keys in any language.
const validSegment = /^[\p{L}\p{N}_-]+$/u;
const validLocale = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSegment(value: string) {
  if (!validSegment.test(value) || unsafeKeys.has(value)) throw new Error(`Invalid translation key segment: ${value}`);
}

function assertLocale(value: string) {
  if (!validLocale.test(value) || unsafeKeys.has(value)) throw new Error(`Invalid locale: ${value}`);
}

function cloneTree(tree: MessageTree): MessageTree {
  return Object.fromEntries(Object.entries(tree).map(([key, value]) => [key,
    typeof value === "string" ? value : cloneTree(value),
  ]));
}

function mergeTree(base: MessageTree, override: MessageTree): MessageTree {
  const result = cloneTree(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = typeof value === "string" ? value : mergeTree(
      Object.hasOwn(result, key) && typeof result[key] === "object" ? result[key] as MessageTree : {}, value,
    );
  }
  return result;
}

/** Validate the entire single-language file before updating its locale. */
export function parseTranslationTable(input: unknown, namespace: string, locale: string, keyPrefix?: string) {
  assertSegment(namespace);
  assertLocale(locale);
  if (keyPrefix !== undefined) keyPrefix.split(".").forEach(assertSegment);
  // Resource exports may contain a flat dictionary of fully qualified keys.
  // Normalize it before using the same validation and literal-text handling.
  const prefix = `${namespace}.`;
  if (isRecord(input) && Object.keys(input).every((key) => key.startsWith(prefix) || keyPrefix !== undefined && /^\d+$/.test(key))) {
    const paths = Object.keys(input).map(key => key.startsWith(prefix) ? key.slice(prefix.length) : `${keyPrefix}.${key}`);
    if (new Set(paths).size !== paths.length) throw new Error("Conflicting normalized translation keys");
    input = {
      version: 1,
      namespace,
      locale,
      format: "text",
      translations: Object.fromEntries(Object.entries(input).map(([key, value]) => [
        key.startsWith(prefix) ? key.slice(prefix.length) : `${keyPrefix}.${key}`, value,
      ])),
    };
  }
  if (!isRecord(input) || input.version !== 1 || input.namespace !== namespace || !isRecord(input.translations)) {
    throw new Error(`Expected version 1 translation table for namespace ${namespace}`);
  }
  if (input.format !== undefined && input.format !== "text" && input.format !== "message") {
    throw new Error("Translation format must be text or message");
  }
  if (typeof input.locale !== "string" || input.locale.toLowerCase() !== locale.toLowerCase()) {
    throw new Error(`Expected translation locale ${locale}`);
  }
  const messages: MessageTree = {};
  const dictionary: Record<string, string> = {};
  const translations = Object.fromEntries(Object.entries(input.translations).map(([key, value]) => [
    keyPrefix !== undefined && /^\d+$/.test(key) ? `${keyPrefix}.${key}` : key, value,
  ]));
  const paths = Object.keys(translations);
  if (paths.length !== Object.keys(input.translations).length) throw new Error("Conflicting normalized translation keys");
  const pathSet = new Set(paths);
  let entries = 0;
  for (const path of paths) {
    const segments = path.split(".");
    segments.forEach(assertSegment);
    for (let index = 1; index < segments.length; index++) {
      if (pathSet.has(segments.slice(0, index).join("."))) throw new Error(`Conflicting translation paths: ${path}`);
    }
    const text = translations[path];
    if (text !== null && typeof text !== "string") throw new Error(`Expected text or null for ${path}/${locale}`);
    // Empty spreadsheet cells mean missing translations, never a blank label.
    if (text === null || !text.trim()) continue;
    let node = messages;
    for (const segment of segments.slice(0, -1)) {
      node = (Object.hasOwn(node, segment) ? node[segment] : (node[segment] = {})) as MessageTree;
    }
    node[segments[segments.length - 1]] = input.format === "message" ? text : escapeMessageText(text);
    dictionary[`${namespace}.${path}`] = text;
    entries++;
  }
  return { messages, entries, dictionary: Object.freeze(dictionary) };
}

/** One OSS file owns one namespace/locale pair. Concurrent calls share a request. */
export class RemoteI18nLoader {
  private readonly sources = new Map<string, string>();
  private readonly pending = new Map<string, Promise<RemoteTranslationResult>>();
  private readonly completed = new Map<string, RemoteTranslationResult>();
  private readonly dictionaries = new Map<string, Readonly<Record<string, string>>>();
  private readonly dictionaryBytes = new Map<string, number>();
  private readonly failed = new Set<string>();
  private readonly bases = new Map<string, MessageTree>();
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(private readonly store: TranslationMessageStore, options: RemoteTranslationOptions = {}) {
    this.request = options.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxBytes = options.maxBytes ?? 90_000_000;
  }

  /** Unescaped, full-key text shared by display, descriptions and search. */
  getDictionary(namespace: string, locale: string) {
    return this.dictionaries.get(`${namespace}:${locale}`);
  }

  getDictionaryBytes(namespace: string, locale: string) {
    return this.dictionaryBytes.get(`${namespace}:${locale}`) ?? 0;
  }

  load(source: RemoteTranslationSource, options: RemoteTranslationLoadOptions = {}): Promise<RemoteTranslationResult> {
    const key = `${source.namespace}:${source.locale}`;
    try {
      assertSegment(source.namespace);
      assertLocale(source.locale);
      if (source.keyPrefix !== undefined) source.keyPrefix.split(".").forEach(assertSegment);
      const identity = JSON.stringify([source.url, source.keyPrefix]);
      const registered = this.sources.get(key);
      if (registered && registered !== identity) throw new Error(`Namespace/locale ${key} already has another translation source`);
      this.sources.set(key, identity);
    } catch (error) {
      return Promise.resolve({ status: "failed", namespace: source.namespace, locale: source.locale, error: error as Error });
    }
    const current = this.pending.get(key);
    if (current) return current;
    const cached = this.completed.get(key);
    if (options.refresh !== true && cached && !this.failed.has(key)) return Promise.resolve(cached);
    const promise = this.fetchAndApply(source, options).then((result) => {
      if (result.status === "loaded") { this.completed.set(key, result); this.failed.delete(key); }
      else { this.failed.add(key); if (result.status === "missing") this.completed.delete(key); }
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private apply({ namespace, locale }: RemoteTranslationSource, messages: MessageTree) {
    const key = `${namespace}:${locale}`;
    const root = this.store.getLocaleMessage(locale);
    if (!this.bases.has(key)) {
      const local = Object.hasOwn(root, namespace) ? root[namespace] : undefined;
      this.bases.set(key, local && typeof local === "object" ? cloneTree(local) : {});
    }
    // Replace only this language's remote snapshot; other languages remain intact.
    this.store.setLocaleMessage(locale, {
      ...root,
      [namespace]: mergeTree(this.bases.get(key)!, messages),
    });
  }

  private async fetchAndApply(source: RemoteTranslationSource, options: RemoteTranslationLoadOptions): Promise<RemoteTranslationResult> {
    const controller = new AbortController();
    const bounded = (value: number | undefined, fallback: number, limit: number) =>
      value !== undefined && Number.isFinite(value) ? Math.min(limit, Math.max(1, value)) : fallback;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new DOMException("Translation request timed out", "AbortError"));
        reject(controller.signal.reason);
      }, bounded(options.timeoutMs, this.timeoutMs, 60_000));
    });
    const maxBytes = bounded(options.maxBytes, this.maxBytes, 90_000_000);
    try {
      const work = async (): Promise<RemoteTranslationResult> => {
        const separator = source.url.includes("?") ? "&" : "?";
        const response = await this.request(`${source.url}${separator}_t=${Date.now()}`, {
          cache: "no-store", credentials: "omit", signal: controller.signal,
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          throw controller.signal.reason;
        }
        if (response.status === 404) {
          this.apply(source, {});
          this.dictionaries.delete(`${source.namespace}:${source.locale}`);
          this.dictionaryBytes.delete(`${source.namespace}:${source.locale}`);
          return { status: "missing", namespace: source.namespace, locale: source.locale };
        }
        if (!response.ok) throw new Error(`Translation request failed (${response.status}): ${source.url}`);
        const contentType = response.headers?.get("Content-Type") || "";
        if (contentType && !/application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(contentType)) throw new Error("Expected a JSON translation response");
        const body = await this.readJson(response, controller.signal, maxBytes);
        if (controller.signal.aborted) throw controller.signal.reason;
        const table = parseTranslationTable(body.input, source.namespace, source.locale, source.keyPrefix);
        this.apply(source, table.messages);
        this.dictionaries.set(`${source.namespace}:${source.locale}`, table.dictionary);
        this.dictionaryBytes.set(`${source.namespace}:${source.locale}`, body.bytes);
        return { status: "loaded", namespace: source.namespace, locale: source.locale, entries: table.entries };
      };
      // AbortSignal alone cannot bound a transport or body reader that ignores it.
      // Late work checks the signal before publishing a dictionary snapshot.
      return await Promise.race([work(), stopped]);
    } catch (error) {
      controller.abort();
      return { status: "failed", namespace: source.namespace, locale: source.locale, error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async readJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<{ input: unknown; bytes: number }> {
    const length = Number(response.headers?.get("Content-Length"));
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel();
      throw new Error("Translation file exceeds the size limit");
    }
    // Lightweight response doubles still exercise the same table validation.
    if (!response.body) {
      if (typeof response.text !== "function") {
        const input: unknown = await response.json();
        const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
        if (bytes > maxBytes) throw new Error("Translation file exceeds the size limit");
        return { input, bytes };
      }
      const text = await response.text();
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > maxBytes) throw new Error("Translation file exceeds the size limit");
      return { input: JSON.parse(text.replace(/^\uFEFF/, "")), bytes };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks: string[] = [];
    let total = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        if (signal.aborted) throw new Error("Translation request timed out");
        const item = await reader.read();
        if (signal.aborted) throw new Error("Translation request timed out");
        if (item.done) break;
        total += item.value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error("Translation file exceeds the size limit"); }
        chunks.push(decoder.decode(item.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return { input: JSON.parse(chunks.join("").replace(/^\uFEFF/, "")), bytes: total };
    } finally {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    }
  }
}
