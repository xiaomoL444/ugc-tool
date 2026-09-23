<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { toast } from "vue-sonner";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import SelectableList from "@/components/UI/List/SelectableList.vue";
import { StorageClass } from "@/services/storage/storage";
import { downloadTextFile } from "@/utils/download";
import { ProjectID } from "../../constant/constant";
import EditorKindSelect from "../EditorKindSelect.vue";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import WalkTalkPanel from "./WalkTalkPanel.vue";
import { createWalkTalkProject, decodeWalkTalkProject, encodeWalkTalkProject, validateWalkTalkStructIds, type WalkTalkProject, type WalkTalkStructIds } from "./walkTalkProject";
import { exportWalkTalk } from "./walkTalkExporter";
import RuntimeImportButton from "../RuntimeImportButton.vue";
import { commitRuntimeImport } from "../runtimeImportStorage";
import { importWalkTalk } from "./walkTalkImporter";

withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene" }>(), { editorKind: "WalkTalk" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene"] }>();
const storage = inject<StorageClass>("storage")!;
const workspace = inject<Ref<string>>("selectedWorkspaceId")!;
const directory = `/${workspace.value}/WalkTalkEditor`;
const project = ref<WalkTalkProject>();
const files = ref<string[]>([]);
const selectedFile = ref("");
const creating = ref(false);
const newName = ref("");
const busy = ref(false);
const saveStatus = ref("未打开文件");
const fileError = ref("");
const settingsOpen = ref(false);
const settingsDraft = ref<WalkTalkStructIds>();
const settingsError = ref("");
let disposed = false;
let loading = false;
let requestId = 0;
let listRequestId = 0;
let revision = 0;

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error); toast.error(message);
  return message;
}
const saveQueue = createWorkspaceSaveQueue(async (path, data) => {
  const version = revision;
  await storage.setProject(ProjectID).writeFile(path, data);
  if (!disposed && version === revision) saveStatus.value = "已自动保存";
}, error => { saveStatus.value = "保存失败"; showError(error); });
defineExpose({ prepareToLeave: () => {
  if (busy.value) return Promise.reject(new Error("边走边说文件正在读写，请稍后切换"));
  settingsOpen.value = false;
  return saveQueue.flush();
} });
watch(project, () => {
  if (disposed || loading || !project.value || !selectedFile.value) return;
  revision++;
  saveStatus.value = "待保存…";
  saveQueue.schedule(`${directory}/${selectedFile.value}`, encodeWalkTalkProject(project.value));
}, { deep: true, flush: "sync" });

async function refreshFiles() {
  const request = ++listRequestId;
  try {
    const exists = await storage.setProject(ProjectID).exists(directory);
    if (disposed || request !== listRequestId) return;
    const result = exists ? await storage.setProject(ProjectID).getFiles(directory) : [];
    if (!disposed && request === listRequestId) {
      files.value = result.filter(name => /^[^/\\]+\.json$/i.test(name)).sort();
      fileError.value = "";
    }
  } catch (error) { if (!disposed && request === listRequestId) fileError.value = showError(error); }
}
async function selectFile(name: string, fromCreate = false) {
  if (disposed || (busy.value && !fromCreate) || !/^[^/\\]+\.json$/i.test(name)) return;
  const request = ++requestId;
  busy.value = true;
  try {
    await saveQueue.flush();
    if (disposed || request !== requestId) return;
    const loaded = decodeWalkTalkProject(await storage.setProject(ProjectID).readFile(`${directory}/${name}`));
    if (disposed || request !== requestId) return;
    loading = true;
    selectedFile.value = name;
    project.value = loaded;
    loading = false;
    settingsOpen.value = false;
    fileError.value = "";
    saveStatus.value = "已加载";
  } catch (error) { if (!disposed && request === requestId) fileError.value = showError(error); }
  finally { if (!disposed && request === requestId) busy.value = false; }
}
async function createFile() {
  if (busy.value || disposed) return;
  const base = newName.value.trim().replace(/\.json$/i, "");
  if (!base || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || base === "." || base === "..") { toast.warning("请输入有效文件名，不能包含路径或特殊字符"); return; }
  const name = `${base}.json`;
  busy.value = true;
  try {
    const exists = await storage.setProject(ProjectID).exists(`${directory}/${name}`);
    if (disposed) return;
    if (exists) { toast.warning("已有同名文件"); return; }
    await saveQueue.flush();
    if (disposed) return;
    await storage.setProject(ProjectID).writeFile(`${directory}/${name}`, encodeWalkTalkProject(createWalkTalkProject()));
    if (disposed) return;
    await refreshFiles();
    creating.value = false; newName.value = "";
    if (!disposed) await selectFile(name, true);
  } catch (error) { if (!disposed) fileError.value = showError(error); }
  finally { if (!disposed) busy.value = false; }
}
async function deleteFile() {
  if (busy.value || disposed) return;
  const name = selectedFile.value;
  if (!name) { toast.warning("请先选择文件"); return; }
  if (!confirm(`将边走边说文件「${name}」移入回收站？其中所有台词会一并移入。`)) return;
  busy.value = true;
  try {
    await saveQueue.flush();
    if (disposed) return;
    await storage.setProject(ProjectID).trash(`${directory}/${name}`);
    saveQueue.discard(`${directory}/${name}`);
    if (disposed) return;
    requestId++;
    loading = true; project.value = undefined; selectedFile.value = ""; loading = false;
    settingsOpen.value = false; saveStatus.value = "未打开文件";
    await refreshFiles();
    if (!disposed) toast.success("边走边说文件已移入回收站");
  } catch (error) { if (!disposed) fileError.value = showError(error); }
  finally { if (!disposed) busy.value = false; }
}
async function importConfiguration(file: File) {
  if (busy.value || disposed) return;
  busy.value = true;
  try {
    const result = await commitRuntimeImport({ file, decode: importWalkTalk, encode: encodeWalkTalkProject,
      storage: storage.setProject(ProjectID), active: () => !disposed, flush: () => saveQueue.flush(), directory });
    if (!result) return;
    loading = true; selectedFile.value = result.name; project.value = result.project; loading = false;
    settingsOpen.value = false; creating.value = false; fileError.value = ""; saveStatus.value = "已导入";
    await refreshFiles();
    if (!disposed) toast.success(`已新增「${result.name}」`);
  } finally { loading = false; if (!disposed) busy.value = false; }
}
function exportVariables() {
  if (busy.value || !project.value || !selectedFile.value) return;
  try {
    const result = exportWalkTalk(project.value);
    downloadTextFile(result.json, `${selectedFile.value.replace(/\.json$/i, "")}-边走边说.json`, "application/json");
    toast.success(`已按当前顺序导出 ${project.value.entries.length} 条台词`);
  } catch (error) { showError(error); }
}
function openSettings() {
  if (!project.value) return;
  settingsDraft.value = { ...project.value.structIds }; settingsError.value = ""; settingsOpen.value = true;
}
function applySettings() {
  if (!project.value || !settingsDraft.value) return;
  const errors = validateWalkTalkStructIds(settingsDraft.value);
  if (errors.length) { settingsError.value = errors.join("；"); return; }
  project.value.structIds = { ...settingsDraft.value }; settingsOpen.value = false;
}
async function saveShortcut(event: KeyboardEvent) {
  if (event.repeat || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  if (busy.value || disposed || !project.value || !selectedFile.value) return;
  // 保存队列会显示失败状态并提示错误，不再下载编辑器文件。
  await saveQueue.flush().catch(() => undefined);
}
onMounted(() => { void refreshFiles(); window.addEventListener("keydown", saveShortcut); });
onBeforeUnmount(() => {
  disposed = true; requestId++; listRequestId++;
  void saveQueue.flush().catch(() => undefined);
  window.removeEventListener("keydown", saveShortcut);
});
</script>

<template>
  <Splitter class="walk-talk-editor" :inert="busy">
    <SplitterPanel :size="18" :min-size="12">
      <div class="file-panel">
        <EditorKindSelect :model-value="editorKind" @update:model-value="emit('update:editorKind', $event)" />
        <SectionLayout title="边走边说文件">
          <SelectableList :values="files" :selected-value="selectedFile" @select="selectFile" @add="creating = true" @delete="deleteFile" />
          <form v-if="creating" class="new-file" @submit.prevent="createFile"><input v-model="newName" aria-label="边走边说文件名" placeholder="文件名" /><div><button type="submit" :disabled="busy">创建</button><button type="button" @click="creating = false">取消</button></div></form>
          <p class="file-help">每个文件是一段顺序台词，保存在当前工作区。</p>
          <p v-if="fileError" class="error" role="alert">{{ fileError }}<button type="button" @click="refreshFiles">刷新列表</button></p>
        </SectionLayout>
      </div>
    </SplitterPanel>
    <SplitterPanel :size="82">
      <SectionLayout title="边走边说编辑区">
        <div class="workspace-panel">
          <header class="file-toolbar"><span>{{ selectedFile || '未选择文件' }}</span><small>{{ saveStatus }}</small><RuntimeImportButton :disabled="busy" :import-file="importConfiguration" /><button type="button" :disabled="!project || busy" @click="openSettings">结构体 ID 设置</button><button type="button" class="primary" :disabled="!project || busy" @click="exportVariables">导出千星边走边说</button></header>
          <WalkTalkPanel v-if="project" :key="selectedFile" :project="project" />
          <div v-else class="empty"><h3>一段按顺序播放的台词</h3><p>从左侧选择文件，或创建一份新的边走边说列表。</p><button type="button" class="primary" @click="creating = true">＋ 新建边走边说</button></div>
        </div>
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
  <Teleport to="body">
    <div v-if="settingsOpen && settingsDraft" class="settings-backdrop dsfg-typography" :inert="busy" @click.self="settingsOpen = false" @keydown.esc="settingsOpen = false">
      <form class="settings" role="dialog" aria-modal="true" aria-label="边走边说结构体 ID 设置" @submit.prevent="applySettings">
        <header><h3>边走边说结构体 ID</h3><button type="button" aria-label="关闭结构体设置" @click="settingsOpen = false">×</button></header>
        <p>按实际编辑器填写，导出会同时替换外层、列表类型和每条台词的结构体 ID。</p>
        <label>外层结构体<input v-model="settingsDraft.sequence" aria-label="边走边说外层 ID" inputmode="numeric" /></label>
        <label>台词结构体<input v-model="settingsDraft.dialogue" aria-label="边走边说台词 ID" inputmode="numeric" /></label>
        <p v-if="settingsError" class="error" role="alert">{{ settingsError }}</p>
        <footer><button type="button" @click="settingsOpen = false">取消</button><button type="submit" class="primary">应用</button></footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.walk-talk-editor { height: 100%; min-height: 0; min-width: 0; }
.file-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.file-panel > .Section { flex: 1; min-height: 0; }
.workspace-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; height: 100%; }
.file-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px; color: #34445b; background: #eef3f9; border-bottom: 1px solid #d5deea; }
.file-toolbar > span { font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.file-toolbar > small { margin-right: auto; color: #7f8ba0; font-size: 11px; }
button { padding: 6px 10px; border: 1px solid #b7c8de; border-radius: 5px; background: white; color: #325a89; cursor: pointer; font-size: 12px; }
button:disabled { opacity: .45; cursor: default; }
button.primary { color: white; background: #2877c7; border-color: #2877c7; }
.file-help { padding: 8px; font-size: 11px; line-height: 1.7; color: #8290a1; }
.new-file { padding: 8px; }
.new-file input { box-sizing: border-box; width: 100%; padding: 7px; margin-bottom: 8px; font-size: 12px; border: 1px solid #b7c8de; }
.new-file > div { display: flex; flex-wrap: wrap; gap: 5px; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 20px; color: #718198; text-align: center; font-size: 13px; }
.empty h3 { font-size: 17px; }
.error { color: #b45309; overflow-wrap: anywhere; font-size: 12px; }
.settings-backdrop { position: fixed; inset: 0; z-index: 11000; display: grid; place-items: center; padding: 20px; background: #13203388; }
.settings { width: min(440px, 90vw); max-height: 85vh; overflow: auto; padding: 22px; border-radius: 12px; background: white; color: #34445b; }
.settings header, .settings footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings h3 { margin: 0; font-size: 17px; }
.settings p { font-size: 12px; line-height: 1.7; }
.settings label { display: flex; flex-direction: column; gap: 7px; margin: 15px 0; font-size: 13px; }
.settings input { padding: 8px; border: 1px solid #b8c9de; border-radius: 5px; color: #34445b; background: #f7f9fc; }
.settings footer { justify-content: flex-end; }
</style>
