import { configureSingle, fs } from "@zenfs/core";
import { IndexedDB } from "@zenfs/dom";
import path from "path";
import type { StorageSnapshot, SyncStorageProvider } from "./types";

const browserWriteLock = "ugc-tools.browser-storage.write";
let initialization: Promise<void> | undefined;
let pendingWrite: Promise<unknown> = Promise.resolve();

async function revision(data: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function mutate<T>(action: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(browserWriteLock, action) : action();
  const result = pendingWrite.then(run);
  pendingWrite = result.catch(() => undefined);
  return result;
}

export class BrowserStorage implements SyncStorageProvider {
  readonly storageName = "本地浏览器缓存";

  async init(): Promise<void> {
    // Reuse the mount when the browser is already editing a project.
    initialization ??= configureSingle({ backend: IndexedDB }).catch(error => {
      initialization = undefined;
      throw error;
    });
    await initialization;
  }

  async isAvailable(): Promise<boolean> { return true; }
  async exists(filePath: string): Promise<boolean> { return fs.promises.exists(filePath); }
  async rename(filePath: string, newName: string): Promise<void> {
    await mutate(() => fs.promises.rename(filePath, path.join(path.dirname(filePath), newName)));
  }
  async mv(oldPath: string, newPath: string): Promise<void> {
    await mutate(async () => {
      await fs.promises.mkdir(newPath, { recursive: true });
      await fs.promises.rename(oldPath, path.join(newPath, path.basename(oldPath)));
    });
  }
  async getFolders(filePath: string): Promise<string[]> {
    if (!(await this.exists(filePath))) return [];
    return (await fs.promises.readdir(filePath, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  }
  async getFiles(filePath: string): Promise<string[]> {
    if (!(await this.exists(filePath))) return [];
    return (await fs.promises.readdir(filePath, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
  }
  async readdir(filePath: string): Promise<string[]> { return fs.promises.readdir(filePath); }
  async mkdir(filePath: string): Promise<void> {
    await mutate(async () => { await fs.promises.mkdir(filePath, { recursive: true }); });
  }
  async ensureDir(filePath: string): Promise<void> { await this.mkdir(path.dirname(filePath)); }
  async readFile(filePath: string): Promise<string> { return fs.promises.readFile(filePath, "utf8"); }
  async writeFile(filePath: string, data: string): Promise<void> {
    await mutate(async () => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, data, "utf8");
    });
  }

  async readSnapshot(filePath: string): Promise<StorageSnapshot | null> {
    try {
      const data = await this.readFile(filePath);
      return { data, revision: await revision(data) };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  }

  async writeFileIfUnchanged(filePath: string, data: string, expectedRevision: string | null): Promise<void> {
    await mutate(async () => {
      const before = await this.readSnapshot(filePath);
      if ((before?.revision ?? null) !== expectedRevision) throw new Error("浏览器文件已变化，请重新比较：" + filePath);
      if (before?.data === data) return;
      if (before) {
        const backup = "/.ugc-sync-backups/" + crypto.randomUUID() + filePath;
        await fs.promises.mkdir(path.dirname(backup), { recursive: true });
        await fs.promises.writeFile(backup, before.data, "utf8");
      }
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, data, "utf8");
    });
  }
}
