import { computed, ref } from "vue";
import { createWorkspaceSaveQueue } from "../DSFGStudio/components/QuestEditor/workspaceSaveQueue";
import {
  DEFAULT_UI_WORKSPACE,
  documentStoragePath,
  validateDocumentName,
  validateWorkspaceName,
  type ClientUIWorkspaceRepository,
} from "./workspaceStorage";

type WorkspaceRepository = Pick<ClientUIWorkspaceRepository,
  "listWorkspaces" | "createWorkspace" | "renameWorkspace" | "trashWorkspace" |
  "listDocuments" | "readDocument" | "createDocument" | "writeDocument" |
  "renameDocument" | "trashDocument" | "restore" | "readSelection" | "writeSelection">;

interface WorkspaceCallbacks {
  capture: () => string;
  apply: (serialized: string) => void;
  createBlank: (name: string) => string;
  onBeforeSwitch?: () => void;
}

interface DocumentTarget { workspace: string; document: string }
interface RecycledItem extends DocumentTarget { trashPath: string; originalPath: string; kind: "workspace" | "document" }
interface LoadedSelection extends DocumentTarget { documents: string[]; serialized: string }

/** File names are authoritative; a stale title inside imported JSON is not. */
function withDocumentName(serialized: string, name: string): string {
  const data = JSON.parse(serialized);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("编辑文件必须是 JSON 对象");
  data.name = name;
  return JSON.stringify(data);
}

export function useClientUIWorkspace(repository: WorkspaceRepository, callbacks: WorkspaceCallbacks) {
  const workspaceIds = ref<string[]>([]);
  const documentNames = ref<string[]>([]);
  const selectedWorkspace = ref("");
  const selectedDocument = ref("");
  const busy = ref(false);
  const ready = ref(false);
  const loading = ref(false);
  const dirty = ref(false);
  const status = ref("正在读取存档…");
  const error = ref("");
  const recycledItem = ref<RecycledItem | null>(null);
  const canUndoDelete = computed(() => recycledItem.value !== null);
  const targets = new Map<string, DocumentTarget>();
  const latest = new Map<string, string>();
  const saved = new Map<string, string>();
  let disposed = false;

  function currentPath() {
    return selectedWorkspace.value && selectedDocument.value
      ? documentStoragePath(selectedWorkspace.value, selectedDocument.value) : "";
  }

  function report(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    status.value = dirty.value ? "保存失败，请重试" : "操作失败";
  }

  const saveQueue = createWorkspaceSaveQueue(async (path, serialized) => {
    const target = targets.get(path);
    if (!target) throw new Error("无法确定编辑文件的保存位置");
    await repository.writeDocument(target.workspace, target.document, serialized);
    saved.set(path, serialized);
    if (path === currentPath()) {
      dirty.value = latest.get(path) !== serialized;
      if (!dirty.value) { status.value = "已自动保存"; error.value = ""; }
    }
  }, report);

  function scheduleSnapshot(serialized: string) {
    const path = currentPath();
    if (!path) return;
    const snapshot = withDocumentName(serialized, selectedDocument.value);
    const previous = latest.get(path);
    targets.set(path, { workspace: selectedWorkspace.value, document: selectedDocument.value });
    latest.set(path, snapshot);
    // Reverting an edit must replace an older pending/in-flight snapshot too.
    dirty.value = saved.get(path) !== snapshot || previous !== snapshot;
    if (!dirty.value) return;
    status.value = "待保存…";
    saveQueue.schedule(path, snapshot);
  }

  function queueSave(serialized: string) {
    if (disposed || !ready.value || busy.value || loading.value) return;
    try { scheduleSnapshot(serialized); }
    catch (cause) { dirty.value = true; report(cause); }
  }

  async function flushCurrent() {
    callbacks.onBeforeSwitch?.();
    if (ready.value && !loading.value && currentPath()) scheduleSnapshot(callbacks.capture());
    await saveQueue.flush();
  }

  async function exclusive(operation: () => Promise<void>) {
    if (disposed || busy.value) return;
    busy.value = true;
    error.value = "";
    try { await operation(); }
    catch (cause) { report(cause); throw cause; }
    finally { busy.value = false; }
  }

  /** Validate through the editor without leaving its old state changed. */
  function stage(serialized: string, name: string): string {
    const oldState = callbacks.capture();
    loading.value = true;
    try {
      callbacks.apply(withDocumentName(serialized, name));
      return withDocumentName(callbacks.capture(), name);
    } finally {
      try { callbacks.apply(oldState); }
      finally { loading.value = false; }
    }
  }

  function applySelection(selection: LoadedSelection) {
    if (disposed) return;
    const oldState = callbacks.capture();
    loading.value = true;
    try {
      try { callbacks.apply(withDocumentName(selection.serialized, selection.document || "未选择文件")); }
      catch (cause) { callbacks.apply(oldState); throw cause; }
      selectedWorkspace.value = selection.workspace;
      selectedDocument.value = selection.document;
      documentNames.value = selection.documents;
      dirty.value = false;
      if (selection.document) {
        const path = currentPath();
        const snapshot = withDocumentName(callbacks.capture(), selection.document);
        targets.set(path, { workspace: selection.workspace, document: selection.document });
        latest.set(path, snapshot);
        saved.set(path, snapshot);
      }
      status.value = selection.document ? "已加载 · 自动保存" : "未打开编辑文件";
    } finally { loading.value = false; }
  }

  async function rememberSelection() {
    if (disposed || !selectedWorkspace.value) return;
    try {
      await repository.writeSelection({ workspace: selectedWorkspace.value, document: selectedDocument.value });
    } catch (cause) {
      // The actual file operation already succeeded; do not discard that state
      // merely because the optional last-opened-file marker could not be saved.
      error.value = `编辑内容已保留，但最近打开记录保存失败：${cause instanceof Error ? cause.message : String(cause)}`;
      status.value = "最近打开记录保存失败";
    }
  }

  async function loadSelection(workspace: string, preferredDocument?: string): Promise<LoadedSelection> {
    if (!workspace) return { workspace: "", document: "", documents: [], serialized: callbacks.createBlank("未选择文件") };
    const documents = await repository.listDocuments(workspace);
    const document = preferredDocument === "" ? ""
      : preferredDocument && documents.includes(preferredDocument) ? preferredDocument : documents[0] || "";
    const serialized = document ? await repository.readDocument(workspace, document) : callbacks.createBlank("未选择文件");
    return { workspace, document, documents, serialized };
  }

  async function initialize() {
    if (ready.value) return;
    await exclusive(async () => {
      let workspaces = await repository.listWorkspaces();
      if (disposed) return;
      if (workspaces.length === 0) {
        await repository.createWorkspace(DEFAULT_UI_WORKSPACE);
        if (disposed) return;
        const blank = stage(callbacks.createBlank("新建动画"), "新建动画");
        await repository.createDocument(DEFAULT_UI_WORKSPACE, "新建动画", blank);
        workspaces = await repository.listWorkspaces();
      }
      const remembered = await repository.readSelection();
      const workspace = remembered && workspaces.includes(remembered.workspace) ? remembered.workspace : workspaces[0];
      const selection = await loadSelection(workspace, remembered?.workspace === workspace ? remembered.document : undefined);
      if (disposed) return;
      applySelection(selection);
      workspaceIds.value = workspaces;
      ready.value = true;
      await rememberSelection();
    });
  }

  async function save() {
    await exclusive(async () => { await flushCurrent(); });
  }

  async function switchWorkspace(name: string) {
    if (name === selectedWorkspace.value) return;
    await exclusive(async () => {
      await flushCurrent();
      const selection = await loadSelection(validateWorkspaceName(name));
      if (disposed) return;
      applySelection(selection);
      await rememberSelection();
    });
  }

  async function switchDocument(name: string) {
    if (name === selectedDocument.value) return;
    await exclusive(async () => {
      await flushCurrent();
      const document = validateDocumentName(name);
      const workspace = selectedWorkspace.value;
      const serialized = await repository.readDocument(workspace, document);
      if (disposed) return;
      applySelection({ workspace, document, serialized, documents: documentNames.value });
      await rememberSelection();
    });
  }

  async function createWorkspace(name: string) {
    await exclusive(async () => {
      const workspace = validateWorkspaceName(name);
      await flushCurrent();
      if (disposed) return;
      await repository.createWorkspace(workspace);
      const workspaces = await repository.listWorkspaces();
      if (disposed) return;
      applySelection({ workspace, document: "", documents: [], serialized: callbacks.createBlank("未选择文件") });
      workspaceIds.value = workspaces;
      await rememberSelection();
    });
  }

  async function createDocument(name: string, serializedOrFactory?: string | (() => Promise<string>)) {
    await exclusive(async () => {
      const requested = validateDocumentName(name);
      const workspace = selectedWorkspace.value;
      if (!workspace) throw new Error("请先创建或选择工作区");
      await flushCurrent();
      if (disposed) return;
      const raw = typeof serializedOrFactory === "function" ? await serializedOrFactory()
        : serializedOrFactory ?? callbacks.createBlank(requested);
      if (disposed) return;
      const serialized = stage(raw, requested);
      const document = await repository.createDocument(workspace, requested, serialized);
      if (disposed) return;
      const named = withDocumentName(serialized, document);
      const documents = await repository.listDocuments(workspace);
      if (disposed) return;
      applySelection({ workspace, document, serialized: named, documents });
      await rememberSelection();
    });
  }

  function forgetTarget(workspace: string, document: string) {
    if (!document) return;
    const path = documentStoragePath(workspace, document);
    saveQueue.discard(path);
    targets.delete(path); latest.delete(path); saved.delete(path);
  }

  async function renameWorkspace(name: string) {
    if (name === selectedWorkspace.value) return;
    await exclusive(async () => {
      const workspace = validateWorkspaceName(name);
      const oldWorkspace = selectedWorkspace.value;
      if (!oldWorkspace) throw new Error("请先选择工作区");
      await flushCurrent();
      if (disposed) return;
      await repository.renameWorkspace(oldWorkspace, workspace);
      if (disposed) return;
      forgetTarget(oldWorkspace, selectedDocument.value);
      selectedWorkspace.value = workspace;
      if (recycledItem.value?.kind === "document" && recycledItem.value.workspace === oldWorkspace) {
        recycledItem.value = { ...recycledItem.value, workspace, originalPath: documentStoragePath(workspace, recycledItem.value.document) };
      }
      if (selectedDocument.value) {
        const path = currentPath();
        const snapshot = withDocumentName(callbacks.capture(), selectedDocument.value);
        targets.set(path, { workspace, document: selectedDocument.value }); latest.set(path, snapshot); saved.set(path, snapshot);
      }
      workspaceIds.value = workspaceIds.value.map(item => item === oldWorkspace ? workspace : item);
      await rememberSelection();
    });
  }

  async function renameDocument(name: string) {
    if (name === selectedDocument.value) return;
    await exclusive(async () => {
      const document = validateDocumentName(name);
      const workspace = selectedWorkspace.value;
      const oldDocument = selectedDocument.value;
      if (!oldDocument) throw new Error("请先选择编辑文件");
      await flushCurrent();
      if (disposed) return;
      const oldSerialized = callbacks.capture();
      const serialized = stage(oldSerialized, document);
      await repository.renameDocument(workspace, oldDocument, document);
      try {
        await repository.writeDocument(workspace, document, serialized);
        if (disposed) return;
        applySelection({ workspace, document, serialized, documents: documentNames.value.map(item => item === oldDocument ? document : item) });
      } catch (cause) {
        await repository.renameDocument(workspace, document, oldDocument);
        await repository.writeDocument(workspace, oldDocument, oldSerialized);
        throw cause;
      }
      forgetTarget(workspace, oldDocument);
      await rememberSelection();
    });
  }

  async function deleteDocument() {
    await exclusive(async () => {
      const workspace = selectedWorkspace.value;
      const document = selectedDocument.value;
      if (!document) throw new Error("请先选择编辑文件");
      await flushCurrent();
      const documents = (await repository.listDocuments(workspace)).filter(item => item !== document);
      const nextDocument = documents[0] || "";
      const serialized = nextDocument ? await repository.readDocument(workspace, nextDocument) : callbacks.createBlank("未选择文件");
      const validated = stage(serialized, nextDocument || "未选择文件");
      if (disposed) return;
      const originalPath = documentStoragePath(workspace, document);
      const trashPath = await repository.trashDocument(workspace, document);
      forgetTarget(workspace, document);
      recycledItem.value = { kind: "document", workspace, document, originalPath, trashPath };
      if (disposed) return;
      applySelection({ workspace, document: nextDocument, documents, serialized: validated });
      await rememberSelection();
    });
  }

  async function deleteWorkspace() {
    await exclusive(async () => {
      const workspace = selectedWorkspace.value;
      const document = selectedDocument.value;
      if (!workspace) throw new Error("请先选择工作区");
      await flushCurrent();
      const workspaces = (await repository.listWorkspaces()).filter(item => item !== workspace);
      const selection = await loadSelection(workspaces[0] || "");
      selection.serialized = stage(selection.serialized, selection.document || "未选择文件");
      if (disposed) return;
      const trashPath = await repository.trashWorkspace(workspace);
      forgetTarget(workspace, document);
      recycledItem.value = { kind: "workspace", workspace, document, originalPath: `/${workspace}`, trashPath };
      if (disposed) return;
      applySelection(selection);
      workspaceIds.value = workspaces;
      await rememberSelection();
    });
  }

  async function undoDelete() {
    await exclusive(async () => {
      const item = recycledItem.value;
      if (!item) return;
      await flushCurrent();
      if (disposed) return;
      await repository.restore(item.trashPath, item.originalPath);
      recycledItem.value = null;
      const workspaces = await repository.listWorkspaces();
      const selection = await loadSelection(item.workspace, item.document || undefined);
      if (disposed) return;
      applySelection(selection);
      workspaceIds.value = workspaces;
      await rememberSelection();
    });
  }

  async function prepareToLeave() {
    if (busy.value) throw new Error("编辑文件正在读写，请稍后切换页面");
    await save();
  }

  async function dispose() {
    if (disposed) return;
    // Capture synchronously before the owner component disappears. flush clears
    // its debounce timer and retains failures for reporting instead of discarding.
    if (ready.value && !busy.value && !loading.value && currentPath()) {
      try { scheduleSnapshot(callbacks.capture()); } catch (cause) { dirty.value = true; report(cause); }
    }
    disposed = true;
    ready.value = false;
    await saveQueue.flush();
  }

  return {
    workspaceIds, documentNames, selectedWorkspace, selectedDocument, busy, ready, loading,
    dirty, status, error, canUndoDelete, initialize, queueSave, save, switchWorkspace,
    switchDocument, createWorkspace, renameWorkspace, deleteWorkspace, createDocument,
    renameDocument, deleteDocument, undoDelete, prepareToLeave, dispose,
  };
}
