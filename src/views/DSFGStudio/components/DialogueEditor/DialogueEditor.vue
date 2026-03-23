<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import SelectableList from "@/components/UI/List/SelectableList.vue";
import { StorageClass } from "@/services/storage/storage";
import { consola } from "consola";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import { computed, inject, onBeforeMount, provide, Ref, ref, watch } from "vue";
import {
  DialogueEditorID,
  DialogueEntry,
  ProjectID,
} from "../../constant/constant";
import { toast } from "vue-sonner";
import { DialogueBlock, DialogueNode } from "./types/DialogueNode";

import { VueFlow, useVueFlow } from "@vue-flow/core";
import DropzoneBackground from "./DropzoneBackground.vue";
import Sidebar from "./Sidebar.vue";
import useDragAndDrop from "./useDnD";
import CustomNode from "./CustomNode.vue";
import { DialogueProject } from "./types/FileStruct";
import Entry from "./components/Entry.vue";

const { onConnect, addEdges } = useVueFlow();

const { onDragOver, onDrop, onDragLeave, isDragOver } = useDragAndDrop();

onConnect(addEdges);

const storage = inject<StorageClass>("storage")!.setProject(ProjectID); //储存区
const workspaceId = inject<Ref<string>>("selectedWorkspaceId")!;

function AssemblyPath(path: string) {
  return `/${workspaceId.value}/${DialogueEditorID}${path}`;
}

const dialogueFiles = ref<string[]>([]);
const selectedDialogueFile = ref<string>("");
const dialogueProject = ref<DialogueProject>(); //读取文件后的对话内容

watch(
  dialogueProject,
  () => {
    scheduleSave();
  },
  { deep: true },
);

let timer: any = null;

function scheduleSave() {
  clearTimeout(timer);

  timer = setTimeout(async () => {
    await SaveDialogueFile();
  }, 500); // 👈 0.5秒无操作才保存
}

async function RefreshDialogueFile() {
  consola.debug("刷新对话文件");
  dialogueFiles.value = await storage.getFiles(
    `/${workspaceId.value}/${DialogueEditorID}`,
  );
  consola.trace(dialogueFiles.value);
}

async function SelectDialogueFile(id: string) {
  selectedDialogueFile.value = id;
  dialogueProject.value = JSON.parse(
    await storage.readFile(AssemblyPath(`/${id}`)),
  ) as DialogueProject;
  consola.trace(dialogueProject.value);
}
async function AddDialogueFile() {
  const fileName = prompt("输入变量名");
  if (dialogueFiles.value.some((q) => q == fileName)) {
    toast.warning("已有相同名称的工作区，无法重复添加");
    return;
  }
  if (fileName == "") {
    toast.warning("工作区名称不可为空");
    return;
  }

  const filePath = `${AssemblyPath(`/${fileName}.json`)}`;
  const defaultValue = {
    tree: {},
    flow: { nodes: [], edges: [] },
  } as DialogueProject;
  await storage.writeFile(filePath, JSON.stringify(defaultValue));

  await RefreshDialogueFile();
}
async function DeleteDialogueFile(undoGroupId = "", isForce = false) {
  undoGroupId = undoGroupId || crypto.randomUUID();

  if (selectedDialogueFile.value == "") {
    toast.warning("未选择任何工作区");
  }

  if (
    isForce ||
    confirm(`确认要删除 工作区:【${selectedDialogueFile.value}】 嘛？`)
  ) {
    const trashPath = await storage.trash(
      `/${workspaceId.value}/${selectedDialogueFile.value}`,
    );

    SelectDialogueFile("");

    await RefreshDialogueFile();
  }
}

async function SaveDialogueFile() {
  await storage.writeFile(
    AssemblyPath(`/${selectedDialogueFile.value}`),
    JSON.stringify(dialogueProject.value),
  );
}

onBeforeMount(async () => {
  await RefreshDialogueFile();
});
</script>
<template>
  <Splitter>
    <SplitterPanel :size="15"
      ><SectionLayout title="对话文件">
        <SelectableList
          @select="SelectDialogueFile"
          @add="AddDialogueFile"
          @delete="DeleteDialogueFile"
          :values="dialogueFiles"
          :selected-value="selectedDialogueFile"
        ></SelectableList></SectionLayout
    ></SplitterPanel>
    <SplitterPanel :size="85"
      ><SectionLayout title="编辑区">
        <div
          v-if="selectedDialogueFile && dialogueProject"
          style="width: 100%; height: 100%"
        >
          <div class="dnd-flow" @drop="onDrop">
            <VueFlow
              v-model:nodes="dialogueProject.flow.nodes"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              v-model:edges="dialogueProject.flow.edges"
            >
              <template #node-custom="props">
                <CustomNode :id="props.id" :data="props.data" />
              </template>

              <template #node-entry="props">
                <Entry :id="props.id" :data="props.data" />
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

            <Sidebar />
          </div></div></SectionLayout
    ></SplitterPanel>
  </Splitter>
</template>

<style scoped>
@import "./main.css";
</style>
