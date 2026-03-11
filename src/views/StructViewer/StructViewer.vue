<template>
  <div class="container">
    <div class="switchPanel">
      <SectionLayout title="工作区选择" class="top">
        <div class="actionButtonComponent">
          <ActionButton v-on:update:selected="DelectWorkspace" class="delete"
            >删除</ActionButton
          >
          <ActionButton v-on:update:selected="AddWorkspace" class="add">
            <img
              width="20"
              height="20"
              src="https://img.icons8.com/parakeet-filled/100/plus-math.png"
              alt="plus-math"
            />
          </ActionButton>
        </div>

        <div class="selectableListPlane">
          <ListButton
            v-for="(id, index) in workspaceIds"
            :key="index"
            :is-selected="id == selectedWorkspaceId"
            v-on:update:selected="ChangeWorkspace(id)"
          >
            <StructItem :name="id" v-on:update:input="ChangeWorkspaceName" />
          </ListButton>
        </div>
      </SectionLayout>

      <SectionLayout title="高级数据管理" class="bottom">
        <div class="actionButtonComponent">
          <ActionButton v-on:update:selected="DeleteBaseStruct" class="delete"
            >删除</ActionButton
          >
          <ActionButton v-on:update:selected="selectFile(0)">
            <img
              width="20"
              height="20"
              src="https://img.icons8.com/parakeet-filled/100/plus-math.png"
              alt="plus-math"
            />
          </ActionButton>
        </div>

        <div class="selectableListPlane">
          <ListButton
            v-for="(item, index) in baseStructList"
            :key="index"
            :is-selected="item.structId == selectedStructId"
            v-on:update:selected="ChangeBaseStruct(item.structId)"
          >
            <StructItem
              :name="item.structDefinition?.name"
              :id="item.structId"
              :enable-double-click="false"
            />
          </ListButton>
        </div>
      </SectionLayout>
    </div>
    <div class="variablePanel">
      <SectionLayout title="自定义变量">
        <div class="actionButtonComponent">
          <ActionButton v-on:update:selected="DeleteVariableData" class="delete"
            >删除</ActionButton
          >
          <ActionButton v-on:update:selected="selectFile(1)">
            <img
              width="20"
              height="20"
              src="https://img.icons8.com/parakeet-filled/100/plus-math.png"
              alt="plus-math"
            />
          </ActionButton>
        </div>

        <div class="selectableListPlane">
          <ListButton
            v-for="(item, index) in variableDataList"
            :key="index"
            :is-selected="item.variableName == selectedVarialbeName"
            v-on:update:selected="ChangeVariableData(item.variableName)"
          >
            <StructItem
              :name="item.variableName"
              v-on:update:input="ChangeVariableDataName"
            />
          </ListButton>
        </div>
      </SectionLayout>
    </div>
    <div class="editorPanel">
      <SectionLayout title="编辑区">
        <div style="display: flex;flex-direction: row;gap: 10px;">
          <ActionButton
            v-on:update:selected="downloadJson"
            style="width: 200px; margin-bottom: 10px"
            >下载JSON</ActionButton
          >
          <ActionButton
            v-on:update:selected="bus.emit('openCollapse')"
            style="width: 200px; margin-bottom: 10px"
            >展开所有列表</ActionButton
          >
          <ActionButton
            v-on:update:selected="bus.emit('closeCollapse')"
            style="width: 200px; margin-bottom: 10px"
            >关闭所有列表</ActionButton
          >
        </div>
        <div class="editorArea">
          <ParamNodeRender
            v-if="paramNode"
            :param="paramNode"
            :json-path="'$'"
            :struct-list-count="0"
            style="overflow-y: auto"
          ></ParamNodeRender>
        </div>
      </SectionLayout>
    </div>
    <input
      ref="fileInput"
      type="file"
      @change="handleFileChange"
      style="opacity: 0; position: absolute; width: 0; height: 0"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  inject,
  onBeforeMount,
  provide,
  onBeforeUnmount,
  onMounted,
} from "vue";
import { toast } from "vue-sonner";
import { JSONPath } from "jsonpath-plus";

import SectionLayout from "@/components/Layout/SectionLayout.vue";
import ListButton from "@/components/button/ListButton.vue";
import StructItem from "./components/StructItem.vue";
import {
  VariableData,
  type BaseStruct,
  type WorkspaceConfig,
  type WorkspaceManifest,
} from "./types/WorkspaceManifest";
import ActionButton from "@/components/button/ActionButton.vue";
import { StorageClass } from "@/services/storage/storage";
import { ParamNode } from "./types/ParamsType";
import ParamNodeRender from "./components/ParamNodeRender.vue";

import UndoManager, { UndoCommand } from "@/lib/undo-manager/undo-manager";

const udnoManager = new UndoManager();

const baseStorageKey = "结构体编辑器"; //储存库的根名
const baseStructKey = "高级数据管理"; //高级数据管理的名字
const variableDataGroupKey = "自定义变量"; //高级数据管理的名字

const storage = inject<StorageClass>("storage")!.setProject(baseStorageKey); //储存区

const workspaceIds = ref<string[]>([]); //工作区的所有id
const selectedWorkspaceId = ref("");

const selectedStructId = ref("");

const selectedVarialbeName = ref("");

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

  const oldVariableName = selectedVarialbeName.value;

  if (oldValue == newValue && !isForce) {
    return;
  }

  ChangeVariableData("", undoGroupId, false);

  if (!isForce)
    udnoManager.add({
      label: "切换选择工作区",
      groupId: undoGroupId,
      undo: async () => {
        selectedWorkspaceId.value = oldValue;
        RefreshBaseStruct();
        ChangeVariableData("", undoGroupId, true);
        await RefreshVariableData();
      },
      redo: async () => {
        selectedWorkspaceId.value = newValue;
        RefreshBaseStruct();
        await RefreshVariableData();
        ChangeVariableData(oldVariableName, undoGroupId, true);
      },
    });
  selectedWorkspaceId.value = id;
  RefreshBaseStruct();
  RefreshVariableData();
  // ChangeVariableData();
}

async function ChangeWorkspaceName(
  name: string,
  undoGroupId = "",
  isForce = false,
) {
  undoGroupId = undoGroupId || crypto.randomUUID();

  const oldName = selectedWorkspaceId.value;
  const newName = name;
  if (!isForce) {
    udnoManager.add({
      label: "修改自定义变量名",
      groupId: undoGroupId,
      undo: async () => {
        const path = `/${newName}`;
        await storage.rename(path, oldName);
        ChangeWorkspace(oldName);
        await RefreshWorkspace();
      },
      redo: async () => {
        const path = `/${oldName}`;
        await storage.rename(path, newName);
        ChangeWorkspace(newName);
        await RefreshWorkspace();
      },
    });
  }
  const path = `/${oldName}`;
  await storage.rename(path, newName);
  ChangeWorkspace(newName);
  await RefreshWorkspace();
}

function ChangeBaseStruct(
  id: string,
  undoGroupId: string = "",
  isForce = false,
) {
  if (selectedStructId.value == id) {
    return;
  }
  const oldValue = selectedStructId.value;
  const newValue = id;

  selectedStructId.value = id;

  undoGroupId = undoGroupId || crypto.randomUUID();
  if (!isForce) {
    udnoManager.add({
      label: "切换选择高级数据管理",
      groupId: undoGroupId,
      undo: () => ChangeBaseStruct(oldValue, undoGroupId, true),
      redo: () => ChangeBaseStruct(newValue, undoGroupId, true),
    });
  }
}
function ChangeVariableData(
  id: string,
  undoGroupId: string = "",
  isForce = false,
) {
  if (selectedVarialbeName.value == id) {
    return;
  }
  const oldValue = selectedVarialbeName.value;
  const newValue = id;

  undoGroupId = undoGroupId || crypto.randomUUID();
  if (!isForce) {
    udnoManager.add({
      label: "切换选择自定义变量",
      groupId: undoGroupId,
      undo: () => ChangeVariableData(oldValue, undoGroupId, true),
      redo: () => ChangeVariableData(newValue, undoGroupId, true),
    });
  }
  selectedVarialbeName.value = id;

  const variableData = variableDataList.value.find(
    (q) => q.variableName == id,
  )?.value;
  if (variableData) {
    paramNode.value = {
      param_type: variableData.type,
      value: variableData,
    } as ParamNode;
  } else {
    paramNode.value = {} as ParamNode;
  }
}

import { BindNodeId, ResolveNodeId } from "./utils/nodeIdResolveMap";
import { ParamChange } from "./types/ParamChange";
import _, { cloneDeep } from "lodash";
import { consola } from "consola";
import { bus } from "@/services/bus/bus";
async function ApplyParamNodeChange(
  paramChange: ParamChange,
  enableUndoHistory = true,
) {
  if (paramNode?.value == undefined) {
    console.warn(`无法应用,因为根字段不存在值`);
    return;
  }
  switch (paramChange.type) {
    case "set":
      const path = paramChange.path;
      const oldValue = JSONPath({ path, json: paramNode.value })[0];
      const newValue = paramChange.value;

      _.set(paramNode.value, path.replace("$.", ""), newValue);

      //添加回撤部分
      if (enableUndoHistory) {
        udnoManager.add({
          label: "设置变量",
          undo: () =>
            ApplyParamNodeChange(
              { type: "set", path: path, value: oldValue } as ParamChange,
              false,
            ),
          redo: () => ApplyParamNodeChange(paramChange, false),
        } as UndoCommand);
      }
      break;
    case "add":
      const add_path = paramChange.path.replace("$.", "");
      const add_oldValue = JSONPath({
        path: add_path,
        json: paramNode.value,
      })[0] as any[];
      const add_newValue = cloneDeep(add_oldValue);
      add_newValue.splice(paramChange.index, 0, paramChange.value);
      _.set(paramNode.value, add_path, add_newValue);

      //添加回撤部分
      if (enableUndoHistory) {
        udnoManager.add({
          label: "设置变量",
          undo: () =>
            ApplyParamNodeChange(
              {
                type: "set",
                path: add_path,
                value: add_oldValue,
              } as ParamChange,
              false,
            ),
          redo: () => ApplyParamNodeChange(paramChange, false),
        } as UndoCommand);
      }
      break;
    case "delete":
      const delete_path = paramChange.path.replace("$.", "");
      const delete_oldValue = JSONPath({
        path: delete_path,
        json: paramNode.value,
      })[0] as any[];
      const delete_newValue = cloneDeep(delete_oldValue);
      delete_newValue.splice(paramChange.index, 1);
      _.set(paramNode.value, delete_path, delete_newValue);

      //添加回撤部分
      if (enableUndoHistory) {
        udnoManager.add({
          label: "设置变量",
          undo: () =>
            ApplyParamNodeChange(
              {
                type: "set",
                path: delete_path,
                value: delete_oldValue,
              } as ParamChange,
              false,
            ),
          redo: () => ApplyParamNodeChange(paramChange, false),
        } as UndoCommand);
      }
      break;
    case "swap":
  }

  const filePath = `/${selectedWorkspaceId.value}/${variableDataGroupKey}/${selectedVarialbeName.value}.json`;

  await storage.writeFile(filePath, JSON.stringify(paramNode.value.value));
}
provide("ApplyParamNodeChange", ApplyParamNodeChange);

//初始化默认的工作清单
const baseStructList = ref<BaseStruct[]>([]);
const variableDataList = ref<VariableData[]>([]);
const paramNode = ref<ParamNode>(); //渲染的节点部分
let currentParamNodeId = ""; //记录了需要修改的节点的id
provide("baseStructList", baseStructList); //让子param组件能读取到

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

  if (!isForce) {
    const binduuid = crypto.randomUUID();
    udnoManager.add({
      label: "新建工作区",
      groupId: undoGroupId,
      undo: async () => {
        const trashPath = await storage.trash(workspacePath);
        BindNodeId(binduuid, trashPath);
        RefreshWorkspace();
      },
      redo: async () => {
        await storage.restore(ResolveNodeId(binduuid), `/`);
        RefreshWorkspace();
      },
    });
  }

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

    if (!isForce) {
      const binduuid = crypto.randomUUID();
      BindNodeId(binduuid, trashPath);
      udnoManager.add({
        label: "删除工作区",
        groupId: undoGroupId,
        undo: async () => {
          await storage.restore(ResolveNodeId(binduuid), `/`);
          RefreshWorkspace();
        },
        redo: async () => {
          const trashPath = await storage.trash(`/${workspaceId}`);
          BindNodeId(binduuid, trashPath);
          RefreshWorkspace();
        },
      });
    }
    RefreshWorkspace();
  }
}

//选择文件部分
const fileInput = ref<HTMLInputElement | null>(null);
const selectedIndex = ref<number | null>(null);
// 点击按钮触发选择文件
function selectFile(index: number) {
  selectedIndex.value = index;
  fileInput.value?.click(); // 必须直接在点击事件触发
}
// 处理文件选择
function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file || selectedIndex.value === null) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let fileContent = e.target?.result as string;
    let fileJson;
    try {
      fileJson = JSON.parse(fileContent);
    } catch {
      alert("解析文件失败");
      return;
    }
    //根据类别读取文件
    switch (selectedIndex.value) {
      case 0: //选择高级结构体数据
        //键入ID
        let inputId = prompt(`请输入「 ${fileJson.name} 」的 ID:`, "");
        // 如果用户取消了 prompt，退出
        if (inputId == null || !/^\d+$/.test(inputId) || inputId.length != 10) {
          alert("请输入有效10位长度的整数ID！");
          return;
        }

        AddBaseStruct(inputId, fileContent);

        break;
      case 1: //选择自定义变量
        AddVariableData(file.name, fileContent);
        break;
      default:
        alert("读取文件错误");
        break;
    }
  };
  reader.readAsText(file);
  target.value = "";
}

async function AddBaseStruct(
  structId: string,
  structData: string,
  undoGroupId = "",
  isForce = false,
): Promise<string | undefined> {
  if (selectedWorkspaceId.value == "") {
    toast.warning("不存在活跃工作区，无法添加高级数据管理");
    return;
  }

  undoGroupId = undoGroupId || crypto.randomUUID();

  const fileDir = `/${selectedWorkspaceId.value}/${baseStructKey}`;
  const filePath = `${fileDir}/${structId}.json`;

  if (await storage.exists(filePath)) {
    toast.warning(`存在id为：${structId}的结构体定义，无法重复添加`);
  }

  await storage.writeFile(filePath, structData);

  if (!isForce) {
    const binduuid = crypto.randomUUID();
    udnoManager.add({
      label: "添加高级数据管理",
      groupId: undoGroupId,
      undo: async () => {
        const trashPath = await storage.trash(filePath);
        BindNodeId(binduuid, trashPath);
        RefreshBaseStruct();
      },
      redo: async () => {
        await storage.restore(ResolveNodeId(binduuid), fileDir);
        RefreshBaseStruct();
      },
    });
  }

  RefreshBaseStruct();
}

/**
 * 删除基础结构体
 * @param fileNodeId 文件的id
 */
async function DeleteBaseStruct(undoGroupId: string = "", isForce = false) {
  undoGroupId = undoGroupId || crypto.randomUUID();

  const id = selectedStructId.value;
  if (
    confirm(
      `是否要删除高级数据管理的 【${id}】,名字:【${
        baseStructList.value.find((q) => q.structId == id)?.structDefinition
          .name
      }】`,
    )
  ) {
    const workspaceId = selectedWorkspaceId.value;

    const fileDir = `/${workspaceId}/${baseStructKey}`;
    const filePath = `${fileDir}/${id}.json`;

    const trashPath = await storage.trash(filePath);

    ChangeBaseStruct("", undoGroupId, isForce);

    if (!isForce) {
      const binduuid = crypto.randomUUID();
      BindNodeId(binduuid, trashPath);
      udnoManager.add({
        label: "删除高级结构体定义",
        groupId: undoGroupId,
        undo: async () => {
          await storage.restore(ResolveNodeId(binduuid), fileDir);
          RefreshBaseStruct();
        },
        redo: async () => {
          const trashPath = await storage.trash(filePath);
          BindNodeId(binduuid, trashPath);
          RefreshBaseStruct();
        },
      });
    }
    RefreshBaseStruct();
  }
}

async function AddVariableData(
  name: string,
  content: string,
  undoGroupId = "",
  isForce = false,
): Promise<void> {
  if (selectedWorkspaceId.value == "") {
    toast.warning("不存在活跃工作区，无法添加自定义变量");
    return;
  }

  undoGroupId = undoGroupId || crypto.randomUUID();

  const fileDir = `/${selectedWorkspaceId.value}/${variableDataGroupKey}`;
  const filePath = `${fileDir}/${name}.json`;

  if (await storage.exists(filePath)) {
    toast.warning(`存在id为：${name}的变量，无法重复添加`);
  }
  await storage.writeFile(filePath, content);

  if (!isForce) {
    const binduuid = crypto.randomUUID();
    udnoManager.add({
      label: "添加自定义数据",
      groupId: undoGroupId,
      undo: async () => {
        const trashPath = await storage.trash(filePath);
        BindNodeId(binduuid, trashPath);
        RefreshVariableData();
      },
      redo: async () => {
        await storage.restore(ResolveNodeId(binduuid), fileDir);
        RefreshVariableData();
      },
    });
  }

  RefreshVariableData();
  return;
}

async function DeleteVariableData(undoGroupId: string = "", isForce = false) {
  undoGroupId = undoGroupId || crypto.randomUUID();

  const id = selectedVarialbeName.value;

  if (
    confirm(
      `是否要删除自定义变量的 【${
        variableDataList.value.find(
          (q) => q.variableName == selectedVarialbeName.value,
        )?.variableName
      }】`,
    )
  ) {
    const workspaceId = selectedWorkspaceId.value;

    const fileDir = `/${workspaceId}/${variableDataGroupKey}`;
    const filePath = `${fileDir}/${id}.json`;

    const trashPath = await storage.trash(filePath);

    ChangeVariableData("", undoGroupId, isForce);

    if (!isForce) {
      const binduuid = crypto.randomUUID();
      BindNodeId(binduuid, trashPath);
      udnoManager.add({
        label: "删除自定义数据",
        groupId: undoGroupId,
        undo: async () => {
          await storage.restore(ResolveNodeId(binduuid), fileDir);
          await RefreshVariableData();
        },
        redo: async () => {
          const trashPath = await storage.trash(filePath);
          BindNodeId(binduuid, trashPath);
          await RefreshVariableData();
        },
      });
    }
    await RefreshVariableData();
  }
}

async function ChangeVariableDataName(
  newName: string,
  undoGroupId = "",
  isForce = false,
) {
  undoGroupId = undoGroupId || crypto.randomUUID();

  const oldName = selectedVarialbeName.value;

  const fileDir = `/${selectedWorkspaceId.value}/${variableDataGroupKey}`;
  const filePath = `${fileDir}/${oldName}.json`;

  if (!isForce) {
    udnoManager.add({
      label: "修改自定义变量名",
      groupId: undoGroupId,
      undo: async () => {
        const filePath = `${fileDir}/${newName}.json`;

        await storage.rename(filePath, `${oldName}.json`);
        ChangeVariableData(oldName, undoGroupId, true);
        await RefreshVariableData();
      },
      redo: async () => {
        const filePath = `${fileDir}/${oldName}.json`;

        await storage.rename(filePath, `${newName}.json`);
        await RefreshVariableData();
        ChangeVariableData(newName, undoGroupId, true);
      },
    });
  }
  await storage.rename(filePath, `${newName}.json`);
  await RefreshVariableData();
  ChangeVariableData(newName, undoGroupId, false);
}

//页面挂载时加载数据
onBeforeMount(async () => {
  //如果工作区的长度为0则执行初始化操作
  if ((await storage.getFolders("")).length == 0) {
    consola.info("结构体编辑页面无存档，进行初始创建中");

    //这里读取是否有旧存档
    const oldSave = localStorage.getItem("xiaomoL444-Save");
    if (oldSave != null) {
      const workspaceName = "/旧数据工作区";
      storage.mkdir(workspaceName);

      const oldSaveJson = JSON.parse(oldSave);
      const advanceDataStruct = oldSaveJson["advancedDataStruct"];
      const StructData = oldSaveJson["structData"];
      //分别储存下来
      await Promise.all(
        advanceDataStruct.map(async (data: any) => {
          await storage.writeFile(
            `/${workspaceName}/${baseStructKey}/${data.basic_struct_id}.json`,
            JSON.stringify(data),
          );

          consola.trace(data);
        }),
      );
      await Promise.all(
        StructData.map(async (data: any) => {
          await storage.writeFile(
            `/${workspaceName}/${variableDataGroupKey}/${data.name}.json`,
            JSON.stringify(data),
          );
        }),
      );
    } else {
      storage.mkdir("/默认工作区");
    }
  }

  //加载完毕后触发一次刷新工作区
  await ChangeWorkspace((await storage.getFolders("/"))[0], "", true);

  await RefreshWorkspace();
  window.addEventListener("keydown", handleKey); //监听按键，撤回、重做、保存
});

async function RefreshWorkspace() {
  consola.debug("刷新工作区");
  workspaceIds.value = await storage.getFolders("/");
}

async function RefreshBaseStruct() {
  consola.debug("刷新高级数据管理区");

  baseStructList.value = await Promise.all(
    (
      await storage.getFiles(`/${selectedWorkspaceId.value}/${baseStructKey}`)
    )
      .filter((f) => f.endsWith(".json")) // 只保留 .json 文件
      .map(async (f) => {
        const id = f.replace(/\.json$/, ""); // 去掉 .json 获取前缀
        const content = await storage.readFile(
          `/${selectedWorkspaceId.value}/${baseStructKey}/${f}`,
        );
        return {
          structId: id,
          structDefinition: JSON.parse(content),
        } as BaseStruct; // 返回结构体
      }),
  );
}

async function RefreshVariableData() {
  consola.debug("刷新自定义变量");

  variableDataList.value = await Promise.all(
    (
      await storage.getFiles(
        `/${selectedWorkspaceId.value}/${variableDataGroupKey}`,
      )
    )
      .filter((f) => f.endsWith(".json")) // 只保留 .json 文件
      .map(async (f) => {
        const name = f.replace(/\.json$/, ""); // 去掉 .json 获取前缀
        const content = await storage.readFile(
          `/${selectedWorkspaceId.value}/${variableDataGroupKey}/${f}`,
        );
        return {
          variableName: name,
          value: JSON.parse(content),
        } as VariableData; // 返回结构体
      }),
  );
}

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKey);
});

async function handleKey(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === "z") {
    e.preventDefault();

    //撤回
    await udnoManager.undo();
    toast.info(
      `撤回:【${
        udnoManager.getCommands()[udnoManager.getIndex() + 1]?.label
      }】还可撤回${udnoManager.getIndex() + 1}步`,
    );
  } else if (e.ctrlKey && e.key === "y") {
    e.preventDefault();

    //重做
    await udnoManager.redo();
    toast.info(
      `重做【${
        udnoManager.getCommands()[udnoManager.getIndex()]?.label
      }】还可重做${
        udnoManager.getCommands().length - udnoManager.getIndex() - 1
      }步`,
    );
  } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault(); // 阻止浏览器默认保存行为
    // 调用你自己的保存函数
    downloadJson();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
    e.preventDefault(); // 阻止浏览器默认保存行为
    consola.trace(udnoManager.getCommands());
  }
}

const copied = ref(false);

function copyCache() {
  const cacheData = JSON.stringify(SaveData.value);
  navigator.clipboard
    .writeText(cacheData)
    .then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 3000);
    })
    .catch(() => alert("复制失败，请手动复制"));
}
const STORAGE_KEY = "xiaomoL444-Save";

const SaveData = ref({ advancedDataStruct: [], structData: [] });
const undoStack = ref([]);
const redoStack = ref([]);
// ✅ 增加一个“是否是手动修改”的标志
let isProgrammaticChange = false;

const variableSelect = ref(0);

let oldValue = {};

function downloadJson() {
  if (selectedVarialbeName.value == "") return;
  // 1️⃣ 转成格式化 JSON 字符串
  const jsonString = JSON.stringify(
    variableDataList.value.find(
      (q) => q.variableName == selectedVarialbeName.value,
    )?.value,
    null,
    2,
  );

  // 2️⃣ 生成 Blob（二进制大对象）
  const blob = new Blob([jsonString], { type: "application/json" });

  // 3️⃣ 创建临时下载链接
  const url = URL.createObjectURL(blob);

  // 4️⃣ 创建一个 <a> 元素来触发下载
  const link = document.createElement("a");
  link.href = url;
  link.download = `${selectedVarialbeName.value}.json`; // 默认文件名
  link.click();

  // 5️⃣ 释放资源
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.container {
  display: flex;
  flex-direction: row; /* 默认左右 */
  gap: 10px;
  height: 100%; /* PC 固定页面高度 */
  overflow: hidden; /* 控制左右滚动 */
}
.switchPanel {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 250px; /* 左侧固定宽度 */
  gap: 10px;
}
.switchPanel .top {
  flex: 1;
}
.switchPanel .bottom {
  flex: 3;
}
.variablePanel {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 250px; /* 左侧固定宽度 */
  overflow-y: auto;
}
.editorPanel {
  display: flex;
  flex: 1; /* 占满剩余空间 */
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}

.actionButtonComponent {
  display: flex;
  flex-direction: row;
  gap: 0.2rem;
}
.actionButtonComponent .delete {
  /* flex: 1; */
  width: 5rem;
}
.actionButtonComponent .add {
  flex: 1 1 auto;
}
.boxs {
  display: flex;
  flex-direction: row;
  /* height: 100%; */
  /* 垂直排列 */
  /* gap: 0.2vw; */
  overflow-y: auto;
  /* 超出自己高度出现滚动条 */
}

/* 选择的列表的渲染 */
.selectableListPlane {
  padding-top: 0.5rem;
  /* flex: 1; */
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.editorArea {
  /* flex: 1; */
  flex: 1;
  overflow-y: auto; /* 或 scroll */
  max-height: 100%; /* 或 100% 如果父级有明确高度 */
  height: 100%; /* 如果父级有高度约束 */
}
</style>
