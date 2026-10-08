import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import { bindWorkspaceSaveLifecycle } from "../QuestEditor/workspaceSaveLifecycle";
import { studioEditorActiveKey } from "../studioSessionHistory";
import { cameraFileName, createCameraProject, decodeCameraProject, encodeCameraProject, type CameraProject } from "./cameraProject";

export function useCameraFiles() {
  const editorActive = inject(studioEditorActiveKey, () => true);
  const storage = inject<StorageClass>("storage")!;
  const workspace = inject<Ref<string>>("selectedWorkspaceId")!.value;
  const directory = `/${workspace}/CameraEditor`;
  const project = ref<CameraProject>();
  const files = ref<string[]>([]), selectedFile = ref("");
  const creating = ref(false), newName = ref("");
  const busy = ref(false), status = ref("未打开文件"), error = ref("");
  let disposed = false, loading = false, revision = 0, listRequest = 0;
  let unbindLifecycle: (() => void) | undefined;

  function report(reason: unknown) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
  const queue = createWorkspaceSaveQueue(async (path, data) => {
    const version = revision;
    await storage.setProject(ProjectID).writeFile(path, data);
    if (!disposed && version === revision) { status.value = "已自动保存"; error.value = ""; }
  }, reason => { if (!disposed) { status.value = "保存失败"; report(reason); } });
  watch(project, () => {
    if (disposed || loading || !project.value || !selectedFile.value) return;
    revision++; status.value = "待保存…";
    queue.schedule(`${directory}/${selectedFile.value}`, encodeCameraProject(project.value));
  }, { deep: true, flush: "sync" });

  async function refreshFiles() {
    if (disposed) return;
    const request = ++listRequest;
    try {
      const exists = await storage.setProject(ProjectID).exists(directory);
      if (disposed || request !== listRequest) return;
      const names = exists ? await storage.setProject(ProjectID).getFiles(directory) : [];
      if (!disposed && request === listRequest) files.value = names.filter(name => /^[^/\\]+\.json$/i.test(name)).sort();
    } catch (reason) { if (!disposed && request === listRequest) report(reason); }
  }
  function install(name: string, next: CameraProject) {
    loading = true; selectedFile.value = name; project.value = next; revision++; loading = false;
    status.value = "已加载"; error.value = "";
  }
  async function selectFile(name: string) {
    if (busy.value || disposed || !/^[^/\\]+\.json$/i.test(name)) return;
    busy.value = true;
    try {
      await queue.flush();
      if (disposed) return;
      const next = decodeCameraProject(await storage.setProject(ProjectID).readFile(`${directory}/${name}`));
      if (!disposed) install(name, next);
    } catch (reason) { if (!disposed) report(reason); }
    finally { if (!disposed) busy.value = false; }
  }
  async function createFile() {
    if (busy.value || disposed) return;
    let name: string;
    try { name = cameraFileName(newName.value); } catch (reason) { report(reason); return; }
    busy.value = true;
    try {
      await queue.flush();
      if (disposed) return;
      if (await storage.setProject(ProjectID).exists(`${directory}/${name}`)) throw new Error("已有同名镜头文件。");
      if (disposed) return;
      if (!await storage.setProject(ProjectID).exists(directory)) await storage.setProject(ProjectID).mkdir(directory);
      if (disposed) return;
      const next = createCameraProject(name.replace(/\.json$/i, ""));
      await storage.setProject(ProjectID).writeFile(`${directory}/${name}`, encodeCameraProject(next));
      if (disposed) return;
      install(name, next); creating.value = false; newName.value = "";
      await refreshFiles();
    } catch (reason) { if (!disposed) report(reason); }
    finally { if (!disposed) busy.value = false; }
  }
  async function deleteFile() {
    if (busy.value || disposed || !selectedFile.value) return;
    const name = selectedFile.value;
    if (!confirm(`将镜头文件「${name}」移入回收站？`)) return;
    busy.value = true;
    try {
      await queue.flush();
      if (disposed) return;
      await storage.setProject(ProjectID).trash(`${directory}/${name}`);
      queue.discard(`${directory}/${name}`);
      if (disposed) return;
      loading = true; selectedFile.value = ""; project.value = undefined; revision++; loading = false;
      status.value = "未打开文件"; error.value = "";
      await refreshFiles();
    } catch (reason) { if (!disposed) report(reason); }
    finally { if (!disposed) busy.value = false; }
  }
  async function prepareToLeave() {
    if (busy.value) throw new Error("镜头文件正在读写，请稍后切换。");
    await queue.flush();
  }
  async function saveShortcut(event: KeyboardEvent) {
    if (!editorActive()) return;
    if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (!event.repeat && !busy.value && !disposed) await queue.flush().catch(() => undefined);
  }
  onMounted(() => {
    void refreshFiles();
    unbindLifecycle = bindWorkspaceSaveLifecycle(queue);
    window.addEventListener("keydown", saveShortcut);
  });
  onBeforeUnmount(() => {
    disposed = true; listRequest++;
    unbindLifecycle?.(); window.removeEventListener("keydown", saveShortcut);
    void queue.flush().catch(() => undefined);
  });
  return { project, files, selectedFile, creating, newName, busy, status, error,
    refreshFiles, selectFile, createFile, deleteFile, prepareToLeave, flush: () => queue.flush() };
}
