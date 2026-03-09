// src/services/storage/Storage.ts

import { consola } from "consola";
import { BrowserStorage } from "./browserStorage";
import { FileChangeEvent, StorageProvider } from "./types";

export class StorageClass {
  private static instance: StorageClass;

  private providers: StorageProvider[] = [];
  private activeProvider!: StorageProvider;

  private projectId: string = ""; //项目id

  // 事件回调列表
  private changeCallbacks: Set<(e: FileChangeEvent) => void> = new Set();

  private constructor() {
    // 按顺序添加 Provider
    this.providers = [
      new BrowserStorage(), // 兜底
    ];
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
    for (const p of this.providers) {
      consola.info(`加载储存${p.storageName}中...`);
      await p.init();
      if (await p.isAvailable()) {
        this.activeProvider = p;
        consola.info(`加载${p.storageName}成功`);
        return;
      }
      consola.warn(`加载${p.storageName}失败`);
    }
    throw new Error("No storage provider available");
  }

  public assemblyPath(path: string): string {
    return `/${this.projectId}${path}`;
  }

  public async rename(filePath: string, newName: string): Promise<void> {
    filePath = this.assemblyPath(filePath);
    consola.trace(filePath)
    consola.trace(newName)
    return this.withProviderRetry(
      async (provider) => await provider.rename(filePath, newName),
    );
  }

  public async exists(path: string): Promise<boolean> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(
      async (provider) => await provider.exists(path),
    );
  }

  // 获取目录
  public async getFolders(path: string): Promise<string[]> {
    path = this.assemblyPath(path);
    return (
      this.withProviderRetry(
        async (provider) => await provider.getFolders(path),
      ) ?? []
    );
  }

  // 获取文件
  public async getFiles(path: string): Promise<string[]> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(
      async (provider) => await provider.getFiles(path),
    );
  }

  // 创建目录
  public async mkdir(path: string): Promise<void> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(
      async (provider) => await provider.mkdir(path),
    );
  }

  // 写文件
  public async writeFile(path: string, data: string): Promise<void> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(
      async (provider) => await provider.writeFile(path, data),
    );
  }

  // 读文件
  public async readFile(path: string): Promise<string> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(
      async (provider) => await provider.readFile(path),
    );
  }

  // 读取目录
  public async readdir(path: string): Promise<string[]> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(
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

  private async withProviderRetry<T>(
    fn: (provider: StorageProvider) => Promise<T>,
  ) {
    try {
      return await fn(this.activeProvider);
    } catch (err) {
      consola.warn("Active provider failed, switching...", err);
      await this.switchProvider();
      return fn(this.activeProvider);
    }
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
    for (const p of this.providers) {
      if (p !== this.activeProvider && (await p.isAvailable())) {
        this.activeProvider = p;
        if (p.onChange) p.onChange((e) => this.emitChange(e));
        return;
      }
    }
    throw new Error("No other storage provider available");
  }

  //自定义函数
  /**
   * 将路径丢回垃圾箱
   * @param path 需要删除的路径
   * @returns 返回一个原本文件在垃圾桶的路径，然后通过这个路径可以复制回来
   */
  public async trash(path: string): Promise<string> {
    path = this.assemblyPath(path);
    return this.withProviderRetry(async (provider) => {
      const uuid = crypto.randomUUID();
      const trashPath = `/RecyleBin/${uuid}/`;
      await provider.mv(path, trashPath);
      return trashPath;
    });
  }
  public async restore(trashPath: string, originalPath: string): Promise<void> {
    originalPath = this.assemblyPath(originalPath);
    return this.withProviderRetry(async (provider) => {
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
