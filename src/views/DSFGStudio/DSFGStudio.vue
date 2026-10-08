<script setup lang="ts">
import "./editorTypography.css";

import {
  reactive,
  computed,
  ref,
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
const addingWorkspace = ref(false);
const workspaceMenu = ref<HTMLDetailsElement>();
function closeWorkspaceMenuOutside(event: PointerEvent) {
  const menu = workspaceMenu.value;
  if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
}
onMounted(() => document.addEventListener("pointerdown", closeWorkspaceMenuOutside, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeWorkspaceMenuOutside, true));
const structSettingsOpen = ref(false);
const structSettingsError = ref("");
const structSettings = ref<WorkspaceStructIdState>({ ids: createWorkspaceStructIds(), candidates: {}, warnings: [] });
const workspaceStructIds = computed(() => structSettings.value.ids);
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
    await activeEditor()?.prepareToLeave();
    await readStructSettings(selectedWorkspaceId.value);
    structSettingsOpen.value = true;
  } catch (error) { toast.error(error instanceof Error ? error.message : "暂时无法打开设置"); }
  finally { switchingEditor.value = false; }
}
async function retryStructSettings() {
  structSettingsOpen.value = false;
  await openStructSettings();
}
async function saveStructSettings(ids: WorkspaceStructIds) {
  if (structSettingsError.value) throw new Error("请先重新读取工作区设置，原文件未被覆盖。");
  const text = encodeWorkspaceStructIds(ids), workspaceId = selectedWorkspaceId.value;
  await storage.setProject(ProjectID).writeFile(`/${workspaceId}/${WORKSPACE_STRUCT_IDS_FILE}`, text);
  if (selectedWorkspaceId.value !== workspaceId) return;
  structSettings.value = { ids: JSON.parse(text).ids, candidates: {}, warnings: [] };
  toast.success("工作区结构体 ID 已保存，所有模块统一生效");
}
provide("selectedWorkspaceId", selectedWorkspaceId);
const sidebarTarget = ref<HTMLElement>();
provide(studioSidebarKey, sidebarTarget);
const editorTabs = [
  { value: "Dialogue", label: "对话" }, { value: "Quest", label: "任务" },
  { value: "Camera", label: "镜头" },
  { value: "Scene", label: "场景" }, { value: "EntityPresets", label: "预设" },
] as const;
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
  if (addingWorkspace.value) return;
  const inputId = newWorkspaceName.value.trim();
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(inputId) || inputId === "." || inputId === "..") { toast.warning("工作区名称不能包含路径或特殊字符"); return; }
  // const name = `新建工作区${crypto.randomUUID()}`;
  if (workspaceIds.value.some((q) => q == inputId)) {
    toast.warning("已有相同名称的工作区，无法重复添加");
    return;
  }
  if (inputId == "") {
    toast.warning("工作区名称不可为空");
    return;
  }

  const workspacePath = `/${inputId}`;
  addingWorkspace.value = true;
  try {
    if (!await storage.exists(workspacePath)) await storage.mkdir(workspacePath);
    if (!await storage.exists(`${workspacePath}/${SCENE_FILE}`)) await storage.writeFile(`${workspacePath}/${SCENE_FILE}`, encodeSceneProject(createSceneProject()));
    await RefreshWorkspace();
    creatingWorkspace.value = false; newWorkspaceName.value = "";
  } catch (error) { consola.error(error); toast.error("工作区初始化失败，请重试"); }
  finally { addingWorkspace.value = false; }
}
/**
 * 删除工作区
 * @param index 删除的工作区的序号
 */
async function DelectWorkspace(isForce = false) {
  if (switchingEditor.value || sessionHistory.busy.value) return;

  if (selectedWorkspaceId.value == "") {
    toast.warning("未选择任何工作区");
    return;
  }

  if (
    isForce ||
    confirm(`确认要删除 工作区:【${selectedWorkspaceId.value}】 嘛？`)
  ) {
    switchingEditor.value = true;
    try {
      sessionHistory.finishRegistered();
      await activeEditor()?.prepareToLeave();
      const workspaceId = selectedWorkspaceId.value;
      await storage.setProject(ProjectID).trash(`/${workspaceId}`);
      selectedWorkspaceId.value = "";
      rememberWorkspace("");
      sessionHistory.clear(); visitedEditors.value = [selectedFunction.value];
      await RefreshWorkspace();
    } catch (error) { consola.error(error); toast.error("工作区删除失败，当前编辑内容已保留"); }
    finally { switchingEditor.value = false; }
  }
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
    sessionHistory.clear();
    visitedEditors.value = [selectedFunction.value];
    selectedWorkspaceId.value = id;
    rememberWorkspace(id);
    structSettingsOpen.value = false;
    if (structSettingsError.value || validateWorkspaceStructIds(structSettings.value.ids).length) {
      toast.warning("请通过工作区菜单设置结构体 ID；旧配置存在冲突或读取问题。");
    }
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
        <button type="button" class="studio-icon-button" title="新建工作区" aria-label="新建工作区" :disabled="addingWorkspace" @click="creatingWorkspace = !creatingWorkspace"><StudioIcon name="plus" /></button>
        <details ref="workspaceMenu" class="studio-workspace-menu"><summary class="studio-icon-button" aria-label="工作区操作" title="工作区操作"><StudioIcon name="more" /></summary><div><button type="button" :disabled="!selectedWorkspaceId || addingWorkspace" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); openStructSettings()">设置结构体 ID</button><button type="button" :disabled="!selectedWorkspaceId || addingWorkspace" @click="($event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open'); DelectWorkspace()">删除当前工作区</button></div></details>
      </div>
      <nav class="studio-feature-tabs" aria-label="编辑内容">
        <button v-for="tab in editorTabs" :key="tab.value" type="button" :aria-pressed="selectedFunction === tab.value || (tab.value === 'Dialogue' && selectedFunction === 'WalkTalk')" @click="tab.value === 'Dialogue' && selectedFunction === 'WalkTalk' ? undefined : ChangeEditorKind(tab.value)">{{ tab.label }}</button>
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
        <div v-else class="studio-empty"><StudioIcon name="folder" :size="44" /><h2>从一个工作区开始</h2><p>在左侧选择工作区，或创建一个新的工作区。</p><button type="button" @click="creatingWorkspace = true">＋ 新建工作区</button></div>
    </main>
    <StudioCreateDialog v-if="creatingWorkspace" v-model="newWorkspaceName" title="新建工作区" label="工作区名称" placeholder="输入工作区名称" :busy="addingWorkspace" @submit="AddWorkspace()" @close="creatingWorkspace = false" />
    <WorkspaceStructIdSettings v-if="structSettingsOpen" :workspace="selectedWorkspaceId" :state="structSettings" :load-error="structSettingsError" :save-settings="saveStructSettings" @close="structSettingsOpen = false" @retry="retryStructSettings" />
  </div>
</template>

<style scoped>
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
