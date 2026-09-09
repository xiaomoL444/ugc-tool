<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import JSZip from "jszip";
import { toast } from "vue-sonner";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import SelectableList from "@/components/UI/List/SelectableList.vue";
import { StorageClass } from "@/services/storage/storage";
import { downloadTextFile } from "@/utils/download";
import { ProjectID } from "../../constant/constant";
import EditorKindSelect from "../EditorKindSelect.vue";
import QuestPanel from "./QuestPanel.vue";
import type { QuestProject, QuestStructIds } from "./types";
import { createQuestProject, decodeQuestProject, encodeQuestProject, validateQuestProject, QUEST_STRUCT_ID_FIELDS } from "./questProject";
import { exportQuestVariables } from "./questExporter";
import { createWorkspaceSaveQueue } from "./workspaceSaveQueue";

withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" }>(), { editorKind: "Quest" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest"] }>();
const storage = inject<StorageClass>("storage")!;
const workspace = inject<Ref<string>>("selectedWorkspaceId")!;
// 工作区切换会重建 Panel；所有异步保存固定使用原工作区路径。
const directory = `/${workspace.value}/QuestEditor`;
const files = ref<string[]>([]);
const selectedFile = ref("");
const project = ref<QuestProject>();
const creating = ref(false);
const newName = ref("");
const busy = ref(false);
const exporting = ref(false);
const saveStatus = ref("未打开文件");
const settingsOpen = ref(false);
const settingsDraft = ref<QuestStructIds>();
const unassignedDraft = ref(-1);
const settingsError = ref("");
let disposed = false;
let loading = false;
let requestId = 0;
let listRequestId = 0;
let revision = 0;

function showError(error: unknown, fallback: string) {
  console.error(error);
  toast.error(error instanceof Error ? error.message : fallback);
}
const saveQueue = createWorkspaceSaveQueue(async (path, data) => {
  const version = revision;
  await storage.setProject(ProjectID).writeFile(path, data);
  if (!disposed && version === revision) saveStatus.value = "已自动保存";
}, (error) => { saveStatus.value = "保存失败"; showError(error, "任务保存失败"); });
defineExpose({ prepareToLeave: () => {
  if (busy.value) return Promise.reject(new Error("任务文件正在读写，请稍后切换"));
  settingsOpen.value = false;
  return saveQueue.flush();
} });

watch(project, () => {
  if (loading || disposed || !project.value || !selectedFile.value) return;
  revision++;
  saveStatus.value = "待保存…";
  saveQueue.schedule(`${directory}/${selectedFile.value}`, encodeQuestProject(project.value));
}, { deep: true, flush: "sync" });

async function refreshFiles() {
  const request = ++listRequestId;
  const result = await storage.setProject(ProjectID).getFiles(directory);
  if (!disposed && request === listRequestId) files.value = result.filter(name => name.endsWith(".json"));
}
async function selectFile(name: string, fromCreate = false) {
  if (busy.value && !fromCreate) return;
  const request = ++requestId;
  busy.value = true;
  try {
    await saveQueue.flush();
    const loaded = decodeQuestProject(await storage.setProject(ProjectID).readFile(`${directory}/${name}`));
    if (disposed || request !== requestId) return;
    loading = true;
    selectedFile.value = name;
    project.value = loaded;
    loading = false;
    settingsOpen.value = false;
    saveStatus.value = "已加载";
  } catch (error) { showError(error, "无法读取任务文件，原内容已保留"); }
  finally { if (request === requestId) busy.value = false; }
}
async function createFile() {
  if (busy.value) return;
  const base = newName.value.trim().replace(/\.json$/i, "");
  if (!base || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || base === "." || base === "..") {
    toast.warning("请输入有效文件名，不能包含路径或特殊字符"); return;
  }
  const name = `${base}.json`;
  busy.value = true;
  try {
    if (await storage.setProject(ProjectID).exists(`${directory}/${name}`)) { toast.warning("已有同名任务文件"); return; }
    await saveQueue.flush();
    await storage.setProject(ProjectID).writeFile(`${directory}/${name}`, encodeQuestProject(createQuestProject()));
    await refreshFiles();
    creating.value = false;
    newName.value = "";
    if (!disposed) await selectFile(name, true);
  } catch (error) { showError(error, "创建任务文件失败"); }
  finally { busy.value = false; }
}
async function deleteFile() {
  if (busy.value) return;
  const name = selectedFile.value;
  if (!name) { toast.warning("请先选择任务文件"); return; }
  if (!confirm(`将任务文件「${name}」移入回收站？文件内所有章节和任务都会一并移入。`)) return;
  busy.value = true;
  requestId++;
  try {
    await saveQueue.flush();
    await storage.setProject(ProjectID).trash(`${directory}/${name}`);
    saveQueue.discard(`${directory}/${name}`);
    requestId++;
    loading = true;
    project.value = undefined;
    selectedFile.value = "";
    loading = false;
    settingsOpen.value = false;
    saveStatus.value = "未打开文件";
    await refreshFiles();
    toast.success("任务文件已移入回收站");
  } catch (error) { showError(error, "删除失败，文件已保留"); }
  finally { busy.value = false; }
}
function downloadProject() {
  if (!project.value || !selectedFile.value) { toast.warning("请先打开任务文件"); return; }
  downloadTextFile(encodeQuestProject(project.value), selectedFile.value, "application/json");
}
async function exportVariables() {
  if (!project.value) return;
  const exportName = selectedFile.value.replace(/\.json$/i, "");
  exporting.value = true;
  try {
    const result = exportQuestVariables(project.value);
    const zip = new JSZip();
    for (const file of result.files) zip.file(file.filename, file.json);
    const blob = await zip.generateAsync({ type: "blob" });
    if (disposed) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}-千星任务.zip`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (result.warnings.length) { console.warn(result.warnings); toast.warning(result.warnings.join("；")); }
    else toast.success("已导出章节、主任务、子任务三份变量 JSON");
  } catch (error) { showError(error, "任务导出失败"); }
  finally { exporting.value = false; }
}
function openSettings() {
  if (!project.value) return;
  settingsDraft.value = { ...project.value.structIds };
  unassignedDraft.value = project.value.unassignedChapterId;
  settingsError.value = "";
  settingsOpen.value = true;
}
function applySettings() {
  if (!project.value || !settingsDraft.value) return;
  const candidate = { ...project.value, structIds: { ...settingsDraft.value }, unassignedChapterId: unassignedDraft.value };
  const errors = validateQuestProject(candidate);
  if (errors.length) { settingsError.value = errors.join("；"); return; }
  project.value.structIds = candidate.structIds;
  project.value.unassignedChapterId = candidate.unassignedChapterId;
  settingsOpen.value = false;
}
function saveShortcut(event: KeyboardEvent) {
  if (event.repeat || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  downloadProject();
}
async function changeEditor(kind: "Dialogue" | "Quest") {
  try { await saveQueue.flush(); emit("update:editorKind", kind); }
  catch { /* 保存失败时留在任务编辑器，防止丢失未保存内容。 */ }
}
onMounted(() => {
  void refreshFiles().catch(error => showError(error, "读取任务文件列表失败"));
  window.addEventListener("keydown", saveShortcut);
});
onBeforeUnmount(() => {
  disposed = true; requestId++;
  void saveQueue.flush().catch(() => undefined);
  window.removeEventListener("keydown", saveShortcut);
});
</script>

<template>
  <Splitter class="quest-editor" :inert="busy">
    <SplitterPanel :size="15">
      <div class="quest-file-panel">
        <EditorKindSelect :model-value="editorKind" @update:model-value="changeEditor" />
        <SectionLayout title="任务文件">
          <SelectableList :values="files" :selected-value="selectedFile" @select="selectFile" @add="creating = true" @delete="deleteFile" />
          <form v-if="creating" class="new-file-form" @submit.prevent="createFile">
            <input v-model="newName" aria-label="任务文件名" placeholder="任务文件名" autofocus :disabled="busy" />
            <div><button :disabled="busy" type="submit">创建</button><button type="button" @click="creating = false">取消</button></div>
          </form>
          <p class="file-help">任务文件保存在当前工作区，与对话文件分开管理。</p>
        </SectionLayout>
      </div>
    </SplitterPanel>
    <SplitterPanel :size="85">
      <SectionLayout title="任务编辑区">
        <div class="quest-workspace" :class="{ 'is-busy': busy }" :aria-busy="busy">
          <header class="quest-file-toolbar">
            <span>{{ selectedFile || '未选择任务文件' }}</span><small>{{ saveStatus }}</small>
            <button type="button" :disabled="!project || busy" @click="openSettings">结构体 ID 设置</button>
            <button type="button" :disabled="!project || busy" @click="downloadProject">下载编辑器 JSON · Ctrl+S</button>
            <button type="button" class="primary" :disabled="!project || busy || exporting" @click="exportVariables">{{ exporting ? '导出中…' : '导出千星任务' }}</button>
          </header>
          <QuestPanel v-if="project" :key="selectedFile" :project="project" :inert="busy" />
          <div v-else class="quest-empty"><h3>从一个章节，或一个主任务开始</h3><p>先新建任务文件，再编排当前工作区的任务。</p><button type="button" @click="creating = true">＋ 新建任务文件</button></div>
        </div>
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
  <Teleport to="body">
    <div v-if="settingsOpen && settingsDraft" :inert="busy" class="quest-settings-backdrop" @click.self="settingsOpen = false" @keydown.esc="settingsOpen = false">
      <form class="quest-settings" role="dialog" aria-modal="true" aria-label="任务结构体 ID 设置" @submit.prevent="applySettings">
        <header><h3>任务结构体 ID</h3><button type="button" aria-label="关闭任务结构体设置" @click="settingsOpen = false">×</button></header>
        <p>不同千星编辑器的结构体 ID 可能不同；修改后会同时替换嵌套结构体和字典类型。</p>
        <label v-for="field in QUEST_STRUCT_ID_FIELDS" :key="field.key">{{ field.label }}<input v-model="settingsDraft[field.key]" :aria-label="`${field.label} ID`" inputmode="numeric" /><small>{{ field.description }}</small></label>
        <label>无章节编号<input v-model.number="unassignedDraft" aria-label="无章节编号" type="number" step="1" /><small>直属主任务的“归属章节”字段使用此编号，默认 -1。</small></label>
        <p v-if="settingsError" class="settings-error" role="alert">{{ settingsError }}</p>
        <footer><button type="button" @click="settingsOpen = false">取消</button><button class="primary" type="submit">应用</button></footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.quest-editor { height: 100%; min-height: 0; }
.quest-file-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.quest-file-panel > .Section { flex: 1; min-height: 0; }
.quest-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; height: 100%; color: #34445b; }
.quest-workspace.is-busy { pointer-events: none; opacity: .7; }
.quest-file-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px; background: #eef3f9; border-bottom: 1px solid #d5deea; }
.quest-file-toolbar > span { font-weight: 600; font-size: 12px; overflow-wrap: anywhere; }
.quest-file-toolbar > small { margin-right: auto; color: #7f8ba0; font-size: 11px; }
button { padding: 6px 10px; border: 1px solid #b7c8de; border-radius: 5px; background: white; color: #325a89; cursor: pointer; font-size: 12px; }
button:disabled { opacity: .45; cursor: default; }
.primary { color: white; background: #2877c7; border-color: #2877c7; }
.file-help { font-size: 11px; line-height: 1.7; color: #8290a1; padding: 8px; }
.new-file-form { padding: 8px; }
.new-file-form input { box-sizing: border-box; width: 100%; padding: 7px; margin-bottom: 8px; font-size: 12px; border: 1px solid #b7c8de; }
.new-file-form > div { display: flex; gap: 5px; }
.quest-empty { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; padding: 24px; color: #718198; text-align: center; }
.quest-empty h3 { font-size: 16px; margin-bottom: 0; }
.quest-empty p { font-size: 13px; }
.quest-settings-backdrop { position: fixed; inset: 0; z-index: 11000; display: grid; place-items: center; padding: 20px; background: #13203388; }
.quest-settings { width: min(440px, 90vw); max-height: 85vh; overflow-y: auto; padding: 22px; border-radius: 12px; background: #fff; color: #34445b; }
.quest-settings header, .quest-settings footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.quest-settings h3 { margin: 0; font-size: 17px; }
.quest-settings p, .quest-settings small { color: #8090a5; font-size: 12px; line-height: 1.7; }
.quest-settings label { display: flex; flex-direction: column; gap: 5px; margin: 12px 0; font-size: 13px; }
.quest-settings input { box-sizing: border-box; width: 100%; padding: 8px; color: #34445b; font-size: 13px; border: 1px solid #b8c9de; background: #f7f9fc; }
.quest-settings .settings-error { color: #c14b4b; }
.quest-settings footer { justify-content: flex-end; margin-top: 18px; }
</style>
