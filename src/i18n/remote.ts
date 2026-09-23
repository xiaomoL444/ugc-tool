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
}

export type RemoteTranslationResult =
  | { status: "loaded"; namespace: string; locale: string; entries: number }
  | { status: "missing"; namespace: string; locale: string }
  | { status: "failed"; namespace: string; locale: string; error: Error };

export interface RemoteTranslationOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
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
export function parseTranslationTable(input: unknown, namespace: string, locale: string) {
  assertSegment(namespace);
  assertLocale(locale);
  // Resource exports may contain a flat dictionary of fully qualified keys.
  // Normalize it before using the same validation and literal-text handling.
  const prefix = `${namespace}.`;
  if (isRecord(input) && Object.keys(input).every((key) => key.startsWith(prefix))) {
    input = {
      version: 1,
      namespace,
      locale,
      format: "text",
      translations: Object.fromEntries(Object.entries(input).map(([key, value]) => [key.slice(prefix.length), value])),
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
  const paths = Object.keys(input.translations);
  const pathSet = new Set(paths);
  let entries = 0;
  for (const path of paths) {
    const segments = path.split(".");
    segments.forEach(assertSegment);
    for (let index = 1; index < segments.length; index++) {
      if (pathSet.has(segments.slice(0, index).join("."))) throw new Error(`Conflicting translation paths: ${path}`);
    }
    const text = input.translations[path];
    if (text !== null && typeof text !== "string") throw new Error(`Expected text or null for ${path}/${locale}`);
    // Empty spreadsheet cells mean missing translations, never a blank label.
    if (text === null || !text.trim()) continue;
    let node = messages;
    for (const segment of segments.slice(0, -1)) {
      node = (Object.hasOwn(node, segment) ? node[segment] : (node[segment] = {})) as MessageTree;
    }
    node[segments[segments.length - 1]] = input.format === "message" ? text : escapeMessageText(text);
    entries++;
  }
  return { messages, entries };
}

/** One OSS file owns one namespace/locale pair. Concurrent calls share a request. */
export class RemoteI18nLoader {
  private readonly sources = new Map<string, string>();
  private readonly pending = new Map<string, Promise<RemoteTranslationResult>>();
  private readonly bases = new Map<string, MessageTree>();
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly store: TranslationMessageStore, options: RemoteTranslationOptions = {}) {
    this.request = options.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  load(source: RemoteTranslationSource): Promise<RemoteTranslationResult> {
    const key = `${source.namespace}:${source.locale}`;
    try {
      assertSegment(source.namespace);
      assertLocale(source.locale);
      const registered = this.sources.get(key);
      if (registered && registered !== source.url) throw new Error(`Namespace/locale ${key} already has another translation source`);
      this.sources.set(key, source.url);
    } catch (error) {
      return Promise.resolve({ status: "failed", namespace: source.namespace, locale: source.locale, error: error as Error });
    }
    const current = this.pending.get(key);
    if (current) return current;
    const promise = this.fetchAndApply(source).finally(() => this.pending.delete(key));
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

  private async fetchAndApply(source: RemoteTranslationSource): Promise<RemoteTranslationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const separator = source.url.includes("?") ? "&" : "?";
      const response = await this.request(`${source.url}${separator}_t=${Date.now()}`, {
        cache: "no-store", signal: controller.signal,
      });
      if (response.status === 404) {
        this.apply(source, {});
        return { status: "missing", namespace: source.namespace, locale: source.locale };
      }
      if (!response.ok) throw new Error(`Translation request failed (${response.status}): ${source.url}`);
      const table = parseTranslationTable(await response.json(), source.namespace, source.locale);
      this.apply(source, table.messages);
      return { status: "loaded", namespace: source.namespace, locale: source.locale, entries: table.entries };
    } catch (error) {
      return { status: "failed", namespace: source.namespace, locale: source.locale, error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
