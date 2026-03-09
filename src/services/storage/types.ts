export type FileType = "group" | "file";

export interface FileNode {
  id: string; //文件id全局唯一，如果是磁盘文件，理应是路径
  name: string;
  type: FileType;
  createAt: number;
  children?: string[]; //只有Group有
  parentId?: string;
}
export interface FileNodeTree {
  id: string;
  children?: FileNodeTree[];
}
export interface FileContent {
  id: string; //文件的id
  content: string;
  updateAt: number;
}

export type FileChangeType =
  | "file-content"
  | "node-create"
  | "node-updated"
  | "node-deleted"
  | "tree-changed";

export interface FileChangeEvent {
  type: FileChangeType;
  fileId: string; //更新的文件id
}

export interface StorageProvider {
  storageName: string;
  init(): Promise<void>;
  isAvailable(): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  getFolders(path: string): Promise<string[]>;
  getFiles(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mv(oldPath: string, newPath: string): Promise<void>;
  rename(path:string,name:string):Promise<void>;
  onChange?(cb: (e: FileChangeEvent) => void): void;
}
