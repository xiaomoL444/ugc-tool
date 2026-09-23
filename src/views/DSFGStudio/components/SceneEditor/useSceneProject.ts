import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import { SCENE_FILE, createSceneProject, decodeSceneProject, encodeSceneProject, type SceneProject } from "./sceneProject";
import { commitRuntimeImport } from "../runtimeImportStorage";
import { importScene } from "./sceneImporter";

export function useSceneProject() {
  const storage = inject<StorageClass>("storage")!;
  const workspace = inject<Ref<string>>("selectedWorkspaceId")!.value;
  const file = `/${workspace}/${SCENE_FILE}`;
  const project = ref<SceneProject>();
  const busy = ref(false), error = ref(""), status = ref("加载场景中…");
  let disposed = false, loading = false, revision = 0;
  const report = (reason: unknown) => { error.value = reason instanceof Error ? reason.message : String(reason); status.value = "保存或加载失败"; };
  const queue = createWorkspaceSaveQueue(async (path, data) => {
    const current = revision;
    await storage.setProject(ProjectID).writeFile(path, data);
    if (!disposed && current === revision) { status.value = "已自动保存"; error.value = ""; }
  }, report);
  watch(project, () => {
    if (loading || disposed || !project.value) return;
    revision++; status.value = "待保存…";
    queue.schedule(file, encodeSceneProject(project.value));
  }, { deep: true, flush: "sync" });
  async function load() {
    if (busy.value || disposed) return;
    busy.value = true;
    try {
      const exists = await storage.setProject(ProjectID).exists(file);
      if (disposed) return;
      const next = exists ? decodeSceneProject(await storage.setProject(ProjectID).readFile(file)) : createSceneProject();
      if (disposed) return;
      if (!exists) await storage.setProject(ProjectID).writeFile(file, encodeSceneProject(next));
      if (disposed) return;
      loading = true; project.value = next; loading = false;
      status.value = exists ? "已加载" : "已创建默认场景"; error.value = "";
    } catch (reason) { if (!disposed) report(reason); }
    finally { busy.value = false; }
  }
  async function retry() { if (project.value) await queue.flush(); else await load(); }
  async function importConfiguration(fileInput: File) {
    if (busy.value || disposed) return;
    busy.value = true;
    try {
      const result = await commitRuntimeImport({ file: fileInput, decode: importScene, encode: encodeSceneProject,
        storage: storage.setProject(ProjectID), active: () => !disposed, flush: () => queue.flush(),
        overwrite: { path: file, backupDirectory: `/${workspace}/ImportBackups/Scene`,
          confirm: () => confirm("导入将覆盖当前工作区的全部世界和区域配置。原配置会先备份，是否继续？") } });
      if (!result) return;
      loading = true; project.value = result.project; loading = false;
      status.value = "已导入，原配置已备份"; error.value = "";
      return true;
    } finally { loading = false; if (!disposed) busy.value = false; }
  }
  async function prepareToLeave() {
    if (busy.value) throw new Error("场景正在读写，请稍后切换");
    await queue.flush();
  }
  onMounted(load);
  onBeforeUnmount(() => { disposed = true; void queue.flush().catch(() => undefined); });
  return { project, busy, error, status, retry, prepareToLeave, importConfiguration };
}
