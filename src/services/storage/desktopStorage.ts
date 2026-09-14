import type { FileChangeEvent, StorageSnapshot, SyncStorageProvider } from "./types";

export interface StorageSettings {
  mode: "browser" | "desktop";
  endpoint: string;
  token: string;
}

const settingsKey = "ugc-tools.storage.v1";
export const defaultStorageSettings: StorageSettings = {
  mode: "browser", endpoint: "http://127.0.0.1:27182", token: "",
};

export function readStorageSettings(): StorageSettings {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) || "null");
    if (value?.mode === "desktop" || value?.mode === "browser") {
      return { mode: value.mode, endpoint: String(value.endpoint || defaultStorageSettings.endpoint), token: String(value.token || "") };
    }
  } catch { /* Browser storage may be disabled. Keep the default provider usable. */ }
  return { ...defaultStorageSettings };
}

export function normalizeDesktopEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/"
      || url.search || url.hash || url.username || url.password) {
    throw new Error("请填写本机地址，例如 http://127.0.0.1:27182");
  }
  return url.origin;
}

export function saveStorageSettings(settings: StorageSettings): void {
  localStorage.setItem(settingsKey, JSON.stringify({
    ...settings,
    endpoint: settings.mode === "desktop" || settings.token.trim() ? normalizeDesktopEndpoint(settings.endpoint) : defaultStorageSettings.endpoint,
    token: settings.token.trim(),
  }));
}

export function rememberDesktopConnection(settings: StorageSettings): void {
  saveStorageSettings({ ...readStorageSettings(), endpoint: settings.endpoint, token: settings.token });
}

export class DesktopStorageError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = "DesktopStorageError";
  }
}

export interface DesktopStatus {
  connected: boolean;
  message: string;
  lastSaveError: string;
  lastChange: string;
}

export class DesktopStorage implements SyncStorageProvider {
  readonly storageName = "电脑存档目录";
  private readonly revisions = new Map<string, string>();
  private readonly changes = new Set<(event: FileChangeEvent) => void>();
  private readonly listeners = new Set<(status: DesktopStatus) => void>();
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 2000;
  private disposed = false;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly saveErrors = new Map<string, string>();
  private syncSession?: string;
  private status: DesktopStatus = { connected: false, message: "正在连接本地程序…", lastSaveError: "", lastChange: "" };

  constructor(private readonly settings: StorageSettings) {}

  async init(): Promise<void> { this.connectEvents(); }
  // Explicit selection remains selected while offline. Never fall back to another save location.
  async isAvailable(): Promise<boolean> { return true; }

  onStatus(callback: (status: DesktopStatus) => void): () => void {
    this.listeners.add(callback);
    callback({ ...this.status });
    return () => { this.listeners.delete(callback); };
  }

  private update(patch: Partial<DesktopStatus>) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener({ ...this.status });
  }

  async checkConnection(): Promise<void> {
    const health = await this.request<{ protocolVersion: number }>("/api/health");
    if (health.protocolVersion !== 1) throw new Error("本地程序协议版本不兼容，请更新程序。");
  }

  async prepareSync(): Promise<void> {
    const health = await this.request<{ protocolVersion: number; syncSession?: string }>("/api/health");
    if (health.protocolVersion !== 1 || !health.syncSession) throw new Error("请先更新并重启 C# 本地存档程序，以使用迁移与同步功能。");
    this.syncSession = health.syncSession;
  }

  private async request<T>(route: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(normalizeDesktopEndpoint(this.settings.endpoint) + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${this.settings.token.trim()}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.syncSession ? { "X-UGC-Sync-Session": this.syncSession } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new DesktopStorageError(result.error || `本地服务返回错误（${response.status}）`, result.code || "request_failed", response.status);
      return result as T;
    } catch (error) {
      if (error instanceof DesktopStorageError) throw error;
      this.update({ connected: false, message: "本地程序未连接，请检查程序、允许的网站及浏览器本地网络权限。" });
      throw new DesktopStorageError("无法确认本地操作结果。请检查本地程序连接；当前修改尚未确认保存到磁盘。", "connection_failed", 0);
    } finally { clearTimeout(timer); }
  }

  private async execute<T>(operation: string, path: string, extra: Record<string, unknown> = {}): Promise<T> {
    const response = await this.request<{ result: T }>("/api/storage", { operation, path, ...extra });
    return response.result;
  }

  private mutate<T>(path: string, action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action).then(value => {
      this.saveErrors.delete(path);
      this.update({ lastSaveError: this.saveErrors.values().next().value || "" });
      return value;
    }).catch(error => {
      this.saveErrors.set(path, error instanceof Error ? error.message : String(error));
      this.update({ lastSaveError: this.saveErrors.values().next().value || "" });
      throw error;
    });
    this.writes = result.catch(() => undefined);
    return result;
  }

  async readFile(path: string): Promise<string> {
    const file = await this.execute<{ data: string; revision: string }>("readFile", path);
    this.revisions.set(path, file.revision);
    return file.data;
  }

  async writeFile(path: string, data: string): Promise<void> {
    return this.mutate(path, async () => {
      const file = await this.execute<{ revision: string }>("writeFile", path, { data, expectedRevision: this.revisions.get(path) ?? null });
      this.revisions.set(path, file.revision);
    });
  }

  async readSnapshot(path: string): Promise<StorageSnapshot | null> {
    try { return await this.execute<StorageSnapshot>("readFile", path); }
    catch (error) {
      if (error instanceof DesktopStorageError && error.code === "not_found") return null;
      throw error;
    }
  }

  async writeFileIfUnchanged(path: string, data: string, expectedRevision: string | null): Promise<void> {
    // Sync never advances the active editor's read revision or silently accepts a stale preview.
    await this.execute("writeFile", path, { data, expectedRevision });
  }

  async exists(path: string): Promise<boolean> { return this.execute("exists", path); }
  async readdir(path: string): Promise<string[]> { return this.execute("readdir", path); }
  async getFiles(path: string): Promise<string[]> { return this.execute("getFiles", path); }
  async getFolders(path: string): Promise<string[]> { return this.execute("getFolders", path); }
  async mkdir(path: string): Promise<void> { return this.mutate(path, () => this.execute("mkdir", path)); }
  async rename(path: string, name: string): Promise<void> {
    return this.mutate(path, async () => {
      await this.execute("rename", path, { name });
      this.moveRevisions(path, path.slice(0, path.lastIndexOf("/") + 1) + name);
    });
  }
  async mv(oldPath: string, newPath: string): Promise<void> {
    return this.mutate(oldPath, async () => {
      await this.execute("mv", oldPath, { destination: newPath });
      this.moveRevisions(oldPath, newPath.replace(/\/$/, "") + "/" + oldPath.split("/").pop());
    });
  }
  private moveRevisions(source: string, destination: string) {
    for (const [path, revision] of Array.from(this.revisions)) {
      if (path === source || path.startsWith(source + "/")) {
        this.revisions.delete(path);
        this.revisions.set(destination + path.slice(source.length), revision);
      }
    }
  }
  onChange(callback: (event: FileChangeEvent) => void): () => void {
    this.changes.add(callback);
    return () => { this.changes.delete(callback); };
  }

  private connectEvents() {
    if (this.disposed) return;
    try {
      const socket = new WebSocket(normalizeDesktopEndpoint(this.settings.endpoint).replace("http:", "ws:") + "/api/events");
      this.socket = socket;
      socket.onopen = () => socket.send(this.settings.token.trim());
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready" && message.protocolVersion === 1) {
            this.reconnectDelay = 2000;
            this.update({ connected: true, message: "本地程序已连接" });
            // Consumers should refresh lists after reconnect, but must not discard unsaved edits.
            for (const callback of this.changes) callback({ type: "tree-changed", fileId: "/" });
          } else if (message.type === "tree-changed" && typeof message.fileId === "string") {
            this.update({ lastChange: message.fileId });
            for (const callback of this.changes) callback(message);
          }
        } catch { /* Ignore malformed notifications. File operations still validate responses. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        this.update({ connected: false, message: "本地程序未连接，请检查服务、配对码及允许的网站。" });
        this.scheduleReconnect();
      };
    } catch {
      this.update({ connected: false, message: "无法连接本地程序，请检查地址及浏览器权限。" });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    this.reconnectTimer = setTimeout(() => this.connectEvents(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) { this.socket.onclose = null; this.socket.close(); }
    this.listeners.clear(); this.changes.clear();
  }
}
