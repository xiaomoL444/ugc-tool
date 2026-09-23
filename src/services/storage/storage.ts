// src/services/storage/Storage.ts

import { consola } from "consola";
import { BrowserStorage } from "./browserStorage";
import { DesktopStorage, readStorageSettings } from "./desktopStorage";
import { FileChangeEvent, StorageProvider } from "./types";

export class StorageClass {
  private static instance: StorageClass;

  private activeProvider!: StorageProvider;
  private syncPaused = false;
  private readonly pendingOperations = new Set<Promise<unknown>>();

  private projectId: string = ""; //项目id

  // 事件回调列表
  private changeCallbacks: Set<(e: FileChangeEvent) => void> = new Set();

  private constructor() {
    const settings = readStorageSettings();
    this.activeProvider = settings.mode === "desktop"
      ? new DesktopStorage(settings) : new BrowserStorage();
  }

  public get provider(): StorageProvider { return this.activeProvider; }

  public async pauseForSync(): Promise<() => void> {
    if (this.syncPaused) throw new Error("同步已锁定当前页面，请刷新页面后继续。");
    this.syncPaused = true;
    const results = await Promise.allSettled([...this.pendingOperations]);
    if (results.some(result => result.status === "rejected")) {
      this.syncPaused = false;
      throw new Error("当前编辑器仍有保存失败的操作，请先保存或导出，再执行同步。");
    }
    return () => { this.syncPaused = false; };
  }
  //设置项目与工作区区域
  setProject(projectId: string): this {
    this.projectId = projectId;
    return this;
  }

  // 单例获取
  public static getInstance() {
    if (!StorageClass.instance) {
      StorageClass.instance = new StorageClass();
    }
    return StorageClass.instance;
  }

  // 初始化，选择可用 Provider
  public async init() {
    await this.activeProvider.init();
    this.activeProvider.onChange?.((event) => this.emitChange(event));
    consola.info(`加载${this.activeProvider.storageName}成功`);
  }

  public assemblyPath(path: string): string {
    return `/${this.projectId}${path}`;
  }

  public async rename(filePath: string, newName: string): Promise<void> {
    filePath = this.assemblyPath(filePath);
    consola.trace(filePath)
    consola.trace(newName)
    return this.withProvider(
      async (provider) => await provider.rename(filePath, newName),
    );
  }

  public async exists(path: string): Promise<boolean> {
    path = this.assemblyPath(path);
    return this.withProvider(
      async (provider) => await provider.exists(path),
    );
  }

  // 获取目录
  public async getFolders(path: string): Promise<string[]> {
    path = this.assemblyPath(path);
    return (
      this.withProvider(
        async (provider) => await provider.getFolders(path),
      ) ?? []
    );
  }

  // 获取文件
  public async getFiles(path: string): Promise<string[]> {
    path = this.assemblyPath(path);
    return this.withProvider(
      async (provider) => await provider.getFiles(path),
    );
  }

  // 创建目录
  public async mkdir(path: string): Promise<void> {
    path = this.assemblyPath(path);
    return this.withProvider(
      async (provider) => await provider.mkdir(path),
    );
  }

  // 写文件
  public async writeFile(path: string, data: string): Promise<void> {
    path = this.assemblyPath(path);
    return this.withProvider(
      async (provider) => await provider.writeFile(path, data),
    );
  }

  // 读文件
  public async readFile(path: string): Promise<string> {
    path = this.assemblyPath(path);
    return this.withProvider(
      async (provider) => await provider.readFile(path),
    );
  }

  // 读取目录
  public async readdir(path: string): Promise<string[]> {
    path = this.assemblyPath(path);
    return this.withProvider(
      async (provider) => await provider.readdir(path),
    );
  }

  // 页面注册 onChange
  public onChange(cb: (e: FileChangeEvent) => void) {
    this.changeCallbacks.add(cb);
    // 返回一个取消订阅函数
    return () => {
      this.changeCallbacks.delete(cb);
    };
  }

  private async withProvider<T>(
    fn: (provider: StorageProvider) => Promise<T>,
  ) {
    if (this.syncPaused) throw new StorageSyncPausedError();
    const operation = fn(this.activeProvider);
    this.pendingOperations.add(operation);
    try { return await operation; }
    finally { this.pendingOperations.delete(operation); }
  }

  // StorageClass 内部调用
  private emitChange(e: FileChangeEvent) {
    for (const cb of this.changeCallbacks) {
      try {
        cb(e);
      } catch (err) {
        console.error(err);
      }
    }
  }
  public async switchProvider() {
    throw new Error("请通过存储设置切换存档位置，保存设置后重新加载页面。");
  }

  //自定义函数
  /**
   * 将路径丢回垃圾箱
   * @param path 需要删除的路径
   * @returns 返回一个原本文件在垃圾桶的路径，然后通过这个路径可以复制回来
   */
  public async trash(path: string): Promise<string> {
    path = this.assemblyPath(path);
    return this.withProvider(async (provider) => {
      const uuid = crypto.randomUUID();
      const trashPath = `/RecyleBin/${uuid}/`;
      await provider.mv(path, trashPath);
      return trashPath;
    });
  }
  public async restore(trashPath: string, originalPath: string): Promise<void> {
    originalPath = this.assemblyPath(originalPath);
    return this.withProvider(async (provider) => {
      const files = await provider.readdir(trashPath);
      consola.trace(originalPath);
      await Promise.all(
        files.map(async (path) => {
          await provider.mv(`${trashPath}/${path}`, originalPath);
        }),
      );
      return;
    });
  }
}

export class StorageSyncPausedError extends Error {
  constructor() { super("存档同步期间已暂停编辑器读写，请在同步完成后刷新页面。"); }
}
