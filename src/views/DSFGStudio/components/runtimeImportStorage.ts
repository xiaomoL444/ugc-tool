interface ImportStorage {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<unknown>;
}
/** Call with the editor's busy flag held and a storage provider scoped to its captured workspace. */
export async function commitRuntimeImport<T>(options: {
  file: Pick<File, "name" | "size" | "text">;
  decode: (text: string) => T;
  encode: (project: T) => string;
  storage: ImportStorage;
  active: () => boolean;
  flush: () => Promise<unknown>;
  directory?: string;
  overwrite?: { path: string; backupDirectory: string; confirm: () => boolean };
}) {
  const { file, storage, active, overwrite } = options;
  if (file.size > 20 * 1024 * 1024) throw new Error("配置文件超过 20 MB，请检查文件是否正确");
  const text = await file.text(); if (!active()) return;
  const project = options.decode(text);
  const encoded = options.encode(project);
  if (overwrite && !overwrite.confirm()) return;
  await options.flush(); if (!active()) return;
  let path: string, name = "";
  if (overwrite) {
    path = overwrite.path;
    const exists = await storage.exists(path); if (!active()) return;
    if (exists) {
      const previous = await storage.readFile(path); if (!active()) return;
      await storage.writeFile(`${overwrite.backupDirectory}/${crypto.randomUUID()}.json`, previous);
      if (!active()) return;
    }
  } else {
    const base = file.name.replace(/\.json$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 120) || "导入配置";
    name = `${base}.json`;
    let suffix = 1;
    while (await storage.exists(`${options.directory}/${name}`)) {
      if (!active()) return;
      name = `${base} (${suffix++}).json`;
    }
    if (!active()) return;
    path = `${options.directory}/${name}`;
  }
  await storage.writeFile(path, encoded);
  if (!active()) return;
  return { project, name, path };
}
