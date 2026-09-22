import { computed, inject, onBeforeUnmount, onMounted, readonly, ref, watch, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";

/** Every preset category must declare its system defaults, codec and workspace file. */
export interface WorkspacePresetDefinition<T extends { id: string }> {
  fileName: string;
  defaults: () => T[];
  encode: (presets: T[]) => string;
  decode: (raw: string) => T[];
}

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
    if (!disposed && version === revision) { status.value = "已自动保存"; error.value = ""; }
  }, () => { if (!disposed) { status.value = "保存失败"; error.value = "预设保存失败，请重试后再离开。"; } });
  async function load() {
    if (loading || disposed || ready.value) return;
    loading = true;
    error.value = "";
    try {
      const exists = await storage.setProject(ProjectID).exists(path);
      // An explicitly saved empty list is a user choice, not a missing configuration.
      const result = exists ? decodeCustom(await storage.setProject(ProjectID).readFile(path)) : [];
      if (disposed) return;
      presets.value = result;
      ready.value = true;
      status.value = "系统预设只读 · 自定义项自动保存";
    } catch (cause) {
      if (!disposed) { error.value = cause instanceof Error ? cause.message : "读取预设失败"; status.value = "读取失败"; }
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
  onMounted(load);
  onBeforeUnmount(() => { disposed = true; void saveQueue.flush().catch(() => undefined); });
  return { presets, systemPresets, availablePresets, ready, error, status,
    retry: () => ready.value ? saveQueue.flush() : load(), flush: () => saveQueue.flush() };
}
