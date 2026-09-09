/* Run with: node scripts/test-client-ui-workspace-storage.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const previousExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

const normalize = (value) => path.posix.normalize(value).replace(/\/$/, "") || "/";
const parent = (value) => path.posix.dirname(value);
const basename = (value) => path.posix.basename(value);
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

/** Captures the namespace synchronously like StorageClass, then switches pages. */
class MemoryStorage {
  constructor() {
    this.projectId = "AnotherPage";
    this.folders = new Set(["/"]);
    this.files = new Map();
    this.calls = [];
    this.trashId = 0;
    this.beforeOperation = null;
  }

  setProject(projectId) { this.projectId = projectId; return this; }

  operation(method, relativePath, callback) {
    const projectId = this.projectId;
    const absolutePath = normalize(`/${projectId}${relativePath}`);
    this.calls.push({ method, projectId, path: absolutePath });
    const gate = this.beforeOperation?.(method, absolutePath);
    // This happens before the repository continues after awaiting any call.
    this.projectId = "AnotherPage";
    return Promise.resolve(gate).then(() => callback(absolutePath));
  }

  ensureFolder(value) {
    let current = normalize(value);
    while (!this.folders.has(current)) {
      this.folders.add(current);
      current = parent(current);
    }
  }

  exists(value) {
    return this.operation("exists", value, (absolute) => this.folders.has(absolute) || this.files.has(absolute));
  }

  getFolders(value) {
    return this.operation("getFolders", value, (absolute) => [...this.folders]
      .filter((folder) => folder !== absolute && parent(folder) === absolute).map(basename));
  }

  getFiles(value) {
    return this.operation("getFiles", value, (absolute) => [...this.files.keys()]
      .filter((file) => parent(file) === absolute).map(basename));
  }

  mkdir(value) { return this.operation("mkdir", value, (absolute) => this.ensureFolder(absolute)); }

  writeFile(value, data) {
    return this.operation("writeFile", value, (absolute) => {
      this.ensureFolder(parent(absolute));
      if (this.folders.has(absolute)) throw new Error("EISDIR");
      this.files.set(absolute, data);
    });
  }

  readFile(value) {
    return this.operation("readFile", value, (absolute) => {
      if (!this.files.has(absolute)) throw new Error("ENOENT");
      return this.files.get(absolute);
    });
  }

  move(source, destination) {
    if (!this.files.has(source) && !this.folders.has(source)) throw new Error("ENOENT");
    if (this.files.has(destination) || this.folders.has(destination)) throw new Error("EEXIST");
    this.ensureFolder(parent(destination));
    for (const [file, data] of [...this.files]) {
      if (file === source || file.startsWith(`${source}/`)) {
        this.files.delete(file);
        this.files.set(destination + file.slice(source.length), data);
      }
    }
    for (const folder of [...this.folders]) {
      if (folder === source || folder.startsWith(`${source}/`)) {
        this.folders.delete(folder);
        this.folders.add(destination + folder.slice(source.length));
      }
    }
  }

  rename(value, name) {
    return this.operation("rename", value, (absolute) => this.move(absolute, `${parent(absolute)}/${name}`));
  }

  trash(value) {
    return this.operation("trash", value, (absolute) => {
      const trashPath = `/RecyleBin/item-${++this.trashId}/`;
      this.move(absolute, `${trashPath}${basename(absolute)}`);
      return trashPath;
    });
  }

  restore(trashPath, destination) {
    return this.operation("restore", destination, (absolute) => {
      const trashFolder = normalize(trashPath);
      const entries = [...this.files.keys(), ...this.folders]
        .filter((entry) => entry !== trashFolder && parent(entry) === trashFolder);
      if (!entries.length) throw new Error("ENOENT");
      for (const entry of entries) this.move(entry, normalize(`${absolute}/${basename(entry)}`));
    });
  }
}

async function main() {
  const {
    ClientUIWorkspaceRepository,
    CLIENT_UI_PROJECT_ID,
    DEFAULT_UI_WORKSPACE,
    validateWorkspaceName,
    validateDocumentName,
    documentStoragePath,
  } = require(path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/workspaceStorage.ts"));
  let passed = 0;
  const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
  const fixture = () => { const storage = new MemoryStorage(); return { storage, repository: new ClientUIWorkspaceRepository(storage) }; };
  const setup = async () => {
    const value = fixture();
    await value.repository.createWorkspace(DEFAULT_UI_WORKSPACE);
    return value;
  };

  await test("Every operation reselects the UI namespace after asynchronous page changes", async () => {
    const { storage, repository } = await setup();
    const name = await repository.createDocument(DEFAULT_UI_WORKSPACE, "对话", '{"nodes":[]}');
    await repository.writeDocument(DEFAULT_UI_WORKSPACE, name, '{"nodes":[1]}');
    await repository.writeSelection({ workspace: DEFAULT_UI_WORKSPACE, document: name });
    assert.equal(await repository.readDocument(DEFAULT_UI_WORKSPACE, name), '{"nodes":[1]}');
    assert.deepEqual(await repository.listWorkspaces(), [DEFAULT_UI_WORKSPACE]);
    assert.deepEqual(await repository.listDocuments(DEFAULT_UI_WORKSPACE), ["对话"]);
    assert.deepEqual(await repository.readSelection(), { workspace: DEFAULT_UI_WORKSPACE, document: "对话" });
    assert.ok(storage.calls.length > 15);
    assert.ok(storage.calls.every((call) => call.projectId === CLIENT_UI_PROJECT_ID));
    assert.ok([...storage.files.keys()].every((file) => file.startsWith(`/${CLIENT_UI_PROJECT_ID}/`)));
    assert.equal(storage.folders.has("/AnotherPage"), false);
  });

  await test("Importing the same GIA twice creates separate documents without overwriting", async () => {
    const { repository } = await setup();
    assert.equal(await repository.createDocument(DEFAULT_UI_WORKSPACE, "测试任务View", "first GIA"), "测试任务View");
    assert.equal(await repository.createDocument(DEFAULT_UI_WORKSPACE, "测试任务View", "second GIA"), "测试任务View (2)");
    assert.equal(await repository.readDocument(DEFAULT_UI_WORKSPACE, "测试任务View"), "first GIA");
    assert.equal(await repository.readDocument(DEFAULT_UI_WORKSPACE, "测试任务View (2)"), "second GIA");
  });

  await test("Concurrent imports serialize name allocation and preserve every imported file", async () => {
    const { repository } = await setup();
    const names = await Promise.all([1, 2, 3].map((index) => repository.createDocument(DEFAULT_UI_WORKSPACE, "View", `GIA ${index}`)));
    assert.deepEqual(names, ["View", "View (2)", "View (3)"]);
    assert.deepEqual(await Promise.all(names.map((name) => repository.readDocument(DEFAULT_UI_WORKSPACE, name))), ["GIA 1", "GIA 2", "GIA 3"]);
  });

  await test("Workspace and document renaming reject collisions and keep old data intact", async () => {
    const { repository } = await setup();
    await repository.createWorkspace("其他工作区");
    await assert.rejects(repository.createWorkspace(DEFAULT_UI_WORKSPACE), /同名/);
    await assert.rejects(repository.renameWorkspace(DEFAULT_UI_WORKSPACE, "其他工作区"), /同名/);
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "first", "one");
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "second", "two");
    await assert.rejects(repository.renameDocument(DEFAULT_UI_WORKSPACE, "first", "second"), /同名/);
    await repository.renameDocument(DEFAULT_UI_WORKSPACE, "first", "renamed");
    await repository.renameWorkspace(DEFAULT_UI_WORKSPACE, "重命名工作区");
    assert.equal(await repository.readDocument("重命名工作区", "renamed"), "one");
    assert.equal(await repository.readDocument("重命名工作区", "second"), "two");
    await repository.renameWorkspace("重命名工作区", "重命名工作区");
    await repository.renameDocument("重命名工作区", "renamed", "renamed");
  });

  await test("Blank, cancelled, traversal, control, and reserved names never reach storage", async () => {
    const { storage, repository } = fixture();
    const invalid = [null, undefined, "", "  ", ".", "..", "../other", "a/b", "a\\b", "a\nname", "a\u0000b", "a:b", "a*b", "a?b", "a<b", "a>b", 'a"b', "a|b", "trailing.", "CON", "nul.txt"];
    for (const name of invalid) {
      assert.throws(() => validateWorkspaceName(name));
      assert.throws(() => validateDocumentName(name));
      await assert.rejects(repository.createWorkspace(name));
      await assert.rejects(repository.createDocument("工作区", name, "never written"));
      await assert.rejects(repository.writeDocument(name, "doc", "never written"));
    }
    assert.equal(storage.calls.length, 0);
    assert.equal(validateWorkspaceName(" 工作区 "), "工作区");
    assert.equal(validateDocumentName(" 编辑文件 "), "编辑文件");
    assert.equal(documentStoragePath(" 工作区 ", "文件.json"), "/工作区/文件.json.json");
  });

  await test("Late saves refuse missing documents or workspaces instead of recreating them", async () => {
    const { storage, repository } = await setup();
    await assert.rejects(repository.writeDocument(DEFAULT_UI_WORKSPACE, "missing", "late"), /不存在/);
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "saved");
    await repository.trashDocument(DEFAULT_UI_WORKSPACE, "View");
    await assert.rejects(repository.writeDocument(DEFAULT_UI_WORKSPACE, "View", "late"), /不存在/);
    await repository.trashWorkspace(DEFAULT_UI_WORKSPACE);
    await assert.rejects(repository.writeDocument(DEFAULT_UI_WORKSPACE, "View", "late"), /不存在/);
    await assert.rejects(repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "late"), /不存在/);
    assert.equal(storage.folders.has(`/${CLIENT_UI_PROJECT_ID}/${DEFAULT_UI_WORKSPACE}`), false);
    assert.deepEqual(await repository.listWorkspaces(), []);
  });

  await test("An in-flight save finishes before trash, and queued later saves cannot revive the file", async () => {
    const { repository, storage } = await setup();
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "original");
    const started = deferred(), release = deferred();
    storage.beforeOperation = (method) => {
      if (method === "writeFile") { started.resolve(); return release.promise; }
      return undefined;
    };
    const saving = repository.writeDocument(DEFAULT_UI_WORKSPACE, "View", "latest");
    await started.promise;
    const deleting = repository.trashDocument(DEFAULT_UI_WORKSPACE, "View");
    const lateSave = assert.rejects(repository.writeDocument(DEFAULT_UI_WORKSPACE, "View", "too late"), /不存在/);
    release.resolve();
    await saving;
    const recycled = await deleting;
    await lateSave;
    storage.beforeOperation = null;
    assert.deepEqual(await repository.listDocuments(DEFAULT_UI_WORKSPACE), []);
    await repository.restore(recycled, documentStoragePath(DEFAULT_UI_WORKSPACE, "View"));
    assert.equal(await repository.readDocument(DEFAULT_UI_WORKSPACE, "View"), "latest");
  });

  await test("Documents and full workspaces use the shared recycle bin and restore to original paths", async () => {
    const { storage, repository } = await setup();
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "document data");
    const documentTrash = await repository.trashDocument(DEFAULT_UI_WORKSPACE, "View");
    assert.match(documentTrash, /^\/RecyleBin\//);
    assert.deepEqual(await repository.listDocuments(DEFAULT_UI_WORKSPACE), []);
    await repository.restore(documentTrash, documentStoragePath(DEFAULT_UI_WORKSPACE, "View"));
    const workspaceTrash = await repository.trashWorkspace(DEFAULT_UI_WORKSPACE);
    assert.deepEqual(await repository.listWorkspaces(), []);
    await repository.restore(workspaceTrash, `/${DEFAULT_UI_WORKSPACE}`);
    assert.equal(await repository.readDocument(DEFAULT_UI_WORKSPACE, "View"), "document data");
    assert.ok(storage.calls.filter((call) => call.method === "restore").every((call) => call.projectId === CLIENT_UI_PROJECT_ID));
  });

  await test("Restore refuses existing destinations, missing parents, and unsafe paths", async () => {
    const { repository } = await setup();
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "old");
    const recycled = await repository.trashDocument(DEFAULT_UI_WORKSPACE, "View");
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "new");
    await assert.rejects(repository.restore(recycled, documentStoragePath(DEFAULT_UI_WORKSPACE, "View")), /已存在/);
    assert.equal(await repository.readDocument(DEFAULT_UI_WORKSPACE, "View"), "new");
    await assert.rejects(repository.restore(recycled, "/missing/View.json"), /不存在/);
    await assert.rejects(repository.restore(recycled, "/../View.json"));
    await assert.rejects(repository.restore(recycled, "/workspace/nested/View.json"));
    await assert.rejects(repository.restore(recycled, "/workspace/View.gia"));
    await assert.rejects(repository.restore("/AnotherProject/file", "/workspace"));
  });

  await test("Selection metadata is separate from documents and ignores malformed or stale targets", async () => {
    const { storage, repository } = await setup();
    assert.equal(await repository.readSelection(), null);
    await repository.createDocument(DEFAULT_UI_WORKSPACE, "View", "data");
    await repository.writeSelection({ workspace: DEFAULT_UI_WORKSPACE, document: "View" });
    assert.equal(storage.files.has(`/${CLIENT_UI_PROJECT_ID}/.selection.json`), true);
    assert.deepEqual(await repository.listDocuments(DEFAULT_UI_WORKSPACE), ["View"]);
    await repository.trashDocument(DEFAULT_UI_WORKSPACE, "View");
    assert.equal(await repository.readSelection(), null);
    await assert.rejects(repository.writeSelection({ workspace: DEFAULT_UI_WORKSPACE, document: "missing" }), /不存在/);
    const selectionPath = `/${CLIENT_UI_PROJECT_ID}/.selection.json`;
    for (const invalid of ["not JSON", "null", JSON.stringify({ workspace: "../other", document: "secret" })]) {
      storage.files.set(selectionPath, invalid);
      assert.equal(await repository.readSelection(), null);
    }
  });

  await test("Workspace listing excludes files, while document listing excludes directories and non-JSON assets", async () => {
    const { storage, repository } = await setup();
    const directory = `/${CLIENT_UI_PROJECT_ID}/${DEFAULT_UI_WORKSPACE}`;
    storage.files.set(`/${CLIENT_UI_PROJECT_ID}/not-a-workspace.json`, "root metadata");
    storage.files.set(`${directory}/image.png`, "png");
    storage.files.set(`${directory}/View.json`, "editor");
    storage.files.set(`${directory}/bad:name.json`, "invalid");
    storage.folders.add(`${directory}/folder.json`);
    assert.deepEqual(await repository.listWorkspaces(), [DEFAULT_UI_WORKSPACE]);
    assert.deepEqual(await repository.listDocuments(DEFAULT_UI_WORKSPACE), ["View"]);
    await assert.rejects(repository.writeDocument(DEFAULT_UI_WORKSPACE, "folder", "not a file"), /不存在/);
  });

  await test("Selection remembers an empty workspace without inventing a document", async () => {
    const { repository, storage } = await setup();
    const selection = { workspace: DEFAULT_UI_WORKSPACE, document: "" };
    await repository.writeSelection(selection);
    assert.deepEqual(await repository.readSelection(), selection);
    assert.deepEqual(await repository.listDocuments(DEFAULT_UI_WORKSPACE), []);
    const metadata = [...storage.files.entries()];
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0][0], `/${CLIENT_UI_PROJECT_ID}/.selection.json`);
    await repository.trashWorkspace(DEFAULT_UI_WORKSPACE);
    assert.equal(await repository.readSelection(), null);
    await assert.rejects(repository.writeSelection(selection), /不存在/);
  });

  console.log(`\n${passed} Client UI workspace storage tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousExtension) Module._extensions[".ts"] = previousExtension;
  else delete Module._extensions[".ts"];
});
