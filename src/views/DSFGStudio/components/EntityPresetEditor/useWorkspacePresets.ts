import { computed, inject, onBeforeUnmount, onMounted, readonly, ref, toRaw, watch, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import { workspacePresetHistoryKey, type WorkspacePresetHistoryContext } from "./useWorkspacePresetHistory";

/** Every preset category must declare its system defaults, codec and workspace file. */
export interface WorkspacePresetDefinition<T extends { id: string }> {
  fileName: string;
  defaults: () => T[];
  /** Allow system values to be overridden while preserving their identity. */
  editableDefaults?: boolean;
  fixedFields?: (keyof T)[];
  encode: (presets: T[]) => string;
  decode: (raw: string) => T[];
}

// Cached editors keep independent drafts, while successful preset saves refresh
// other consumers of the same workspace file without remounting those editors.
const savedPresetListeners = new WeakMap<StorageClass, Map<string, Set<(raw: string) => void>>>();

export function useWorkspacePresets<T extends { id: string }>(definition: WorkspacePresetDefinition<T>) {
  const storage = inject<StorageClass>("storage")!;
  const workspace = inject<Ref<string>>("selectedWorkspaceId")!;
  let presetHistory = inject(workspacePresetHistoryKey, undefined);
  const path = `/${workspace.value}/${definition.fileName}`;
  const presets = ref([]) as Ref<T[]>;
  const ready = ref(false);
  const error = ref("");
  const status = ref("正在读取预设…");
  let disposed = false;
  let loading = false;
  let revision = 0;
  let loadVersion = 0;
  let normalizing = false;
  const editableDefaults = definition.editableDefaults === true;
  const loadedStatus = editableDefaults ? "系统参数与自定义预设自动保存" : "系统预设只读 · 自定义项自动保存";
  // Round-trip clones and validates defaults so editing never mutates system config.
  const createDefaults = () => definition.decode(definition.encode(definition.defaults()));
  const defaultPresets = computed(() => readonly(createDefaults()) as Readonly<T[]>);
  const defaultIds = computed(() => new Set(defaultPresets.value.map(item => item.id)));
  const systemRows = new WeakMap<object, string>();
  const previousSystemRows = new Map<string, T>();
  const systemPresets = computed(() => editableDefaults
    ? presets.value.filter(item => defaultIds.value.has(item.id)) : defaultPresets.value as T[]);
  const customPresets = computed({
    get: () => editableDefaults ? presets.value.filter(item => !defaultIds.value.has(item.id)) : presets.value,
    set: (items: T[]) => { presets.value = editableDefaults ? [...systemPresets.value, ...items] : items; },
  });
  const availablePresets = computed(() => editableDefaults ? presets.value : [...systemPresets.value, ...presets.value]);
  function restoreIdentity(item: T, seed: T): T {
    const result = { ...item, id: seed.id };
    for (const field of definition.fixedFields ?? []) result[field] = seed[field];
    return result;
  }
  function mergeSystemRows(saved: T[]): T[] {
    const defaults = createDefaults(), byId = new Map(saved.map(item => [item.id, item]));
    return [...defaults.map(seed => restoreIdentity(byId.get(seed.id) ?? seed, seed)),
      ...saved.filter(item => !defaultIds.value.has(item.id))];
  }
  function normalizeSystemRows() {
    if (!editableDefaults || normalizing) return;
    normalizing = true;
    try {
      const byId = new Map<string, T>();
      const customs: T[] = [];
      for (const item of presets.value) {
        const id = systemRows.get(toRaw(item)) ?? (defaultIds.value.has(item.id) ? item.id : undefined);
        if (id) { if (!byId.has(id)) byId.set(id, item); }
        else customs.push(item);
      }
      const systems = createDefaults().map(seed => {
        const item = byId.get(seed.id) ?? previousSystemRows.get(seed.id) ?? seed;
        item.id = seed.id;
        for (const field of definition.fixedFields ?? []) item[field] = seed[field];
        systemRows.set(toRaw(item), seed.id);
        previousSystemRows.set(seed.id, item);
        return item;
      });
      const result = [...systems, ...customs];
      if (result.length !== presets.value.length || result.some((item, index) => item !== presets.value[index])) presets.value = result;
    } finally { normalizing = false; }
  }
  function decodeWorkspace(raw: string): T[] {
    if (!editableDefaults) return decodeCustom(raw);
    const saved = definition.decode(raw);
    const data = JSON.parse(raw);
    if (data.presetStorage !== "system-overrides") return mergeSystemRows(saved);
    if (!Array.isArray(data.systemOverrides) || saved.some(item => defaultIds.value.has(item.id))) {
      throw new Error("系统参数覆盖预设文件不完整，原文件已保留。");
    }
    const defaults = new Map(createDefaults().map(item => [item.id, item]));
    const ids = new Set<string>();
    const overrides = data.systemOverrides.map((item: T) => {
      const seed = item && defaults.get(item.id);
      if (!seed || ids.has(item.id)) throw new Error("系统参数覆盖预设存在未知或重复条目，原文件已保留。");
      ids.add(item.id);
      return restoreIdentity({ ...seed, ...item }, seed);
    });
    // Use the category codec to validate overrides just as strictly as custom rows.
    const validated = definition.decode(definition.encode(overrides));
    return mergeSystemRows([...validated, ...saved]);
  }
  function decodeCustom(raw: string): T[] {
    const saved = definition.decode(raw);
    if (JSON.parse(raw).presetStorage === "custom-only") return saved;
    // Old files mixed system snapshots and custom entries. Preserve edited snapshots as custom.
    const defaults = new Map(createDefaults().map(item => [item.id, item]));
    const ids = new Set([...saved.map(item => item.id), ...defaults.keys()]);
    return saved.flatMap(item => {
      const system = defaults.get(item.id);
      if (!system) return [item];
      if (JSON.stringify(item) === JSON.stringify(system)) return [];
      let id = `custom:${item.id}`;
      while (ids.has(id)) id += ":copy";
      ids.add(id);
      return [{ ...item, id }];
    });
  }
  const saveQueue = createWorkspaceSaveQueue(async (file, data) => {
    const version = revision;
    await storage.setProject(ProjectID).writeFile(file, data);
    savedPresetListeners.get(storage)?.get(file)?.forEach(listener => {
      if (listener !== receiveSavedPresets) listener(data);
    });
    if (!disposed && version === revision) { status.value = "已自动保存"; error.value = ""; }
  }, () => { if (!disposed) { status.value = "保存失败"; error.value = "预设保存失败，请重试后再离开。"; } });
  function receiveSavedPresets(raw: string) {
    if (disposed || saveQueue.hasPendingChanges()) return;
    try {
      const result = decodeWorkspace(raw);
      loadVersion++;
      loading = true;
      presets.value = result;
      ready.value = true;
      status.value = loadedStatus;
      error.value = "";
      // A saved external snapshot becomes the baseline, including in hidden editors.
      presetHistory?.reset(definition.fileName);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "读取预设失败";
      status.value = "读取失败";
    } finally { loading = false; }
  }
  async function load() {
    if (loading || disposed || ready.value) return;
    const version = ++loadVersion;
    loading = true;
    error.value = "";
    try {
      const exists = await storage.setProject(ProjectID).exists(path);
      // Empty custom lists stay empty; editable system rows are always restored from defaults.
      const result = exists ? decodeWorkspace(await storage.setProject(ProjectID).readFile(path)) : editableDefaults ? createDefaults() : [];
      if (disposed || version !== loadVersion) return;
      presets.value = result;
      ready.value = true;
      status.value = loadedStatus;
    } catch (cause) {
      if (!disposed && version === loadVersion) { error.value = cause instanceof Error ? cause.message : "读取预设失败"; status.value = "读取失败"; }
    } finally { loading = false; }
  }
  watch(presets, () => {
    if (normalizing) return;
    normalizeSystemRows();
    if (disposed || !ready.value || loading) return;
    revision++;
    status.value = "待保存…";
    const data = JSON.parse(definition.encode(editableDefaults ? customPresets.value : presets.value));
    data.presetStorage = editableDefaults ? "system-overrides" : "custom-only";
    if (editableDefaults) {
      const defaults = new Map(createDefaults().map(item => [item.id, item]));
      data.systemOverrides = systemPresets.value.filter(item => JSON.stringify(item) !== JSON.stringify(defaults.get(item.id)));
    }
    saveQueue.schedule(path, JSON.stringify(data, null, 2));
  }, { deep: true, flush: "sync" });
  onMounted(() => {
    let files = savedPresetListeners.get(storage);
    if (!files) { files = new Map(); savedPresetListeners.set(storage, files); }
    let listeners = files.get(path);
    if (!listeners) { listeners = new Set(); files.set(path, listeners); }
    listeners.add(receiveSavedPresets);
    return load();
  });
  onBeforeUnmount(() => {
    disposed = true;
    const files = savedPresetListeners.get(storage), listeners = files?.get(path);
    listeners?.delete(receiveSavedPresets);
    if (listeners?.size === 0) files?.delete(path);
    void saveQueue.flush().catch(() => undefined);
  });
  presetHistory?.register(definition.fileName, presets, ready);
  // A provider's own stores cannot inject its context; bind them explicitly.
  function bindHistory(history: WorkspacePresetHistoryContext) {
    presetHistory = history;
    history.register(definition.fileName, presets, ready);
  }
  /** Apply an explicit import without retaining a failed snapshot after the dialog is cancelled. */
  async function saveSnapshot(items: T[]) {
    if (!ready.value) throw new Error(error.value || "预设尚未读取完成。");
    await saveQueue.flush();
    const previous = presets.value;
    try { presets.value = items; await saveQueue.flush(); }
    catch (cause) {
      loading = true;
      try { presets.value = previous; }
      finally { loading = false; saveQueue.discard(path); }
      throw cause;
    }
  }
  return { presets, systemPresets, customPresets, defaultPresets, availablePresets, ready, error, status,
    bindHistory, saveSnapshot, retry: () => ready.value ? saveQueue.flush() : load(), flush: () => saveQueue.flush() };
}
