import { configure, configureSingle, fs } from "@zenfs/core"; // You can also use the default export
import { FileChangeEvent, StorageProvider } from "./types";
import { IndexedDB } from "@zenfs/dom";
import { consola } from "consola";
import path from "path";
// const localStorageKey = "xiaomoL444's Storage";

export class BrowserStorage implements StorageProvider {
  storageName: string;

  constructor() {
    this.storageName = "本地浏览器缓存";
  }
  async rename(filePath: string, newName: string): Promise<void> {
    const dir = path.dirname(filePath);
    const newPath = `${dir}/${newName}`;
    await fs.promises.rename(filePath, newPath);
  }
  async mv(oldPath: string, newPath: string): Promise<void> {
    await this.ensureDir(newPath);

    // 取原文件名/文件夹名
    const name = path.basename(oldPath);

    // 拼接成目标路径
    const dest = path.join(newPath, name);

    // 确保目标父目录存在
    await this.ensureDir(dest);

    await fs.promises.rename(oldPath, dest);
    return;
  }

  async exists(path: string): Promise<boolean> {
    return fs.promises.exists(path);
  }
  async init(): Promise<void> {
    consola.debug("初始化本地浏览器储存");
    await configureSingle({ backend: IndexedDB });
  }
  async getFolders(path: string): Promise<string[]> {
    if (!(await this.exists(path))) return [];
    const entries = await fs.promises.readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
  async getFiles(path: string): Promise<string[]> {
    if (!(await this.exists(path))) return [];
    const entries = fs.readdirSync(path, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async mkdir(path: string): Promise<void> {
    fs.mkdirSync(path, { recursive: true });
  }
  async writeFile(path: string, data: string): Promise<void> {
    this.ensureDir(path);
    fs.writeFileSync(path, data);
  }
  async readFile(path: string): Promise<string> {
    return fs.readFileSync(path, "utf8");
  }
  async readdir(path: string): Promise<string[]> {
    return fs.readdirSync(path);
  }
  onChange?(cb: (e: FileChangeEvent) => void): void {
    // throw new Error("Method not implemented.");
  }

  async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await this.mkdir(dir);
  }
}
