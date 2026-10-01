<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import StudioFileList from "../StudioFileList.vue";
import StudioCreateDialog from "../StudioCreateDialog.vue";
import type { StudioEditorKind } from "../studioSidebar";
import StudioSidebarContent from "../StudioSidebarContent.vue";
import { StorageClass } from "@/services/storage/storage";
import { downloadJsonFile } from "@/utils/download";
import { consola } from "consola";
import {
  computed,
  inject,
  provide,
  nextTick,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  Ref,
  ref,
  watch,
} from "vue";
import {
  DialogueEditorID,
  DialogueEntry,
  ProjectID,
} from "../../constant/constant";
import { toast } from "vue-sonner";
import { useWorkspaceStructIds } from "../useWorkspaceStructIds";
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@vue-flow/core";
import DropzoneBackground from "./DropzoneBackground.vue";
import Sidebar from "./Sidebar.vue";
import useDragAndDrop, { DIALOGUE_NODE_GRID_SIZE } from "./useDnD";
import GroupNode from "./GroupNode.vue";
import ConditionBranchNode from "./ConditionBranchNode.vue";
import GroupTimeline from "./GroupTimelineV3.vue";
import TimelinePanel from "./components/TimelinePanel.vue";
import DialogueTextPreview from "./DialogueTextPreview.vue";
import { layoutDialogueGraph, type GraphNodeSize } from "./utils/dialogueGraphLayout";
import { applyDialogueTextEdit, applyDialogueOptionIconEdit, type DialogueTextEdit } from "./utils/dialogueTextEditing";
import { useEntityPresets } from "../EntityPresetEditor/useEntityPresets";
import { useStylePresets } from "../EntityPresetEditor/stylePresets";
import { createWorkspaceSaveQueue } from "../QuestEditor/workspaceSaveQueue";
import { bindWorkspaceSaveLifecycle } from "../QuestEditor/workspaceSaveLifecycle";
import { resolveTextPreviewGraphNodeId, type TextPreviewNavigationTarget } from "./utils/dialogueTextNavigation";
import type {
  DialogueProject,
  FlowNodeData,
} from "./types/FileStruct";
import Entry from "./components/Entry.vue";
import {
  createConditionBranchNode,
  createDialogueNode,
  createEmptyDialogueProject,
} from "./utils/dialogueProject";
import {
  decodeDialogueProject,
  encodeDialogueProject,
} from "./utils/dialogueProjectCodec";
import { exportQxqyPerformance } from "./utils/qxqyPerformanceExporter";
import RuntimeImportButton from "../RuntimeImportButton.vue";
import { commitRuntimeImport } from "../runtimeImportStorage";
import { importQxqyPerformance } from "./utils/qxqyPerformanceImporter";
import {
  normalizeSourceHandle,
  resolveGroupOutlets,
} from "./utils/groupOutlets";

withDefaults(defineProps<{ editorKind?: StudioEditorKind }>(), { editorKind: "Dialogue" });
const emit = defineEmits<{ "update:editorKind": [value: StudioEditorKind] }>();
const { availablePresets: entityPresets, error: entityPresetsError, retry: retryEntityPresets } = useEntityPresets();
const dialogueStylePresets = useStylePresets("dialogueStyles");
provide("dialogueStyleOptions", dialogueStylePresets.options);

const {
  onConnect, onNodesChange, getSelectedNodes, getSelectedEdges, nodesSelectionActive,
  findNode, fitView, addSelectedNodes, removeSelectedNodes, removeSelectedEdges,
} = useVueFlow();

const dialogueProject = ref<DialogueProject>(); //读取文件后的对话内容
const selectedGroupNodeId = ref("");
const timelinePanelHeight = ref(368);
const clipInspectorTarget = ref<HTMLElement>();
const clipInspectorOpen = ref(false);
const editorView = ref<"graph" | "text">("text");
const arrangingGraph = ref(false);
const workspaceIds = useWorkspaceStructIds();
const selectedGroupNode = computed(() =>
  selectedGroupNodeId.value && dialogueProject.value
    ? dialogueProject.value.dialogue.nodes[selectedGroupNodeId.value]
    : undefined,
);

function AddDialogueNode(nodeId: string) {
  if (!dialogueProject.value) return;
  dialogueProject.value.dialogue.nodes[nodeId] = createDialogueNode(nodeId);
}

function AddConditionBranchNode(nodeId: string) {
  if (!dialogueProject.value) return;
  dialogueProject.value.dialogue.conditionBranches[nodeId] =
    createConditionBranchNode(nodeId);
}

const { onDragOver, onDrop, onDragLeave, isDragOver } =
  useDragAndDrop(AddDialogueNode, AddConditionBranchNode);

function IsValidConnection(connection: Connection) {
  return connection.source !== connection.target;
}

function AddGraphEdge(connection: Connection) {
  const project = dialogueProject.value;
  if (!project || !IsValidConnection(connection)) return;

  const sourceHandle = normalizeSourceHandle(connection.sourceHandle);
  const isSameOutput = (edge: Edge) => {
    const edgeSourceHandle = normalizeSourceHandle(edge.sourceHandle);
    return (
      edge.source === connection.source &&
      edgeSourceHandle === sourceHandle
    );
  };
  const nextEdge: Edge = {
    id: `edge_${crypto.randomUUID()}`,
    source: connection.source,
    target: connection.target,
    sourceHandle,
    targetHandle: connection.targetHandle,
  };

  // 删除旧线和添加新线必须在同一次响应式更新中完成，否则 v-model
  // 会先渲染“已断开”的中间状态，导致第一次重连丢失。
  project.graph.edges = [
    ...project.graph.edges.filter((edge) => !isSameOutput(edge)),
    nextEdge,
  ];
}

onConnect(AddGraphEdge);
onNodesChange((changes: NodeChange[]) => {
  if (!dialogueProject.value) return;

  for (const change of changes) {
    if (change.type === "remove") {
      delete dialogueProject.value.dialogue.nodes[change.id];
      delete dialogueProject.value.dialogue.conditionBranches[change.id];
      if (selectedGroupNodeId.value === change.id) {
        selectedGroupNodeId.value = "";
      }
    }
  }
});

function SelectGraphNode(event: { node: Node<FlowNodeData> }) {
  selectedGroupNodeId.value = event.node.data?.dialogueNodeId ?? "";
}

function ChangeEditorView(view: "graph" | "text", arrange = true) {
  const enteringGraph = view === "graph" && editorView.value !== "graph";
  editorView.value = view;
  selectedGroupNodeId.value = "";
  if (enteringGraph && arrange) void ArrangeGraph();
}

function ApplyGraphLayout(project: DialogueProject) {
  const sizes = new Map<string, GraphNodeSize>();
  for (const node of project.graph.nodes) {
    const dimensions = findNode(node.id)?.dimensions;
    if (dimensions) sizes.set(node.id, dimensions);
  }
  project.graph.nodes = layoutDialogueGraph(project.graph, sizes);
}

async function ArrangeGraph() {
  const project = dialogueProject.value;
  if (!project || arrangingGraph.value) return;
  arrangingGraph.value = true;
  try {
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (dialogueProject.value !== project || editorView.value !== "graph") return;
    ApplyGraphLayout(project);
    await nextTick();
    if (dialogueProject.value !== project || editorView.value !== "graph") return;
    nodesSelectionActive.value = false;
    await fitView({ padding: 0.2, minZoom: 0.05, maxZoom: 1, duration: 250 });
  } catch (error) {
    consola.error(error);
    toast.error("节点排列失败，请重试");
  } finally {
    arrangingGraph.value = false;
  }
}

function EditDialogueText(edit: DialogueTextEdit) {
  if (dialogueProject.value) applyDialogueTextEdit(dialogueProject.value, edit);
}
function EditDialogueOption(nodeId: string, optionId: string, value: string) {
  const option = dialogueProject.value?.dialogue.nodes[nodeId]?.select?.options.find((item) => item.id === optionId);
  if (option) option.content = value;
}
function EditDialogueOptionIcon(nodeId: string, optionId: string, icon: number) {
  if (dialogueProject.value) applyDialogueOptionIconEdit(dialogueProject.value, nodeId, optionId, icon);
}

async function NavigateToPreviewNode(target: TextPreviewNavigationTarget) {
  const project = dialogueProject.value;
  if (!project) return;
  const graphNodeId = resolveTextPreviewGraphNodeId(project, target);
  if (!graphNodeId) {
    toast.warning("该内容没有对应的可见画布节点，无法定位");
    return;
  }

  ChangeEditorView("graph", false);
  nodesSelectionActive.value = false;
  // 先展开目标 Timeline，再测量画布，避免定位后被下方 Timeline 挤出可视区域。
  selectedGroupNodeId.value = target.kind === "dialogue" || target.kind === "select" || target.kind === "action"
    ? target.nodeId : "";
  await nextTick();
  // v-show 恢复后，需要让 ResizeObserver 更新 Vue Flow 的视口/节点尺寸。
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (dialogueProject.value !== project || editorView.value !== "graph") return;
  const node = findNode(graphNodeId);
  if (!node || node.hidden) return;
  ApplyGraphLayout(project);
  await nextTick();
  if (dialogueProject.value !== project || editorView.value !== "graph") return;
  removeSelectedNodes(getSelectedNodes.value);
  removeSelectedEdges(getSelectedEdges.value);
  addSelectedNodes([node]);
  await fitView({ nodes: [graphNodeId], padding: 0.35, maxZoom: 1, duration: 250 });
}

async function FinishGraphSelection() {
  // 等待框选产生的 selected 状态同步后，再决定是否打开 Timeline。
  await nextTick();
  const selectedNodes = getSelectedNodes.value;
  if (selectedNodes.length === 1) {
    // 单选不保留群组选框遮罩，避免挡住节点的引脚和参数输入框。
    nodesSelectionActive.value = false;
    SelectGraphNode({ node: selectedNodes[0] });
  } else {
    selectedGroupNodeId.value = "";
  }
}

const storage = inject<StorageClass>("storage")!.setProject(ProjectID); //储存区
const workspaceId = inject<Ref<string>>("selectedWorkspaceId")!;
// 此组件按工作区重建；保存路径固定在创建时，不能跟随之后的工作区选择变化。
const documentWorkspaceId = workspaceId.value;
let disposed = false;
let loadingFile = false;
let fileRequest = 0;
let listRequest = 0;
const fileBusy = ref(false);

function AssemblyPath(path: string) {
  return `/${documentWorkspaceId}/${DialogueEditorID}${path}`;
}

const dialogueFiles = ref<string[]>([]);
const selectedDialogueFile = ref<string>("");
const newDialogueFileOpen = ref(false);
const newDialogueFileName = ref("");

watch(
  dialogueProject,
  () => {
    SynchronizeGraphEdges();
    scheduleSave();
  },
  { deep: true, flush: "sync" },
);

/** Timeline 改变出口数量时，清理已经不存在的 Handle 对应连线。 */
function SynchronizeGraphEdges() {
  const project = dialogueProject.value;
  if (!project) return;

  const nextEdges = project.graph.edges.filter((edge) => {
    const sourceNode = project.dialogue.nodes[edge.source];
    if (!sourceNode) {
      const conditionBranch =
        project.dialogue.conditionBranches[edge.source];
      if (!conditionBranch) return true;
      return conditionBranch.outputs.some(
        (output) => output.id === edge.sourceHandle,
      );
    }

    const validHandles = new Set(
      resolveGroupOutlets(sourceNode).outlets.map((outlet) => outlet.id),
    );
    return validHandles.has(normalizeSourceHandle(edge.sourceHandle));
  });

  if (nextEdges.length !== project.graph.edges.length) {
    project.graph.edges = nextEdges;
  }
}

const saveQueue = createWorkspaceSaveQueue(
  (path, data) => storage.setProject(ProjectID).writeFile(path, data),
  (error) => { consola.error(error); toast.error("对话保存失败，请勿关闭页面并重试"); },
);
defineExpose({ prepareToLeave: async () => {
  if (fileBusy.value) throw new Error("对话文件正在读写，请稍后切换");

  selectedGroupNodeId.value = "";
  await nextTick();
  await saveQueue.flush();
} });

function scheduleSave() {
  if (loadingFile || disposed || !selectedDialogueFile.value || !dialogueProject.value) return;
  saveQueue.schedule(AssemblyPath(`/${selectedDialogueFile.value}`), encodeDialogueProject(dialogueProject.value));
}

async function RefreshDialogueFile() {
  const request = ++listRequest;
  consola.debug("刷新对话文件");
  const files = await storage.setProject(ProjectID).getFiles(
    `/${documentWorkspaceId}/${DialogueEditorID}`,
  );
  if (!disposed && request === listRequest) dialogueFiles.value = files;
  consola.trace(dialogueFiles.value);
}

async function SelectDialogueFile(id: string) {
  if (fileBusy.value) return;
  fileBusy.value = true;

  selectedGroupNodeId.value = "";
  const request = ++fileRequest;
  try {
    await saveQueue.flush();
    const loaded = decodeDialogueProject(await storage.setProject(ProjectID).readFile(AssemblyPath(`/${id}`)));
    if (disposed || request !== fileRequest) return;
    loadingFile = true;
    selectedGroupNodeId.value = "";

    selectedDialogueFile.value = id;
    dialogueProject.value = loaded;
    loadingFile = false;
  } catch (error) { consola.error(error); toast.error("读取对话失败，原有内容已保留"); }
  finally { fileBusy.value = false; loadingFile = false; }
}
async function AddDialogueFile() {
  if (fileBusy.value) return;
  const input = newDialogueFileName.value;
  const base = input.trim().replace(/\.json$/i, "");
  if (!base || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || base === "." || base === "..") {
    toast.warning("请输入有效的对话文件名"); return;
  }
  const fileName = `${base}.json`;
  fileBusy.value = true;

  selectedGroupNodeId.value = "";
  try {
    const filePath = AssemblyPath(`/${fileName}`);
    if (await storage.setProject(ProjectID).exists(filePath)) { toast.warning("已有同名对话文件"); return; }
    await saveQueue.flush();
    await storage.setProject(ProjectID).writeFile(filePath, encodeDialogueProject(createEmptyDialogueProject()));
    await RefreshDialogueFile();
    newDialogueFileOpen.value = false;
    newDialogueFileName.value = "";
  } catch (error) { consola.error(error); toast.error("创建对话文件失败"); }
  finally { fileBusy.value = false; }
  if (!newDialogueFileOpen.value) await SelectDialogueFile(fileName);
}
async function importConfiguration(file: File) {
  if (fileBusy.value || disposed) return;
  fileBusy.value = true;
  try {
    const result = await commitRuntimeImport({ file, decode: importQxqyPerformance, encode: result => encodeDialogueProject(result.project),
      storage: storage.setProject(ProjectID), active: () => !disposed, flush: () => saveQueue.flush(),
      directory: `/${documentWorkspaceId}/${DialogueEditorID}` });
    if (!result) return;
    loadingFile = true; selectedGroupNodeId.value = "";
    selectedDialogueFile.value = result.name; dialogueProject.value = result.project.project; loadingFile = false;
    newDialogueFileOpen.value = false;
    await RefreshDialogueFile();
    if (!disposed) { toast.success(`已新增「${result.name}」`); toast.warning(result.project.warnings.join("；")); }
  } finally { loadingFile = false; if (!disposed) fileBusy.value = false; }
}
async function DeleteDialogueFile(undoGroupId = "", isForce = false) {
  if (fileBusy.value) return;
  undoGroupId = undoGroupId || crypto.randomUUID();

  if (selectedDialogueFile.value == "") {
    toast.warning("未选择任何对话文件");
    return;
  }

  if (
    isForce ||
    confirm(`确认要删除对话文件【${selectedDialogueFile.value}】吗？`)
  ) {
    const fileName = selectedDialogueFile.value;
    fileBusy.value = true;

    selectedGroupNodeId.value = "";
    fileRequest++;
    try {
      await saveQueue.flush();
      await storage.setProject(ProjectID).trash(AssemblyPath(`/${fileName}`));
      saveQueue.discard(AssemblyPath(`/${fileName}`));
      selectedDialogueFile.value = "";
      selectedGroupNodeId.value = "";

      dialogueProject.value = undefined;
      await RefreshDialogueFile();
      toast.success(`已删除 ${fileName}`);
    } catch (error) { consola.error(error); toast.error("对话删除失败，文件已保留"); }
    finally { fileBusy.value = false; }
  }
}

function DownloadQxqyPerformanceFile() {
  if (!selectedDialogueFile.value || !dialogueProject.value) {
    toast.warning("请先选择要导出的对话文件");
    return;
  }

  let result;
  try {
    result = exportQxqyPerformance(workspaceIds.dialogue(dialogueProject.value));
  } catch (error) {
    const message = error instanceof Error ? error.message : "结构体 ID 配置无效";
    toast.error(message);
    return;
  }
  if (!result.groupOrder.length) {
    toast.warning("当前对话没有可导出的 Group");
    return;
  }

  const baseName = selectedDialogueFile.value.replace(/\.json$/i, "");
  downloadJsonFile(result.value, `${baseName}-千星演出.json`);
  if (result.warnings.length) {
    consola.warn("千星演出导出提示", result.warnings);
    toast.warning(
      `已导出 ${result.groupOrder.length} 个 Group，另有 ${result.warnings.length} 条提示，请查看控制台`,
    );
  } else {
    toast.success(`已导出 ${result.groupOrder.length} 个 Group`);
  }
}


onBeforeMount(async () => {
  await RefreshDialogueFile();
});

let removeSaveLifecycle: (() => void) | undefined;
onMounted(() => {
  removeSaveLifecycle = bindWorkspaceSaveLifecycle(saveQueue);
});
onBeforeUnmount(() => {
  disposed = true;
  fileRequest++;
  removeSaveLifecycle?.();
  void saveQueue.flush().catch(() => undefined);
});
</script>
<template>
  <div class="dialogue-editor" :inert="fileBusy">
    <StudioSidebarContent><div class="editor-file-panel" :inert="fileBusy">
        <StudioFileList :disabled="fileBusy"
          @select="SelectDialogueFile"
          @add="newDialogueFileOpen = true"
          @delete="DeleteDialogueFile"
          :values="dialogueFiles"
          :selected-value="selectedDialogueFile"
        ><template #actions><RuntimeImportButton :disabled="fileBusy" :import-file="importConfiguration" /></template></StudioFileList>
    </div></StudioSidebarContent>
      <SectionLayout :title="selectedDialogueFile || '对话编辑'" class="dialogue-edit-section">
        <div
          v-if="selectedDialogueFile && dialogueProject"
          style="width: 100%; height: 100%"
        >
          <div class="dialogue-workspace">
            <div class="dialogue-export-toolbar">
              <div class="dialogue-view-switch" role="group" aria-label="预览风格">
                <button type="button" :aria-pressed="editorView === 'text'" @click="ChangeEditorView('text')">文本编辑</button>
                <button type="button" :aria-pressed="editorView === 'graph'" @click="ChangeEditorView('graph')">节点编辑</button>
              </div>
              <span class="studio-save-note" title="修改自动保存到当前工作区">自动保存</span>
              <span v-if="editorView === 'graph'">右键平移 · 左键框选</span>
              <button v-if="editorView === 'graph'" type="button" :disabled="arrangingGraph" title="按连线从左到右排列全部节点，并适应画布" @click="ArrangeGraph">{{ arrangingGraph ? '排列中…' : '一键排列' }}</button>
              <button type="button" @click="DownloadQxqyPerformanceFile">
                导出千星演出
              </button>
            </div>
            <div class="dialogue-editing-body">
            <div class="dialogue-editing-stage">
            <div v-show="editorView === 'graph'" class="dnd-flow" @drop="onDrop">
              <Sidebar />
               <VueFlow
                 v-model:nodes="dialogueProject.graph.nodes"
                 v-model:edges="dialogueProject.graph.edges"
                 :pan-on-drag="[2]"
                 :selection-key-code="true"
                 :select-nodes-on-drag="true"
                 :pan-activation-key-code="null"
                 :snap-to-grid="true"
                 :snap-grid="[
                   DIALOGUE_NODE_GRID_SIZE,
                   DIALOGUE_NODE_GRID_SIZE,
                 ]"
                 :delete-key-code="editorView === 'graph' ? ['Backspace', 'Delete'] : null"
                 :disable-keyboard-a11y="editorView !== 'graph'"
                :is-valid-connection="IsValidConnection"
                @node-click="SelectGraphNode"
                @selection-end="FinishGraphSelection"
                @pane-click="() => { if (!clipInspectorOpen) selectedGroupNodeId = ''; }"
                @contextmenu.prevent
                @dragover="onDragOver"
                @dragleave="onDragLeave"
              >
              <template #node-group="props">
                <GroupNode
                  v-if="
                    props.data.dialogueNodeId &&
                    dialogueProject.dialogue.nodes[props.data.dialogueNodeId]
                  "
                  :id="props.id"
                  :node="
                    dialogueProject.dialogue.nodes[props.data.dialogueNodeId]
                  "
                  :edges="dialogueProject.graph.edges"
                  :selected="props.selected"
                />
              </template>

              <template #node-condition="props">
                <ConditionBranchNode
                  v-if="
                    props.data.conditionBranchNodeId &&
                    dialogueProject.dialogue.conditionBranches[
                      props.data.conditionBranchNodeId
                    ]
                  "
                  :id="props.id"
                  :node="
                    dialogueProject.dialogue.conditionBranches[
                      props.data.conditionBranchNodeId
                    ]
                  "
                  :edges="dialogueProject.graph.edges"
                  :selected="props.selected"
                />
              </template>

              <template #node-entry="props">
                <Entry :id="props.id" />
              </template>
              <DropzoneBackground
                :style="{
                  backgroundColor: isDragOver ? '#e7f3ff' : 'transparent',
                  transition: 'background-color 0.2s ease',
                }"
              >
                <p v-if="isDragOver">Drop here</p>
              </DropzoneBackground>
              </VueFlow>

            </div>

            <p v-if="dialogueStylePresets.error.value" role="alert">{{ dialogueStylePresets.error.value }} <button type="button" @click="dialogueStylePresets.retry().catch(() => undefined)">重试对话类型预设</button></p>
            <DialogueTextPreview v-if="editorView === 'text'" :key="selectedDialogueFile" :project="dialogueProject" :entity-presets="entityPresets" :presets-error="entityPresetsError" @retry-presets="retryEntityPresets().catch(() => undefined)" @navigate="NavigateToPreviewNode"
              @edit="EditDialogueText" @option="EditDialogueOption" @option-icon="EditDialogueOptionIcon" @replace="dialogueProject = $event" />

            <TimelinePanel v-if="editorView === 'graph' && selectedGroupNode" v-model="timelinePanelHeight">
              <GroupTimeline :key="selectedDialogueFile + ':' + selectedGroupNode.id" :node="selectedGroupNode" :inspector-target="clipInspectorTarget"
                @inspector-open="clipInspectorOpen = $event" @close="selectedGroupNodeId = ''" />
            </TimelinePanel>
            </div>
            <div v-show="clipInspectorOpen && editorView === 'graph'" ref="clipInspectorTarget" class="dialogue-clip-inspector" aria-label="Clip 属性栏" :inert="fileBusy" />
            </div>
          </div></div>
          <div v-else class="studio-empty"><h2>开始编写一段对话</h2><p>从左侧选择文件，或新建一段对话。</p><button type="button" @click="newDialogueFileOpen = true">＋ 新建对话文件</button></div>
      </SectionLayout>
    <StudioCreateDialog v-if="newDialogueFileOpen" v-model="newDialogueFileName" title="新建对话文件" label="新对话文件名" placeholder="输入对话文件名" submit-label="创建并打开" :busy="fileBusy" @submit="AddDialogueFile" @close="newDialogueFileOpen = false" />
  </div>
</template>

<style scoped>
@import "./main.css";

.editor-file-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.editor-file-panel > .Section { flex: 1; min-height: 0; }
.dialogue-editing-body { position: relative; display: flex; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
.dialogue-editing-stage { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.dialogue-clip-inspector { position: absolute; z-index: 30; inset: 0 0 0 auto; width: clamp(340px, 32vw, 460px); max-width: 100%; min-height: 0; overflow: hidden; box-sizing: border-box; border: 1px solid #cdd8ed; border-top: 3px solid #22a4e8; border-radius: 10px; background: #fff; box-shadow: -8px 0 24px #3b548321; }

/* 22px 负责命中，中央约 10px 的圆点保持原来的视觉尺寸。 */
:deep(.dnd-flow .vue-flow__handle) {
  width: 22px;
  height: 22px;
  background: radial-gradient(
    circle,
    var(--dsfg-handle-fill, #88b5ff) 0 4px,
    var(--dsfg-handle-ring, #202630) 4.5px 6px,
    transparent 6.5px
  );
  border: 0;
  cursor: crosshair;
}

:deep(.dnd-flow .vue-flow__handle:hover) {
  filter: brightness(1.2) drop-shadow(0 0 3px rgba(72, 138, 235, 0.6));
}

:deep(.dnd-flow .vue-flow) { background: #f7f9fd; }
:deep(.dnd-flow .vue-flow__edge-path) { stroke: #94a7bf; stroke-width: 1.5; }
:deep(.dnd-flow .vue-flow__edge.selected .vue-flow__edge-path),
:deep(.dnd-flow .vue-flow__edge:hover .vue-flow__edge-path) { stroke: #488aeb; stroke-width: 2; }
:deep(.dnd-flow .vue-flow__connection-path) { stroke: #488aeb; stroke-width: 2; }
:deep(.dnd-flow .vue-flow__node:focus-visible) { outline: 2px solid #488aeb; outline-offset: 4px; border-radius: 10px; }
</style>
