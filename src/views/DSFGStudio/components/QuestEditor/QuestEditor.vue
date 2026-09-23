<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { toast } from "vue-sonner";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import { StorageClass } from "@/services/storage/storage";
import { downloadTextFile } from "@/utils/download";
import { ProjectID } from "../../constant/constant";
import EditorKindSelect from "../EditorKindSelect.vue";
import QuestPanel from "./QuestPanel.vue";
import type { QuestProject, QuestStructIds } from "./types";
import { createQuestProject, decodeQuestProject, encodeQuestProject, validateQuestProject, QUEST_STRUCT_ID_FIELDS } from "./questProject";
import { exportQuestVariables } from "./questExporter";
import { createWorkspaceSaveQueue } from "./workspaceSaveQueue";
import RuntimeImportButton from "../RuntimeImportButton.vue";
import { commitRuntimeImport } from "../runtimeImportStorage";
import { importQuest } from "./questImporter";

withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene" }>(), { editorKind: "Quest" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene"] }>();
const storage = inject<StorageClass>("storage")!;
const workspace = inject<Ref<string>>("selectedWorkspaceId")!;
// 工作区切换会重建 Panel；所有异步保存固定使用原工作区路径。
const workspaceId = workspace.value;
const documentPath = `/${workspaceId}/QuestEditor.json`;
const legacyDirectory = `/${workspaceId}/QuestEditor`;
const downloadBaseName = workspaceId.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "工作区";
const project = ref<QuestProject>();
const legacyFiles = ref<string[]>([]);
const legacySelection = ref("");
const loadError = ref("");
const busy = ref(false);
const exporting = ref(false);
const saveStatus = ref("准备读取任务");
const settingsOpen = ref(false);
const settingsDraft = ref<QuestStructIds>();
const unassignedDraft = ref(-1);
const settingsError = ref("");
let disposed = false;
let loading = false;
let requestId = 0;
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
  if (busy.value) return Promise.reject(new Error("任务数据正在读写，请稍后切换"));
  settingsOpen.value = false;
  return saveQueue.flush();
} });

watch(project, () => {
  if (loading || disposed || !project.value) return;
  revision++;
  saveStatus.value = "待保存…";
  saveQueue.schedule(documentPath, encodeQuestProject(project.value));
}, { deep: true, flush: "sync" });

async function loadProject(legacyFile?: string) {
  if (busy.value || disposed || project.value) return;
  const request = ++requestId;
  const active = () => !disposed && request === requestId;
  busy.value = true;
  loadError.value = "";
  saveStatus.value = "正在读取任务…";
  try {
    let loaded: QuestProject;
    let migratedFrom = "";
    let status = "已加载";
    const exists = await storage.setProject(ProjectID).exists(documentPath);
    if (!active()) return;
    if (exists) {
      // 已有固定任务配置时只读这一份，不能因读取失败而用空配置或旧备份覆盖它。
      loaded = decodeQuestProject(await storage.setProject(ProjectID).readFile(documentPath));
    } else {
      const hasLegacyDirectory = await storage.setProject(ProjectID).exists(legacyDirectory);
      if (!active()) return;
      const entries = hasLegacyDirectory ? await storage.setProject(ProjectID).getFiles(legacyDirectory) : [];
      if (!active()) return;
      const candidates = entries.filter(name => /^[^/\\]+\.json$/i.test(name)).sort();
      legacyFiles.value = candidates;
      if (legacyFile !== undefined && !candidates.includes(legacyFile)) {
        throw new Error("选中的旧任务文件已不存在，请重新选择。");
      }
      if (legacyFile === undefined && candidates.length > 1) {
        saveStatus.value = "请选择要沿用的旧任务";
        return;
      }
      migratedFrom = legacyFile ?? candidates[0] ?? "";
      loaded = migratedFrom
        ? decodeQuestProject(await storage.setProject(ProjectID).readFile(`${legacyDirectory}/${migratedFrom}`))
        : createQuestProject();
      if (!active()) return;
      // 先保存固定配置，再开放编辑；旧文件仅作备份保留，不删除、不重编号、不合并。
      await storage.setProject(ProjectID).writeFile(documentPath, encodeQuestProject(loaded));
      status = migratedFrom ? "已沿用旧任务" : "已创建工作区任务";
    }
    if (!active()) return;
    loading = true;
    project.value = loaded;
    loading = false;
    legacyFiles.value = [];
    legacySelection.value = "";
    saveStatus.value = status;
    if (migratedFrom) toast.success(`已沿用「${migratedFrom}」，原文件已保留为备份`);
  } catch (error) {
    if (active()) {
      loadError.value = error instanceof Error ? error.message : "无法读取工作区任务，原数据已保留";
      saveStatus.value = "读取失败";
      showError(error, "无法读取工作区任务，原数据已保留");
    }
  } finally { if (active()) busy.value = false; }
}
async function exportVariables() {
  if (!project.value || exporting.value || disposed) return;
  const exportName = downloadBaseName;
  exporting.value = true;
  try {
    const result = exportQuestVariables(project.value);
    if (disposed) return;
    downloadTextFile(result.json, `${exportName}-任务配置数据.json`, "application/json");
    if (result.warnings.length) { console.warn(result.warnings); toast.warning(result.warnings.join("；")); }
    else toast.success("已导出任务配置数据 JSON");
  } catch (error) { showError(error, "任务导出失败"); }
  finally { exporting.value = false; }
}
async function importConfiguration(file: File) {
  if (busy.value || disposed || exporting.value) return;
  busy.value = true;
  try {
    const result = await commitRuntimeImport({ file, decode: importQuest, encode: encodeQuestProject,
      storage: storage.setProject(ProjectID), active: () => !disposed, flush: () => saveQueue.flush(),
      overwrite: { path: documentPath, backupDirectory: `/${workspaceId}/ImportBackups/Quest`,
        confirm: () => confirm("导入将覆盖当前工作区的全部任务配置。原配置会先备份，是否继续？") } });
    if (!result) return;
    loading = true; project.value = result.project; loading = false;
    settingsOpen.value = false; legacyFiles.value = []; legacySelection.value = ""; loadError.value = ""; saveStatus.value = "已导入";
    toast.success("任务配置已覆盖导入，原配置已备份");
  } finally { loading = false; if (!disposed) busy.value = false; }
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
async function changeEditor(kind: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene") {
  try { await saveQueue.flush(); emit("update:editorKind", kind); }
  catch { /* 保存失败时留在任务编辑器，防止丢失未保存内容。 */ }
}
onMounted(() => {
  void loadProject();
});
onBeforeUnmount(() => {
  disposed = true; requestId++;
  void saveQueue.flush().catch(() => undefined);
});
</script>

<template>
  <div class="quest-editor" :inert="busy" :aria-busy="busy">
      <EditorKindSelect :model-value="editorKind" @update:model-value="changeEditor" />
      <SectionLayout title="任务编辑区">
        <div class="quest-workspace" :class="{ 'is-busy': busy }" :aria-busy="busy">
          <header class="quest-file-toolbar">
            <span>{{ workspaceId }} <span class="workspace-label">/ 工作区任务</span></span><small role="status" :class="{ 'save-error': saveStatus === '保存失败' }">{{ saveStatus }}</small>
            <button type="button" :disabled="!project || busy" @click="openSettings">结构体 ID 设置</button>
            <RuntimeImportButton :disabled="busy || exporting" :import-file="importConfiguration" />
            <button type="button" class="primary" :disabled="!project || busy || exporting" @click="exportVariables">{{ exporting ? '导出中…' : '导出千星任务' }}</button>
          </header>
          <QuestPanel v-if="project" :project="project" :inert="busy" />
          <div v-else class="quest-empty">
            <template v-if="legacyFiles.length > 1">
              <h3>选择要沿用的旧任务</h3>
              <p>每个工作区现在只有一份任务配置。检测到多份旧文件，请选择一份沿用；其他原文件保留为备份，不会合并或删除。</p>
              <form class="legacy-choice" @submit.prevent="loadProject(legacySelection)">
                <select v-model="legacySelection" aria-label="沿用旧任务文件" :disabled="busy">
                  <option disabled value="">请选择一份旧任务</option>
                  <option v-for="file in legacyFiles" :key="file" :value="file">{{ file }}</option>
                </select>
                <button type="submit" :disabled="busy || !legacySelection">沿用这份任务</button>
              </form>
            </template>
            <template v-else><h3>{{ busy ? '正在打开工作区任务…' : '工作区任务暂未加载' }}</h3><p>每个工作区只有一份任务配置，首次进入时自动创建。</p></template>
            <p v-if="loadError" class="load-error" role="alert">{{ loadError }}<br />原数据不会被空配置覆盖。</p>
            <button v-if="loadError && !busy" type="button" @click="loadProject()">重新读取</button>
          </div>
        </div>
      </SectionLayout>
  </div>
  <Teleport to="body">
    <div v-if="settingsOpen && settingsDraft" :inert="busy" class="quest-settings-backdrop dsfg-typography" @click.self="settingsOpen = false" @keydown.esc="settingsOpen = false">
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
.quest-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.quest-editor > .Section { flex: 1; min-height: 0; }
.quest-editor > .editor-kind-select { flex: 0 0 auto; }
.quest-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; height: 100%; color: #34445b; }
.quest-workspace.is-busy { pointer-events: none; opacity: .7; }
.quest-file-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; background: #fff; border-bottom: 1px solid #d5deea; }
.quest-file-toolbar > span { font-weight: 600; font-size: 12px; overflow-wrap: anywhere; }
.quest-file-toolbar > small { margin-right: auto; color: #52806b; background: #edf6f0; padding: 4px 8px; border-radius: 20px; font-size: 11px; }
.quest-file-toolbar > small.save-error { color: #b45309; background: #fff4e5; }
.workspace-label { color: #8793a6; font-weight: 400; }
.quest-editor :deep(.Section > .panel) { padding: 0; }
.quest-editor :deep(.Section > .MainBox .title) { background: #f8faff; color: #425673; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e0e6ef; height: 36px; }
button { padding: 6px 10px; border: 1px solid #b7c8de; border-radius: 5px; background: white; color: #325a89; cursor: pointer; font-size: 12px; }
button:disabled { opacity: .45; cursor: default; }
.primary { color: white; background: #2877c7; border-color: #2877c7; }
.legacy-choice { display: flex; flex-wrap: wrap; gap: 8px; max-width: 100%; }
.legacy-choice select { min-width: 0; max-width: 100%; padding: 7px; font-size: 13px; border: 1px solid #b7c8de; border-radius: 5px; color: #325a89; background: white; }
.quest-empty { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; padding: 24px; color: #718198; text-align: center; }
.quest-empty h3 { font-size: 16px; margin-bottom: 0; }
.quest-empty p { font-size: 13px; max-width: 560px; line-height: 1.8; }
.quest-empty .load-error { color: #b45309; overflow-wrap: anywhere; }
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
