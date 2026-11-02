<script setup lang="ts">

import "./editorTypography.css";

import {
  reactive,
  computed,
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  provide,
  inject,
  onBeforeMount,
  type Component,
} from "vue";
import { consola } from "consola";
import { toast } from "vue-sonner";
import { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "./constant/constant";
import DialogueEditor from "./components/DialogueEditor/DialogueEditor.vue";
import QuestEditor from "./components/QuestEditor/QuestEditor.vue";
import WalkTalkEditor from "./components/WalkTalkEditor/WalkTalkEditor.vue";
import EntityPresetEditor from "./components/EntityPresetEditor/EntityPresetEditor.vue";
import SceneEditor from "./components/SceneEditor/SceneEditor.vue";
import CameraEditor from "./components/CameraEditor/CameraEditor.vue";
import { SCENE_FILE, createSceneProject, encodeSceneProject } from "./components/SceneEditor/sceneProject";
import StudioIcon from "./components/StudioIcon.vue";
import StudioCreateDialog from "./components/StudioCreateDialog.vue";
import StudioWorkspaceSelect from "./components/StudioWorkspaceSelect.vue";
import StudioEditorSession from "./components/StudioEditorSession.vue";
import StudioHistoryToolbar from "./components/StudioHistoryToolbar.vue";
import { createStudioSessionHistory, studioSessionHistoryKey } from "./components/studioSessionHistory";
import { studioSidebarKey, type StudioEditorKind } from "./components/studioSidebar";
import WorkspaceStructIdSettings from "./components/WorkspaceStructIdSettings.vue";
import StudioSelectField from "./components/StudioSelectField.vue";
import { workspaceFileTypeOptions, isWorkspaceFileType, WorkspaceFileType } from "./components/versioning/types";
import WorkspaceVersionSettings from "./components/WorkspaceVersionSettings.vue";
import { createWorkspaceSettings, createNewWorkspaceSettings, encodeWorkspaceSettings, loadWorkspaceSettings, workspaceNameError, workspaceTargetKey,
  WORKSPACE_SETTINGS_FILE, type WorkspaceSettings } from "./components/workspaceSettings";
import { workspaceTargetErrors } from "./components/versioning/catalog";
import { workspaceSettingsKey } from "./components/useWorkspaceSettings";
import { isWorkspaceFeatureAvailable } from "./components/workspaceFeatures";
import WorkspaceGilCalibrationPanel from "./components/WorkspaceGilCalibration.vue";
import { workspaceGilCalibrationFiles, type WorkspaceGilCalibration } from "./components/workspaceGilCalibration";
import { createWorkspaceStructIds, loadWorkspaceStructIds, encodeWorkspaceStructIds, validateWorkspaceStructIds,
  WORKSPACE_STRUCT_IDS_FILE, type WorkspaceStructIdState, type WorkspaceStructIds } from "./components/workspaceStructIds";
import { workspaceStructIdsKey } from "./components/useWorkspaceStructIds";
import "./studioShell.css";

const storage = inject<StorageClass>("storage")!.setProject(ProjectID); //储存区

const workspaceIds = ref<string[]>([]); //工作区的所有id
const selectedWorkspaceId = ref(""); //选择的工作区
const workspaceMemoryKey = `${ProjectID}:lastWorkspaceId`;
function readLastWorkspaceId(): string {
  try { return localStorage.getItem(workspaceMemoryKey) || ""; }
  catch (error) { consola.warn("无法读取上次选择的工作区", error); return ""; }
}
function rememberWorkspace(id: string): void {
  try {
    if (id) localStorage.setItem(workspaceMemoryKey, id);
    else localStorage.removeItem(workspaceMemoryKey);
  } catch (error) { consola.warn("无法记住当前工作区", error); }
}
const studioElement = ref<HTMLElement>();
const editorSessions = new Map<StudioEditorKind, { prepareToLeave: () => Promise<void> }>();
const visitedEditors = ref<StudioEditorKind[]>(["Dialogue"]);
function setEditorRef(kind: StudioEditorKind, instance: unknown) {
  if (instance) editorSessions.set(kind, instance as { prepareToLeave: () => Promise<void> });
  else editorSessions.delete(kind);
}
const activeEditor = () => editorSessions.get(selectedFunction.value);
const switchingEditor = ref(false);
const creatingWorkspace = ref(false);
const newWorkspaceName = ref("");
const newWorkspaceSettings = ref(createNewWorkspaceSettings());
const newWorkspaceFileType = computed<WorkspaceFileType>({
  get: () => newWorkspaceSettings.value.fileType,
  set: fileType => { newWorkspaceSettings.value = { ...newWorkspaceSettings.value, fileType }; },
});
const newWorkspaceTargetErrors = computed(() => workspaceTargetErrors(newWorkspaceSettings.value));
const newWorkspaceCalibration = ref<WorkspaceGilCalibration>();
const newWorkspaceGilBusy = ref(false);
watch(() => workspaceTargetKey(newWorkspaceSettings.value), () => { newWorkspaceCalibration.value = undefined; }, { flush: "sync" });
const newWorkspaceRequiresGil = computed(() => newWorkspaceFileType.value !== WorkspaceFileType.BeyondMap);
const newWorkspaceCalibrationFiles = computed(() => {
  if (!newWorkspaceCalibration.value) return undefined;
  try { return workspaceGilCalibrationFiles(newWorkspaceCalibration.value); }
  catch { return undefined; }
});
function openCreateWorkspace() {
  newWorkspaceName.value = "";
  newWorkspaceSettings.value = createNewWorkspaceSettings();
  newWorkspaceCalibration.value = undefined;
  newWorkspaceGilBusy.value = false;
  creatingWorkspace.value = true;
}
const addingWorkspace = ref(false);
const structSettingsOpen = ref(false);
const structSettingsError = ref("");
const structSettings = ref<WorkspaceStructIdState>({ ids: createWorkspaceStructIds(), candidates: {}, warnings: [] });
const workspaceStructIds = computed(() => structSettings.value.ids);
const workspaceSettings = ref(createWorkspaceSettings());
const workspaceSettingsError = ref("");
provide(workspaceSettingsKey, computed(() => workspaceSettings.value));
const settingsLoadError = computed(() => [workspaceSettingsError.value, structSettingsError.value].filter(Boolean).join("；"));
async function readWorkspaceSettings(workspaceId: string) {
  try {
    workspaceSettings.value = await loadWorkspaceSettings(storage.setProject(ProjectID), workspaceId);
    workspaceSettingsError.value = "";
  } catch (error) {
    workspaceSettings.value = createWorkspaceSettings();
    workspaceSettingsError.value = error instanceof Error ? error.message : "工作区设置读取失败，原文件已保留。";
  }
}
const sessionHistory = createStudioSessionHistory({
  currentEditor: () => selectedFunction.value,
  switchEditor: activateEditor,
  blocked: () => switchingEditor.value || structSettingsOpen.value || !selectedWorkspaceId.value,
});
provide(studioSessionHistoryKey, sessionHistory);
async function runSessionHistory(action: "undo" | "redo") {
  try { await sessionHistory[action](); }
  catch (error) { toast.error(error instanceof Error ? error.message : "编辑历史恢复失败"); }
}
const shellHistory = {
  canUndo: sessionHistory.canUndo, canRedo: sessionHistory.canRedo,
  undo: () => runSessionHistory("undo"), redo: () => runSessionHistory("redo"),
};
let pointerHeld = false;
function trackPointer(event: PointerEvent) { if (event.button === 0) pointerHeld = true; }
function releasePointer() { pointerHeld = false; }
function historyShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase(), target = event.target as Element | null;
  if (event.defaultPrevented || event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey)
    || !["z", "y"].includes(key) || pointerHeld || sessionHistory.busy.value || switchingEditor.value || structSettingsOpen.value
    || !selectedWorkspaceId.value || target?.closest?.("input:not([type='checkbox']):not([type='radio']):not([type='range']), textarea, [contenteditable]:not([contenteditable='false']), [role='dialog'], dialog")
    || (!studioElement.value?.contains(target) && target !== document.body && target !== document.documentElement
      && !target?.closest?.("[data-clip-editor], .studio-select-menu"))) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat) void runSessionHistory(key === "y" || event.shiftKey ? "redo" : "undo");
}
onMounted(() => {
  window.addEventListener("keydown", historyShortcut, true);
  window.addEventListener("pointerdown", trackPointer, true);
  window.addEventListener("pointerup", releasePointer, true);
  window.addEventListener("pointercancel", releasePointer, true);
  window.addEventListener("blur", releasePointer);
});
onBeforeUnmount(() => {
  sessionHistory.dispose();
  window.removeEventListener("keydown", historyShortcut, true);
  window.removeEventListener("pointerdown", trackPointer, true);
  window.removeEventListener("pointerup", releasePointer, true);
  window.removeEventListener("pointercancel", releasePointer, true);
  window.removeEventListener("blur", releasePointer);
});
provide(workspaceStructIdsKey, { ids: workspaceStructIds, error: structSettingsError });
async function readStructSettings(workspaceId: string) {
  try {
    const state = await loadWorkspaceStructIds(storage.setProject(ProjectID), workspaceId);
    structSettings.value = state; structSettingsError.value = "";
  } catch (error) {
    structSettings.value = { ids: createWorkspaceStructIds(), candidates: {}, warnings: [] };
    structSettingsError.value = error instanceof Error ? error.message : "工作区结构体设置读取失败";
  }
}
async function openStructSettings() {
  if (!selectedWorkspaceId.value || switchingEditor.value || sessionHistory.busy.value) return;
  switchingEditor.value = true;
  try {
    sessionHistory.finishRegistered();
    for (const editor of editorSessions.values()) await editor.prepareToLeave();
    await readStructSettings(selectedWorkspaceId.value);
    await readWorkspaceSettings(selectedWorkspaceId.value);
    structSettingsOpen.value = true;
  } catch (error) { toast.error(error instanceof Error ? error.message : "暂时无法打开设置"); }
  finally { switchingEditor.value = false; }
}
async function retryStructSettings() {
  structSettingsOpen.value = false;
  await openStructSettings();
}
async function saveStructSettings(ids: WorkspaceStructIds, settings: WorkspaceSettings, name: string) {
  if (settingsLoadError.value) throw new Error("请先重新读取工作区设置，原文件未被覆盖。");
  const nextName = name.trim(), nameError = workspaceNameError(nextName, workspaceIds.value, selectedWorkspaceId.value);
  if (nameError) throw new Error(nameError);
  const targetText = encodeWorkspaceSettings(settings);
  const targetChanged = workspaceTargetKey(settings) !== workspaceTargetKey(workspaceSettings.value);
  const text = encodeWorkspaceStructIds(ids, settings), workspaceId = selectedWorkspaceId.value;
  await storage.setProject(ProjectID).writeFile(`/${workspaceId}/${WORKSPACE_STRUCT_IDS_FILE}`, text);
  await storage.setProject(ProjectID).writeFile(`/${workspaceId}/${WORKSPACE_SETTINGS_FILE}`, targetText);
  if (selectedWorkspaceId.value !== workspaceId) return;
  structSettings.value = { ids: JSON.parse(text).ids, candidates: {}, warnings: [] };
  workspaceSettings.value = JSON.parse(targetText);
  resetUnavailableEditors();
  if (targetChanged) sessionHistory.clear();
}
async function finishWorkspaceSettings(name: string) {
  const nextName = name.trim(), workspaceId = selectedWorkspaceId.value;
  if (nextName !== workspaceId) {
    try {
      await storage.setProject(ProjectID).rename(`/${workspaceId}`, nextName);
    } catch (error) {
      throw new Error(`设置已保存，但工作区重命名失败：${error instanceof Error ? error.message : String(error)}`);
    }
    sessionHistory.clear();
    visitedEditors.value = [selectedFunction.value];
    selectedWorkspaceId.value = nextName;
    rememberWorkspace(nextName);
    workspaceIds.value = workspaceIds.value.map(id => id === workspaceId ? nextName : id);
  }
  toast.success("工作区设置已保存，所有模块统一生效");
}
provide("selectedWorkspaceId", selectedWorkspaceId);
const sidebarTarget = ref<HTMLElement>();
provide(studioSidebarKey, sidebarTarget);
const editorTabs = [
  { value: "Dialogue", label: "对话" }, { value: "Quest", label: "任务" },
  { value: "Camera", label: "镜头" },
  { value: "Scene", label: "场景" }, { value: "EntityPresets", label: "预设" },
] as const;
const visibleEditorTabs = computed(() => editorTabs.filter(tab => isWorkspaceFeatureAvailable(tab.value, workspaceSettings.value)));
function resetUnavailableEditors() {
  if (!isWorkspaceFeatureAvailable(selectedFunction.value, workspaceSettings.value)) selectedFunction.value = "Dialogue";
  visitedEditors.value = visitedEditors.value.filter(kind => isWorkspaceFeatureAvailable(kind, workspaceSettings.value));
  if (!visitedEditors.value.includes(selectedFunction.value)) visitedEditors.value.push(selectedFunction.value);
}
function selectWorkspace(id: string) {
  void ChangeWorkspace(id);
}

/**
 * 刷新工作区
 */
async function RefreshWorkspace() {
  consola.debug("刷新工作区");
  workspaceIds.value = await storage.getFolders("/");
}
/**
 * 添加工作区
 */
async function AddWorkspace() {
  if (addingWorkspace.value || newWorkspaceGilBusy.value) return;
  const inputId = newWorkspaceName.value.trim();
  const nameError = workspaceNameError(inputId, workspaceIds.value);
  if (nameError) { toast.warning(nameError); return; }
  if (!isWorkspaceFileType(newWorkspaceFileType.value)) { toast.warning("请选择项目文件类型"); return; }
  if (newWorkspaceTargetErrors.value.length) { toast.warning(newWorkspaceTargetErrors.value.join("；")); return; }
  const calibratedFiles = newWorkspaceRequiresGil.value ? newWorkspaceCalibrationFiles.value : undefined;
  if (newWorkspaceRequiresGil.value && !calibratedFiles) { toast.warning("请先导入 GIL 存档并完成参数校对"); return; }
  const settings = createWorkspaceSettings(newWorkspaceSettings.value);
  const workspacePath = `/${inputId}`;
  let created = false, initialized = false;
  addingWorkspace.value = true;
  try {
    if (await storage.setProject(ProjectID).exists(workspacePath)) throw new Error("工作区已存在，请更换名称。");
    await storage.mkdir(workspacePath);
    created = true;
    if (settings.fileType === WorkspaceFileType.BeyondMap) await storage.writeFile(`${workspacePath}/${SCENE_FILE}`, encodeSceneProject(createSceneProject()));
    for (const [file, text] of Object.entries(calibratedFiles ?? {})) await storage.setProject(ProjectID).writeFile(`${workspacePath}/${file}`, text);
    await storage.setProject(ProjectID).writeFile(`${workspacePath}/${WORKSPACE_SETTINGS_FILE}`, encodeWorkspaceSettings(settings));
    initialized = true;
    await RefreshWorkspace();
    creatingWorkspace.value = false; newWorkspaceName.value = "";
    await ChangeWorkspace(inputId);
  } catch (error) {
    consola.error(error);
    if (created && !initialized) {
      try { await storage.setProject(ProjectID).trash(workspacePath); }
      catch (cleanupError) { consola.error(cleanupError); toast.error("初始化未完成，无法清理临时工作区，请更换名称后重试。"); return; }
    }
    toast.error(error instanceof Error ? error.message : "工作区初始化失败，请重试");
  }
  finally { addingWorkspace.value = false; }
}
/**
 * 删除工作区
 * @param index 删除的工作区的序号
 */
async function DelectWorkspace(isForce = false): Promise<boolean> {
  if (switchingEditor.value || sessionHistory.busy.value) return false;

  if (selectedWorkspaceId.value == "") {
    toast.warning("未选择任何工作区");
    return false;
  }

  if (
    isForce ||
    confirm(`确认要删除 工作区:【${selectedWorkspaceId.value}】 嘛？`)
  ) {
    switchingEditor.value = true;
    try {
      sessionHistory.finishRegistered();
      for (const editor of editorSessions.values()) await editor.prepareToLeave();
      const workspaceId = selectedWorkspaceId.value;
      await storage.setProject(ProjectID).trash(`/${workspaceId}`);
      selectedWorkspaceId.value = "";
      structSettingsOpen.value = false;
      workspaceSettings.value = createWorkspaceSettings();
      workspaceSettingsError.value = "";
      rememberWorkspace("");
      sessionHistory.clear(); visitedEditors.value = [selectedFunction.value];
      await RefreshWorkspace();
      return true;
    } catch (error) { consola.error(error); toast.error("工作区删除失败，当前编辑内容已保留"); }
    finally { switchingEditor.value = false; }
  }
  return false;
}

/**
 * 切换工作区
 * @param index 点击的工作区
 * @param isForce 是否强制切换
 */
async function ChangeWorkspace(id: string, isForce = false) {
  if (switchingEditor.value || sessionHistory.busy.value) return;
  consola.info(`切换工作区：${id}`);

  const oldValue = selectedWorkspaceId.value;
  const newValue = id;

  if (oldValue == newValue && !isForce) {
    return;
  }

  switchingEditor.value = true;
  try {
    sessionHistory.finishRegistered();
    await activeEditor()?.prepareToLeave();
    await readStructSettings(id);
    await readWorkspaceSettings(id);
    sessionHistory.clear();
    resetUnavailableEditors();
    visitedEditors.value = [selectedFunction.value];
    selectedWorkspaceId.value = id;
    rememberWorkspace(id);
    structSettingsOpen.value = false;
    if (structSettingsError.value || validateWorkspaceStructIds(structSettings.value.ids, workspaceSettings.value).length) {
      toast.warning("请点击工作区右侧的三点按钮，在「工作区设置」中配置结构体 ID；旧配置存在冲突或读取问题。");
    }
    if (workspaceSettingsError.value) toast.warning(workspaceSettingsError.value);
  } catch (error) { consola.error(error); toast.error("保存失败，暂未切换工作区"); }
  finally { switchingEditor.value = false; }
}

async function ChangeEditorKind(kind: StudioEditorKind) {
  if (switchingEditor.value || sessionHistory.busy.value || selectedFunction.value === kind) return;
  const before = selectedFunction.value;
  try {
    sessionHistory.finishRegistered();
    await activateEditor(kind);
    sessionHistory.recordSwitch(before, kind);
  } catch (error) { consola.error(error); toast.error(error instanceof Error ? error.message : "保存失败，暂未切换编辑器"); }
}

async function activateEditor(kind: StudioEditorKind) {
  if (!isWorkspaceFeatureAvailable(kind, workspaceSettings.value)) throw new Error("当前文件类型不支持此编辑器。");
  if (selectedFunction.value === kind) return;
  if (switchingEditor.value) throw new Error("正在切换编辑器，请稍后重试。");
  switchingEditor.value = true;
  try {
    await activeEditor()?.prepareToLeave();
    if (!visitedEditors.value.includes(kind)) visitedEditors.value.push(kind);
    selectedFunction.value = kind;
    await nextTick();
  }
  finally { switchingEditor.value = false; }
}

onBeforeMount(async () => {
  await RefreshWorkspace();
  //如果工作区的长度为0则执行初始化操作
  if (workspaceIds.value.length == 0) {
    consola.info("结构体编辑页面无存档，进行初始创建中");
    await storage.mkdir("/默认工作区");
    await storage.writeFile(`/默认工作区/${SCENE_FILE}`, encodeSceneProject(createSceneProject()));
    await RefreshWorkspace();
  }
  const rememberedId = readLastWorkspaceId();
  const initialId = workspaceIds.value.includes(rememberedId) ? rememberedId : workspaceIds.value[0];
  if (initialId) await ChangeWorkspace(initialId, true);
  selectedFunction.value = "Dialogue";
});

const selectedFunction = ref<StudioEditorKind>("Dialogue");
function onSelectFunction() {}

const functionViewMap: Record<StudioEditorKind, Component> = {
  Dialogue: DialogueEditor,
  Quest: QuestEditor,
  WalkTalk: WalkTalkEditor,
  EntityPresets: EntityPresetEditor,
  Scene: SceneEditor,
  Camera: CameraEditor,
};
</script>

<template>
  <div ref="studioElement" class="dsfg-typography dsfg-studio" :class="{ 'editor-switching': switchingEditor }" :inert="switchingEditor || structSettingsOpen || sessionHistory.busy.value">
    <aside class="studio-sidebar" aria-label="工作区与编辑内容">
      <div class="studio-workspace-picker">
        <StudioWorkspaceSelect :model-value="selectedWorkspaceId" :workspaces="workspaceIds" :disabled="addingWorkspace || switchingEditor" @select="selectWorkspace" />
        <button type="button" class="studio-icon-button" title="新建工作区" aria-label="新建工作区" :disabled="addingWorkspace" @click="openCreateWorkspace"><StudioIcon name="plus" /></button>
        <button type="button" class="studio-icon-button" title="工作区设置" aria-label="工作区设置" :disabled="!selectedWorkspaceId || addingWorkspace || switchingEditor" @click="openStructSettings"><StudioIcon name="more" /></button>
      </div>
      <nav class="studio-feature-tabs" aria-label="编辑内容">
        <button v-for="tab in visibleEditorTabs" :key="tab.value" type="button" :aria-pressed="selectedFunction === tab.value || (tab.value === 'Dialogue' && selectedFunction === 'WalkTalk')" @click="tab.value === 'Dialogue' && selectedFunction === 'WalkTalk' ? undefined : ChangeEditorKind(tab.value)">{{ tab.label }}</button>
      </nav>
      <div v-if="selectedFunction === 'Dialogue' || selectedFunction === 'WalkTalk'" class="studio-dialogue-navigation">
        <div class="studio-sidebar-heading"><strong>对话文件</strong></div>
        <div class="studio-dialogue-modes" role="group" aria-label="对话编辑类型"><button type="button" :aria-pressed="selectedFunction === 'Dialogue'" @click="ChangeEditorKind('Dialogue')">演出对话</button><button type="button" :aria-pressed="selectedFunction === 'WalkTalk'" @click="ChangeEditorKind('WalkTalk')">边走边说</button></div>
      </div>
      <div ref="sidebarTarget" class="studio-sidebar-content"></div>
      <p v-if="!selectedWorkspaceId" class="studio-sidebar-placeholder">选择或新建工作区开始编辑</p>
    </aside>
    <main class="studio-main" aria-label="编辑区">
      <div v-if="selectedWorkspaceId" class="studio-session-history"><StudioHistoryToolbar compact session-toolbar :history="shellHistory" /></div>
        <template v-if="selectedWorkspaceId && sidebarTarget">
          <StudioEditorSession v-for="kind in visitedEditors" :key="`${selectedWorkspaceId}:${kind}`"
            :ref="instance => setEditorRef(kind, instance)" :active="selectedFunction === kind" :editor="functionViewMap[kind]" :kind="kind"
            @update:editor-kind="ChangeEditorKind" />
        </template>
        <div v-else class="studio-empty"><StudioIcon name="folder" :size="44" /><h2>从一个工作区开始</h2><p>在左侧选择工作区，或创建一个新的工作区。</p><button type="button" @click="openCreateWorkspace">＋ 新建工作区</button></div>
    </main>
    <StudioCreateDialog v-if="creatingWorkspace" v-model="newWorkspaceName" class="workspace-create-dialog" title="新建工作区" label="工作区名称" placeholder="输入工作区名称" :busy="addingWorkspace" :submit-disabled="!!newWorkspaceTargetErrors.length || newWorkspaceGilBusy || (newWorkspaceRequiresGil && !newWorkspaceCalibrationFiles)" @submit="AddWorkspace()" @close="creatingWorkspace = false">
      <template #default="{ overlayTarget }">
        <label class="workspace-create-field">项目文件类型<StudioSelectField v-model="newWorkspaceFileType" :to="overlayTarget" :disabled="addingWorkspace || newWorkspaceGilBusy" aria-label="项目文件类型"><option v-for="option in workspaceFileTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></StudioSelectField></label>
        <WorkspaceVersionSettings v-model="newWorkspaceSettings" :overlay-target="overlayTarget" :disabled="addingWorkspace || newWorkspaceGilBusy" />
        <WorkspaceGilCalibrationPanel v-if="newWorkspaceRequiresGil" :target="newWorkspaceSettings" :overlay-target="overlayTarget" :disabled="addingWorkspace" @change="newWorkspaceCalibration = $event" @busy="newWorkspaceGilBusy = $event" />
      </template>
    </StudioCreateDialog>
    <WorkspaceStructIdSettings v-if="structSettingsOpen" :workspace="selectedWorkspaceId" :state="structSettings" :settings="workspaceSettings" :load-error="settingsLoadError" :save-settings="saveStructSettings" :finish-settings="finishWorkspaceSettings" :delete-workspace="DelectWorkspace" @close="structSettingsOpen = false" @retry="retryStructSettings" />
  </div>
</template>

<style scoped>
.workspace-create-field { display: grid; gap: 8px; color: #34445b; font-size: 13px; }
.workspace-create-dialog.studio-create-dialog { width: min(540px, calc(100vw - 32px)); }
.editor-switching { pointer-events: none; opacity: .75; }
.timeline-editor {
  height: 100%;
  width: 100%;
  background: #1e1e1e;
  color: white;
}

.header {
  display: flex;
}

.track-label-space {
  width: 120px;
}

.navigator {
  height: 40px;
  position: relative;
  background: #111;
  flex: 1;
}

.bar {
  position: absolute;
  top: 18px;
  width: 100%;
  height: 4px;
  background: #444;
}

.view-window {
  position: absolute;
  top: 8px;
  height: 24px;
  background: #66aaff55;
  border: 1px solid #66aaff;
  cursor: move;
}

.handle {
  position: absolute;
  width: 8px;
  top: 0;
  bottom: 0;
  background: #66aaff;
  cursor: ew-resize;
}

.left {
  left: -4px;
}

.right {
  right: -4px;
}
</style>
