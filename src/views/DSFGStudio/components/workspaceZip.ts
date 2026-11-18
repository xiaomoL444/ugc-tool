import type JSZip from "jszip";
import { validateWorkspaceEntries, type WorkspaceEntry } from "./workspaceArchive";
import { workspaceNameError } from "./workspaceSettings";

// Older readers use this export marker to preserve a single top-level directory.
const flatWorkspaceComment = "DSFG workspace ZIP v2";
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export async function zipWorkspace(entries: WorkspaceEntry[]): Promise<Blob> {
  const { default: Zip } = await import("jszip");
  const zip = new Zip();
  function addEntries(folder: JSZip, children: WorkspaceEntry[]) {
    for (const { name, content } of children) {
      if (typeof content === "string") folder.file(name, content);
      else addEntries(folder.folder(name)!, content);
    }
  }
  addEntries(zip, entries);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", comment: flatWorkspaceComment });
}

export async function readWorkspaceZip(file: File): Promise<WorkspaceEntry[]> {
  if (!/\.zip$/i.test(file.name)) throw new Error("请选择 .zip 格式的工作区备份。");
  const { default: Zip } = await import("jszip");
  const bytes = await file.arrayBuffer();
  let zip: JSZip;
  try { zip = await Zip.loadAsync(bytes, { checkCRC32: true }); }
  catch { throw new Error("无法读取 ZIP 备份，请确认压缩包完整后重试。"); }

  const root: WorkspaceEntry[] = [];
  const directories = new Map<string, WorkspaceEntry[]>([["", root]]);
  for (const entry of Object.values(zip.files)) {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw new Error("ZIP 包含无效的文件路径。");
    const parts = (entry.dir ? entry.name.replace(/\/$/, "") : entry.name).split("/");
    if (parts.some(name => !name || name.endsWith(" ") || workspaceNameError(name, []))) {
      throw new Error("工作区包含无效的文件或目录名。");
    }
    const fileName = entry.dir ? undefined : parts.pop();
    let path = "", parent = root;
    for (const name of parts) {
      path += "/" + name;
      let children = directories.get(path);
      if (!children) {
        children = [];
        parent.push({ name, content: children });
        directories.set(path, children);
      }
      parent = children;
    }
    if (fileName) {
      const data = await entry.async("uint8array");
      let content: string;
      try { content = utf8.decode(data); }
      catch { throw new Error(`「${entry.name}」不是工作区支持的 UTF-8 文本文件。`); }
      parent.push({ name: fileName, content });
    }
  }
  validateWorkspaceEntries(root);
  return root;
}
