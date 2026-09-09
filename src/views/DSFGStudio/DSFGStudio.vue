<script setup lang="ts">
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";

import {
  reactive,
  computed,
  ref,
  onMounted,
  provide,
  inject,
  onBeforeMount,
  type Component,
} from "vue";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import { consola } from "consola";
import { toast } from "vue-sonner";
import { StorageClass } from "@/services/storage/storage";
import SelectableList from "@/components/UI/List/SelectableList.vue";
import { ProjectID } from "./constant/constant";
import CameraEditor from "./components/editormap/CameraEditor.vue";
import DialogueEditor from "./components/DialogueEditor/DialogueEditor.vue";
import QuestEditor from "./components/QuestEditor/QuestEditor.vue";

const storage = inject<StorageClass>("storage")!.setProject(ProjectID); //储存区

const workspaceIds = ref<string[]>([]); //工作区的所有id
const selectedWorkspaceId = ref(""); //选择的工作区
const editorRef = ref<{ prepareToLeave: () => Promise<void> }>();
const switchingEditor = ref(false);
provide("selectedWorkspaceId", selectedWorkspaceId);

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
async function AddWorkspace(undoGroupId = "", isForce = false) {
  let inputId = prompt("工作区名称：", "");
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
  await storage.mkdir(workspacePath);

  RefreshWorkspace();
}
/**
 * 删除工作区
 * @param index 删除的工作区的序号
 */
async function DelectWorkspace(undoGroupId = "", isForce = false) {
  if (switchingEditor.value) return;
  undoGroupId = undoGroupId || crypto.randomUUID();

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
      await editorRef.value?.prepareToLeave();
      const workspaceId = selectedWorkspaceId.value;
      await storage.setProject(ProjectID).trash(`/${workspaceId}`);
      selectedWorkspaceId.value = "";
      await RefreshWorkspace();
    } catch (error) { consola.error(error); toast.error("工作区删除失败，当前编辑内容已保留"); }
    finally { switchingEditor.value = false; }
  }
}

/**
 * 切换工作区
 * @param index 点击的工作区
 * @param enableUndoHistory 是否开启记载回撤功能
 * @param isForce 是否强制切换
 */
async function ChangeWorkspace(id: string, undoGroupId = "", isForce = false) {
  if (switchingEditor.value) return;
  undoGroupId = undoGroupId || crypto.randomUUID();
  consola.info(`切换工作区：${id}`);

  const oldValue = selectedWorkspaceId.value;
  const newValue = id;

  if (oldValue == newValue && !isForce) {
    return;
  }

  switchingEditor.value = true;
  try {
    await editorRef.value?.prepareToLeave();
    selectedWorkspaceId.value = id;
  } catch (error) { consola.error(error); toast.error("保存失败，暂未切换工作区"); }
  finally { switchingEditor.value = false; }
}

async function ChangeEditorKind(kind: "Dialogue" | "Quest") {
  if (switchingEditor.value || selectedFunction.value === kind) return;
  switchingEditor.value = true;
  try {
    await editorRef.value?.prepareToLeave();
    selectedFunction.value = kind;
  } catch (error) { consola.error(error); toast.error("保存失败，暂未切换编辑器"); }
  finally { switchingEditor.value = false; }
}

onBeforeMount(async () => {
  //如果工作区的长度为0则执行初始化操作
  if ((await storage.getFolders("/")).length == 0) {
    consola.info("结构体编辑页面无存档，进行初始创建中");
    storage.mkdir("/默认工作区");
  }
  //加载完毕后触发一次刷新工作区
  await ChangeWorkspace((await storage.getFolders("/"))[0], "", true);

  await RefreshWorkspace();
  selectedFunction.value = "Dialogue";
});

const selectedFunction = ref<"Dialogue" | "Quest">("Dialogue");
function onSelectFunction() {}

const functionViewMap: Record<string, Component> = {
  Dialogue: DialogueEditor,
  Quest: QuestEditor,
};
</script>

<template>
  <Splitter style="height: 100%; width: 100%" :class="{ 'editor-switching': switchingEditor }" :inert="switchingEditor">
    <SplitterPanel :size="15">
      <SectionLayout title="工作区选择" class="top">
        <SelectableList
          @select="ChangeWorkspace"
          @add="AddWorkspace"
          @delete="DelectWorkspace"
          :values="workspaceIds"
          :selected-value="selectedWorkspaceId"
        />
      </SectionLayout>
    </SplitterPanel>
    <SplitterPanel :size="85">
      <SectionLayout title="DSFG Studio">
        <component v-if="selectedWorkspaceId" ref="editorRef" :is="functionViewMap[selectedFunction]"
          :key="`${selectedWorkspaceId}:${selectedFunction}`" :editor-kind="selectedFunction"
          @update:editor-kind="ChangeEditorKind" />
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
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
