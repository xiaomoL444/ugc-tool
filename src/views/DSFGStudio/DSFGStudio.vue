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

const storage = inject<StorageClass>("storage")!.setProject(ProjectID); //储存区

const workspaceIds = ref<string[]>([]); //工作区的所有id
const selectedWorkspaceId = ref(""); //选择的工作区
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
  undoGroupId = undoGroupId || crypto.randomUUID();

  if (selectedWorkspaceId.value == "") {
    toast.warning("未选择任何工作区");
  }

  if (
    isForce ||
    confirm(`确认要删除 工作区:【${selectedWorkspaceId.value}】 嘛？`)
  ) {
    const workspaceId = selectedWorkspaceId.value;
    const trashPath = await storage.trash(`/${workspaceId}`);

    ChangeWorkspace("", undoGroupId, isForce);

    await RefreshWorkspace();
  }
}

/**
 * 切换工作区
 * @param index 点击的工作区
 * @param enableUndoHistory 是否开启记载回撤功能
 * @param isForce 是否强制切换
 */
async function ChangeWorkspace(id: string, undoGroupId = "", isForce = false) {
  undoGroupId = undoGroupId || crypto.randomUUID();
  consola.info(`切换工作区：${id}`);

  const oldValue = selectedWorkspaceId.value;
  const newValue = id;

  if (oldValue == newValue && !isForce) {
    return;
  }

  selectedWorkspaceId.value = id;
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

const selectedFunction = ref("");
function onSelectFunction() {}

const functionViewMap: Record<string, Component> = {
  Dialogue: DialogueEditor,
  Camera: CameraEditor,
};
</script>

<template>
  <Splitter style="height: 100%; width: 100%">
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
    <SplitterPanel :size="15"
      ><SectionLayout title="功能选择">
        <select
          v-model="selectedFunction"
          @change="onSelectFunction"
          placeholder="选择功能"
        >
          <option value="Dialogue">对话</option>
          <option value="Animation">动画</option>
          <option value="Camera">运镜</option>
        </select></SectionLayout
      ></SplitterPanel
    >

    <SplitterPanel :size="85">
      <SectionLayout>
        <component :is="functionViewMap[selectedFunction]"></component>
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
</template>

<style scoped>
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
