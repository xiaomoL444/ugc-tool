import type { StorageClass } from "../../services/storage/storage";

export const CLIENT_UI_PROJECT_ID = "ClientUIAnimationEditor";
export const DEFAULT_UI_WORKSPACE = "默认工作区";

export interface ClientUIWorkspaceSelection {
  workspace: string;
  document: string;
}

type WorkspaceStorage = Pick<
  StorageClass,
  "setProject" | "exists" | "getFolders" | "getFiles" | "mkdir" |
  "readFile" | "writeFile" | "rename" | "trash" | "restore"
>;

function validateName(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}名称不能为空`);
  }
  const name = value.trim();
  if (name === "." || name === ".." || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(name) || name.endsWith(".")) {
    throw new Error(`${label}名称不能包含路径、控制字符或系统保留字符`);
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
    throw new Error(`${label}名称不能使用系统保留名称`);
  }
  return name;
}

export function validateWorkspaceName(name: string): string {
  return validateName(name, "工作区");
}

/** Document names are logical names without the storage-added .json suffix. */
export function validateDocumentName(name: string): string {
  return validateName(name, "编辑文件");
}

export function documentStoragePath(workspace: string, document: string): string {
  return `/${validateWorkspaceName(workspace)}/${validateDocumentName(document)}.json`;
}

function isValidName(name: string, validate: (name: string) => string): boolean {
  try {
    return validate(name) === name;
  } catch {
    return false;
  }
}

function sortNames(names: string[]): string[] {
  return names.sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
}

/** Uses the application's storage provider and recycle bin, never localStorage. */
export class ClientUIWorkspaceRepository {
  private mutations: Promise<void> = Promise.resolve();

  constructor(private readonly storage: WorkspaceStorage) {}

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation);
    // Keep later operations usable after a failed write or invalid request.
    this.mutations = result.then(() => undefined, () => undefined);
    return result;
  }

  private async requireWorkspace(workspace: string): Promise<void> {
    // setProject is mutable on the shared singleton: reset it at every call,
    // including calls made after an await or by a delayed save.
    const folders = await this.storage.setProject(CLIENT_UI_PROJECT_ID).getFolders("/");
    if (!folders.includes(workspace)) throw new Error(`工作区“${workspace}”不存在`);
  }

  private async requireDocument(workspace: string, document: string): Promise<void> {
    await this.requireWorkspace(workspace);
    const files = await this.storage.setProject(CLIENT_UI_PROJECT_ID).getFiles(`/${workspace}`);
    if (!files.includes(`${document}.json`)) throw new Error(`编辑文件“${document}”不存在`);
  }

  async listWorkspaces(): Promise<string[]> {
    await this.mutations;
    const folders = await this.storage.setProject(CLIENT_UI_PROJECT_ID).getFolders("/");
    return sortNames(folders.filter((name) => isValidName(name, validateWorkspaceName)));
  }

  async createWorkspace(requestedName: string): Promise<void> {
    const name = validateWorkspaceName(requestedName);
    return this.mutate(async () => {
      if (await this.storage.setProject(CLIENT_UI_PROJECT_ID).exists(`/${name}`)) {
        throw new Error(`已有同名工作区“${name}”`);
      }
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).mkdir(`/${name}`);
    });
  }

  async renameWorkspace(oldName: string, newName: string): Promise<void> {
    const oldWorkspace = validateWorkspaceName(oldName);
    const newWorkspace = validateWorkspaceName(newName);
    return this.mutate(async () => {
      await this.requireWorkspace(oldWorkspace);
      if (oldWorkspace === newWorkspace) return;
      if (await this.storage.setProject(CLIENT_UI_PROJECT_ID).exists(`/${newWorkspace}`)) {
        throw new Error(`已有同名工作区“${newWorkspace}”`);
      }
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).rename(`/${oldWorkspace}`, newWorkspace);
    });
  }

  async trashWorkspace(name: string): Promise<string> {
    const workspace = validateWorkspaceName(name);
    return this.mutate(async () => {
      await this.requireWorkspace(workspace);
      return this.storage.setProject(CLIENT_UI_PROJECT_ID).trash(`/${workspace}`);
    });
  }

  async listDocuments(name: string): Promise<string[]> {
    const workspace = validateWorkspaceName(name);
    await this.mutations;
    await this.requireWorkspace(workspace);
    const files = await this.storage.setProject(CLIENT_UI_PROJECT_ID).getFiles(`/${workspace}`);
    return sortNames(files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .filter((document) => isValidName(document, validateDocumentName)));
  }

  async readDocument(workspaceName: string, documentName: string): Promise<string> {
    const workspace = validateWorkspaceName(workspaceName);
    const document = validateDocumentName(documentName);
    await this.mutations;
    await this.requireDocument(workspace, document);
    return this.storage.setProject(CLIENT_UI_PROJECT_ID).readFile(documentStoragePath(workspace, document));
  }

  async createDocument(workspaceName: string, requestedName: string, serializedData: string): Promise<string> {
    const workspace = validateWorkspaceName(workspaceName);
    const baseName = validateDocumentName(requestedName);
    return this.mutate(async () => {
      await this.requireWorkspace(workspace);
      let document = baseName;
      let suffix = 2;
      while (await this.storage.setProject(CLIENT_UI_PROJECT_ID).exists(documentStoragePath(workspace, document))) {
        document = `${baseName} (${suffix++})`;
      }
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).writeFile(documentStoragePath(workspace, document), serializedData);
      return document;
    });
  }

  async writeDocument(workspaceName: string, documentName: string, serializedData: string): Promise<void> {
    const workspace = validateWorkspaceName(workspaceName);
    const document = validateDocumentName(documentName);
    return this.mutate(async () => {
      // BrowserStorage.writeFile creates missing parents. Check both kinds here
      // so a pending save cannot recreate a deleted workspace or document.
      await this.requireDocument(workspace, document);
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).writeFile(documentStoragePath(workspace, document), serializedData);
    });
  }

  async renameDocument(workspaceName: string, oldName: string, newName: string): Promise<void> {
    const workspace = validateWorkspaceName(workspaceName);
    const oldDocument = validateDocumentName(oldName);
    const newDocument = validateDocumentName(newName);
    return this.mutate(async () => {
      await this.requireDocument(workspace, oldDocument);
      if (oldDocument === newDocument) return;
      if (await this.storage.setProject(CLIENT_UI_PROJECT_ID).exists(documentStoragePath(workspace, newDocument))) {
        throw new Error(`已有同名编辑文件“${newDocument}”`);
      }
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).rename(documentStoragePath(workspace, oldDocument), `${newDocument}.json`);
    });
  }

  async trashDocument(workspaceName: string, documentName: string): Promise<string> {
    const workspace = validateWorkspaceName(workspaceName);
    const document = validateDocumentName(documentName);
    return this.mutate(async () => {
      await this.requireDocument(workspace, document);
      return this.storage.setProject(CLIENT_UI_PROJECT_ID).trash(documentStoragePath(workspace, document));
    });
  }

  /** originalRelativePath is the original full path, not its parent directory. */
  async restore(trashPath: string, originalRelativePath: string): Promise<void> {
    if (typeof trashPath !== "string" || !/^\/RecyleBin\/[A-Za-z0-9_-]+\/?$/.test(trashPath)) {
      throw new Error("无效的回收站路径");
    }
    if (typeof originalRelativePath !== "string" || !originalRelativePath.startsWith("/")) {
      throw new Error("无效的恢复目标路径");
    }
    const segments = originalRelativePath.slice(1).split("/");
    if (segments.length < 1 || segments.length > 2) throw new Error("无效的恢复目标路径");
    const workspace = validateWorkspaceName(segments[0]);
    let target = `/${workspace}`;
    let parent = "/";
    if (segments.length === 2) {
      if (!segments[1].endsWith(".json")) throw new Error("只能恢复 JSON 编辑文件");
      target = documentStoragePath(workspace, segments[1].slice(0, -5));
      parent = `/${workspace}`;
    }
    return this.mutate(async () => {
      if (segments.length === 2) await this.requireWorkspace(workspace);
      if (await this.storage.setProject(CLIENT_UI_PROJECT_ID).exists(target)) {
        throw new Error("恢复目标已存在，请先重命名同名项目");
      }
      // StorageClass.restore moves each recycled item's basename into parent.
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).restore(trashPath, parent);
    });
  }

  async readSelection(): Promise<ClientUIWorkspaceSelection | null> {
    await this.mutations;
    if (!(await this.storage.setProject(CLIENT_UI_PROJECT_ID).exists("/.selection.json"))) return null;
    const serialized = await this.storage.setProject(CLIENT_UI_PROJECT_ID).readFile("/.selection.json");
    let selection: ClientUIWorkspaceSelection;
    try {
      const value = JSON.parse(serialized);
      selection = {
        workspace: validateWorkspaceName(value?.workspace),
        document: value?.document === "" ? "" : validateDocumentName(value?.document),
      };
    } catch {
      return null;
    }
    const folders = await this.storage.setProject(CLIENT_UI_PROJECT_ID).getFolders("/");
    if (!folders.includes(selection.workspace)) return null;
    if (selection.document === "") return selection;
    const files = await this.storage.setProject(CLIENT_UI_PROJECT_ID).getFiles(`/${selection.workspace}`);
    return files.includes(`${selection.document}.json`) ? selection : null;
  }

  async writeSelection(value: ClientUIWorkspaceSelection): Promise<void> {
    const selection = {
      workspace: validateWorkspaceName(value?.workspace),
      document: value?.document === "" ? "" : validateDocumentName(value?.document),
    };
    return this.mutate(async () => {
      if (selection.document === "") await this.requireWorkspace(selection.workspace);
      else await this.requireDocument(selection.workspace, selection.document);
      await this.storage.setProject(CLIENT_UI_PROJECT_ID).writeFile("/.selection.json", JSON.stringify(selection));
    });
  }
}
