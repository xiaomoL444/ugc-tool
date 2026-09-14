import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import { decodeEntityPresets, encodeEntityPresets, type EntityPreset } from "./entityPresets";

/** Editors are keyed by workspace; capture the save path before async work. */
export function useEntityPresets() {
  const storage = inject<StorageClass>("storage")!;
  const workspace = inject<Ref<string>>("selectedWorkspaceId")!;
  const path = `/${workspace.value}/EntityPresets.json`;
  const presets = ref<EntityPreset[]>([]);
  const ready = ref(false);
  const error = ref("");
  const status = ref("正在读取预设…");
  let disposed = false;
  let loading = false;
  let revision = 0;
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
      const result = exists ? decodeEntityPresets(await storage.setProject(ProjectID).readFile(path)) : [];
      if (disposed) return;
      presets.value = result;
      ready.value = true;
      status.value = "已加载 · 自动保存";
    } catch (cause) {
      if (!disposed) { error.value = cause instanceof Error ? cause.message : "读取预设失败"; status.value = "读取失败"; }
    } finally { loading = false; }
  }
  watch(presets, () => {
    if (disposed || !ready.value || loading) return;
    revision++;
    status.value = "待保存…";
    saveQueue.schedule(path, encodeEntityPresets(presets.value));
  }, { deep: true, flush: "sync" });
  onMounted(load);
  onBeforeUnmount(() => { disposed = true; void saveQueue.flush().catch(() => undefined); });
  return { presets, ready, error, status, retry: () => ready.value ? saveQueue.flush() : load(), flush: () => saveQueue.flush() };
}
