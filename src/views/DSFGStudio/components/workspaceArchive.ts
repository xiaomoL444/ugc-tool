import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../constant/constant";
import { workspaceNameError } from "./workspaceSettings";

export interface WorkspaceEntry {
  name: string;
  content: string | WorkspaceEntry[];
}

export function validateWorkspaceEntries(entries: WorkspaceEntry[]): void {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.name.endsWith(" ") || workspaceNameError(entry.name, [])) {
      throw new Error("工作区备份包含无效的文件或目录名。");
    }
    const key = entry.name.toLowerCase();
    if (names.has(key)) throw new Error(`工作区备份中存在重名文件或目录「${entry.name}」。`);
    names.add(key);
    if (Array.isArray(entry.content)) validateWorkspaceEntries(entry.content);
  }
}

export async function collectWorkspaceArchive(storage: StorageClass, name: string): Promise<WorkspaceEntry[]> {
  const project = () => storage.setProject(ProjectID);
  async function collect(path: string): Promise<WorkspaceEntry[]> {
    const entries: WorkspaceEntry[] = [];
    for (const name of await project().getFolders(path)) {
      entries.push({ name, content: await collect(`${path}/${name}`) });
    }
    for (const name of await project().getFiles(path)) {
      entries.push({ name, content: await project().readFile(`${path}/${name}`) });
    }
    return entries;
  }
  if (!await project().exists(`/${name}`)) throw new Error("要导出的工作区已不存在。");
  const entries = await collect(`/${name}`);
  validateWorkspaceEntries(entries);
  return entries;
}

export async function restoreWorkspaceArchive(storage: StorageClass, name: string, entries: WorkspaceEntry[]): Promise<void> {
  const project = () => storage.setProject(ProjectID);
  const nameError = workspaceNameError(name, await project().getFolders("/"));
  if (nameError) throw new Error(nameError);
  async function writeEntries(path: string, entries: WorkspaceEntry[]) {
    for (const { name, content } of entries) {
      const child = `${path}/${name}`;
      if (typeof content === "string") await project().writeFile(child, content);
      else {
        await project().mkdir(child);
        await writeEntries(child, content);
      }
    }
  }
  // Publish only after every file was written. A concurrent create cannot be overwritten.
  const staging = `/.dsfg-import-${crypto.randomUUID()}`;
  await project().mkdir(staging);
  try {
    await writeEntries(staging, entries);
    await project().rename(staging, name, { noReplace: true });
  } catch (error) {
    await project().trash(staging);
    throw error;
  }
}
