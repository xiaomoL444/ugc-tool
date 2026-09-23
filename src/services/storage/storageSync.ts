import type { StorageSnapshot, SyncStorageProvider } from "./types";

export type SyncDirection = "both" | "to-desktop" | "to-browser";
export type SyncChoice = "skip" | "browser" | "desktop";
export type SyncEntry = { kind: "folder" } | ({ kind: "file" } & StorageSnapshot);
export interface SyncRow {
  path: string;
  browser?: SyncEntry;
  desktop?: SyncEntry;
  status: "same" | "browser-only" | "desktop-only" | "conflict" | "blocked";
  choice: SyncChoice;
}
export interface SyncAction { path: string; from: "browser" | "desktop"; source: SyncEntry; target?: SyncEntry }
export interface SyncResult { completed: number; total: number; cancelled: boolean; error?: string; failedPath?: string }

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消比较。");
}

function validName(name: string): boolean {
  return !!name && name !== "." && name !== ".." && !/[<>:"/\\|?*\u0000-\u001f]/.test(name)
    && !/[. ]$/.test(name) && !/^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(name);
}

export async function compareStorage(
  browser: SyncStorageProvider, desktop: SyncStorageProvider,
  onProgress?: (path: string) => void, signal?: AbortSignal,
): Promise<SyncRow[]> {
  let bytes = 0;
  const canonicalPaths = new Map<string, string>();
  async function scan(provider: SyncStorageProvider): Promise<Map<string, SyncEntry>> {
    const entries = new Map<string, SyncEntry>();
    const queue = ["/"];
    while (queue.length) {
      checkCancelled(signal);
      const folder = queue.shift()!;
      const folders = await provider.getFolders(folder);
      const files = await provider.getFiles(folder);
      for (const name of [...folders, ...files]) {
        checkCancelled(signal);
        if (name.toLowerCase().startsWith(".ugc-") || (folder === "/" && name.toLowerCase() === "recylebin")) continue;
        const path = (folder === "/" ? "" : folder) + "/" + name;
        if (!validName(name)) throw new Error(`文件名不兼容 Windows，请先重命名：${path}`);
        const key = path.toUpperCase();
        const previous = canonicalPaths.get(key);
        if (previous && previous !== path) throw new Error(`路径仅大小写不同，请先统一名称：${previous} / ${path}`);
        canonicalPaths.set(key, path);
        if (entries.has(path)) throw new Error(`比较期间目录发生变化，请重新比较：${path}`);
        if (path.split("/").length > 100 || entries.size >= 5000) throw new Error("存档过多或目录过深，请分批整理后再同步（每侧最多 5000 项）。");
        onProgress?.(path);
        if (folders.includes(name)) {
          entries.set(path, { kind: "folder" }); queue.push(path);
        } else {
          const snapshot = await provider.readSnapshot(path);
          if (!snapshot) throw new Error(`比较期间文件发生变化，请重新比较：${path}`);
          bytes += new TextEncoder().encode(snapshot.data).byteLength;
          if (bytes > 128 * 1024 * 1024) throw new Error("本次比较超过 128 MiB，请先分批整理存档。");
          entries.set(path, { kind: "file", ...snapshot });
        }
      }
    }
    return entries;
  }
  const left = await scan(browser);
  const right = await scan(desktop);
  const rows: SyncRow[] = [];
  const blocked: string[] = [];
  for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const browserEntry = left.get(path), desktopEntry = right.get(path);
    let status: SyncRow["status"];
    if (blocked.some(parent => path.startsWith(parent + "/")) ||
        (browserEntry && desktopEntry && browserEntry.kind !== desktopEntry.kind)) {
      status = "blocked"; blocked.push(path);
    } else if (!desktopEntry) status = "browser-only";
    else if (!browserEntry) status = "desktop-only";
    else if (browserEntry.kind === "folder" || (desktopEntry.kind === "file" && browserEntry.data === desktopEntry.data)) status = "same";
    else status = "conflict";
    rows.push({ path, browser: browserEntry, desktop: desktopEntry, status, choice: "skip" });
  }
  return rows;
}

export function planSync(rows: SyncRow[], direction: SyncDirection): SyncAction[] {
  const actions: SyncAction[] = [];
  for (const row of rows) {
    let from: SyncChoice = "skip";
    if (row.status === "browser-only" && direction !== "to-browser") from = "browser";
    if (row.status === "desktop-only" && direction !== "to-desktop") from = "desktop";
    if (row.status === "conflict") {
      if ((row.choice === "browser" && direction !== "to-browser") || (row.choice === "desktop" && direction !== "to-desktop")) from = row.choice;
    }
    if (from !== "skip") actions.push({ path: row.path, from, source: row[from]!, target: row[from === "browser" ? "desktop" : "browser"] });
  }
  return actions.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
}

async function inspect(provider: SyncStorageProvider, path: string): Promise<SyncEntry | undefined> {
  if (!await provider.exists(path)) return undefined;
  const parent = path.slice(0, path.lastIndexOf("/")) || "/";
  const name = path.slice(path.lastIndexOf("/") + 1);
  if ((await provider.getFolders(parent)).includes(name)) return { kind: "folder" };
  const snapshot = await provider.readSnapshot(path);
  return snapshot ? { kind: "file", ...snapshot } : undefined;
}

function sameVersion(a?: SyncEntry, b?: SyncEntry): boolean {
  return a?.kind === b?.kind && (a?.kind !== "file" || (b?.kind === "file" && a.revision === b.revision));
}

export async function executeSync(
  actions: SyncAction[], browser: SyncStorageProvider, desktop: SyncStorageProvider,
  onProgress?: (completed: number, path: string) => void, signal?: AbortSignal,
): Promise<SyncResult> {
  let completed = 0;
  for (const action of actions) {
    if (signal?.aborted) return { completed, total: actions.length, cancelled: true };
    try {
      const source = action.from === "browser" ? browser : desktop;
      const target = action.from === "browser" ? desktop : browser;
      if (!sameVersion(await inspect(source, action.path), action.source) || !sameVersion(await inspect(target, action.path), action.target))
        throw new Error("文件已在预览后变化，已停止同步，请重新比较。");
      if (signal?.aborted) return { completed, total: actions.length, cancelled: true };
      if (action.source.kind === "folder") await target.mkdir(action.path);
      else await target.writeFileIfUnchanged(action.path, action.source.data, action.target?.kind === "file" ? action.target.revision : null);
      completed++;
      onProgress?.(completed, action.path);
    } catch (error) {
      return { completed, total: actions.length, cancelled: false, failedPath: action.path, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { completed, total: actions.length, cancelled: false };
}
