import { computed, inject, onBeforeUnmount, onMounted, readonly, ref, watch, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import { workspacePresetHistoryKey } from "./useWorkspacePresetHistory";

/** Every preset category must declare its system defaults, codec and workspace file. */
export interface WorkspacePresetDefinition<T extends { id: string }> {
  fileName: string;
  defaults: () => T[];
  encode: (presets: T[]) => string;
  decode: (raw: string) => T[];
}

// Cached editors keep independent drafts, while successful preset saves refresh
// other consumers of the same workspace file without remounting those editors.
const savedPresetListeners = new WeakMap<StorageClass, Map<string, Set<(raw: string) => void>>>();

export function useWorkspacePresets<T extends { id: string }>(definition: WorkspacePresetDefinition<T>) {
  const storage = inject<StorageClass>("storage")!;
  const workspace = inject<Ref<string>>("selectedWorkspaceId")!;
  const path = `/${workspace.value}/${definition.fileName}`;
  const presets = ref([]) as Ref<T[]>;
  const ready = ref(false);
  const error = ref("");
  const status = ref("正在读取预设…");
  let disposed = false;
  let loading = false;
  let revision = 0;
  let loadVersion = 0;
  // Round-trip clones and validates defaults so editing never mutates system config.
  const createDefaults = () => definition.decode(definition.encode(definition.defaults()));
  const systemPresets = computed(() => readonly(createDefaults()) as Readonly<T[]>);
  const availablePresets = computed(() => [...systemPresets.value, ...presets.value]);
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
      const result = decodeCustom(raw);
      loadVersion++;
      loading = true;
      presets.value = result;
      ready.value = true;
      status.value = "系统预设只读 · 自定义项自动保存";
      error.value = "";
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
      // An explicitly saved empty list is a user choice, not a missing configuration.
      const result = exists ? decodeCustom(await storage.setProject(ProjectID).readFile(path)) : [];
      if (disposed || version !== loadVersion) return;
      presets.value = result;
      ready.value = true;
      status.value = "系统预设只读 · 自定义项自动保存";
    } catch (cause) {
      if (!disposed && version === loadVersion) { error.value = cause instanceof Error ? cause.message : "读取预设失败"; status.value = "读取失败"; }
    } finally { loading = false; }
  }
  watch(presets, () => {
    if (disposed || !ready.value || loading) return;
    revision++;
    status.value = "待保存…";
    const data = JSON.parse(definition.encode(presets.value));
    data.presetStorage = "custom-only";
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
  inject(workspacePresetHistoryKey, undefined)?.register(definition.fileName, presets, ready);
  return { presets, systemPresets, availablePresets, ready, error, status,
    retry: () => ready.value ? saveQueue.flush() : load(), flush: () => saveQueue.flush() };
}
