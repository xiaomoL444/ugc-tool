<template>
  <div class="container">
    <!-- 字符串 -->
    <div v-if="(['String']as ParamType[]).includes(param.param_type)">
      <input placeholder="请输入文本" :value="param.value" @change="onChange" />
    </div>

    <!-- 字符串列表 -->
    <div
      v-if="(['StringList']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(value,index) in (param.value as string[])"
        :key="index"
        class="row"
      >
        <input
          class="input"
          placeholder="请输入文本"
          :value="value"
          @change="onChange($event, index)"
        />
        <div class="operation">
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 整形 -->
    <div
      v-if="(['Int32','Guid','ConfigReference','Army','EntityReference']as ParamType[]).includes(param.param_type)"
    >
      <input
        type="number"
        placeholder="0"
        :value="param.value"
        @change="onChange"
      />
    </div>

    <!-- 整形列表 -->
    <div
      v-if="(['Int32List','GuidList','ConfigReferenceList','ArmyList','EntityReferenceList']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(value,index) in (param.value as string[])"
        :key="index"
        class="row"
      >
        <input
          type="number"
          placeholder="0"
          :value="value"
          @change="onChange($event, index)"
        />
        <div class="operation">
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 浮点数 -->
    <div v-if="(['Float']as ParamType[]).includes(param.param_type)">
      <input
        type="number"
        step="0.01"
        placeholder="0.00"
        :value="param.value"
        @change="onChange"
      />
    </div>

    <!-- 浮点数列表 -->
    <div
      v-if="(['FloatList']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(value,index) in (param.value as string[])"
        :key="index"
        class="row"
      >
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="value"
          @change="onChange($event, index)"
        />
        <div class="operation">
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 布尔值 -->
    <div v-if="(['Bool']as ParamType[]).includes(param.param_type)">
      <select :value="param.value" @change="onChange">
        <option value="True">是</option>
        <option value="False">否</option>
      </select>
    </div>

    <!-- 布尔值列表 -->
    <div
      v-if="(['BoolList']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(value,index) in (param.value as string[])"
        :key="index"
        class="row"
      >
        <select :value="value" @change="onChange($event, index)">
          <option value="True">是</option>
          <option value="False">否</option>
        </select>
        <div class="operation">
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 三维向量 -->
    <div v-if="(['Vector3']as ParamType[]).includes(param.param_type)">
      <div class="vector3Param">
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="(param.value as String).split(',')[0]"
          @change="onChange($event, -1, true, 0, param.value as string)"
        /><input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="(param.value as String).split(',')[1]"
          @change="onChange($event, -1, true, 1, param.value as string)"
        />
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="(param.value as String).split(',')[2]"
          @change="onChange($event, -1, true, 2, param.value as string)"
        />
      </div>
    </div>

    <!-- 三维向量列表 -->
    <div
      v-if="(['Vector3List']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(value,index) in (param.value as string[])"
        :key="index"
        class="vector3Param row"
      >
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="(value as String).split(',')[0]"
          @change="onChange($event, index, true, 0, value)"
        /><input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="(value as String).split(',')[1]"
          @change="onChange($event, index, true, 1, value)"
        />
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          :value="(value as String).split(',')[2]"
          @change="onChange($event, index, true, 2, value)"
        />
        <div class="operation">
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 实体 -->
    <div v-if="(['Entity']as ParamType[]).includes(param.param_type)">
      {{ param.value }}
    </div>

    <!-- 实体列表 -->
    <div
      v-if="(['EntityList']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(value,index) in (param.value as string[])"
        :key="index"
        class="row"
      >
        {{ value }}
        <div class="operation">
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 结构体 -->
    <div
      v-if="(['Struct']as ParamType[]).includes(param.param_type)"
      class="structNode"
    >
      <div
        v-if="baseStructList?.some(q=>q.structId==(param.value as StructNode).structId)"
        v-for="(childrenParam, index) in (param.value as StructNode).value"
        :key="index"
        style="overflow: visible"
      >
        <PanelLayout
          class="param"
          style="overflow: visible"
          v-if="childrenParam.param_type== baseStructList?.find(
                  (q) => q.structId == (param.value as StructNode).structId,
                )?.structDefinition.value[index]?.param_type"
        >
          <div
            class="definition sticky-title"
            :style="{ top: `${structListCount * 10 + 2}px` }"
          >
            <div class="name">
              <NEllipsis>
                {{
                  baseStructList?.find(
                    (q) => q.structId == (param.value as StructNode).structId,
                  )?.structDefinition.value[index]?.key
                }}
              </NEllipsis>
            </div>
            <div
              class="paramType"
              :style="{
                '--bg-color': ParamMetaMap[childrenParam.param_type].background,
                '--color': ParamMetaMap[childrenParam.param_type].color,
              }"
            >
              <NEllipsis style="max-width: 100%">
                {{ ParamMetaMap[childrenParam.param_type].title }}
              </NEllipsis>
            </div>
          </div>
          <div class="value">
            <ParamNodeRender
              :param="childrenParam"
              :json-path="`${jsonPath}.value.value[${index}]`"
              :struct-list-count="structListCount + 1"
            ></ParamNodeRender></div
        ></PanelLayout>
        <PanelLayout
          v-else
          style="background: #ff89aabb; align-items: center; padding: 10px"
          ><div>
            字段类型错误！结构体id:{{ (param.value as StructNode).structId }}
            <p>
              变量类型：
              {{ ParamMetaMap[childrenParam.param_type || "NULL"].title }}
            </p>
            提供的结构体定义类型：{{
              ParamMetaMap[
                (baseStructList?.find(
                  (q) => q.structId == (param.value as StructNode).structId,
                )?.structDefinition.value[index]?.param_type as ParamType) ||
                  "NULL"
              ].title
            }}
          </div></PanelLayout
        >
      </div>
      <div v-else>
        <PanelLayout
          style="background: #ff89aabb; align-items: center; padding: 10px"
        >
          <div>结构体id不存在：{{ (param.value as StructNode).structId }}</div>
        </PanelLayout>
      </div>
    </div>

    <!-- 结构体列表 -->
    <div
      v-if="(['StructList']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        v-for="(childrenParam, index) in (param.value as StructListNode).value"
        :key="index"
        class="row"
      >
        <div style="width: 100%">
          <div
            class="sticky-title"
            style="
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px); /* Safari */

              background: rgba(255, 255, 255, 0.9);
              border-radius: 12px;
              padding-left: 20px;
              width: 100%;
              cursor: default;
              user-select: none;
            "
            :style="{ top: `${structListCount * 10 - 10}px` }"
            v-on:click="ClickCollapse(index)"
          >
            第{{ index }}项,{{ fastHash(JSON.stringify(childrenParam)) }}
          </div>
          <NCollapse
            v-model:expanded-names="expandedNames"
            style="position: relative; margin-top: -20px"
            ><NCollapseItem :name="index" style="margin-left: 0">
              <div style="display: flex; flex-direction: row">
                <ParamNodeRender
                  :param="childrenParam"
                  :json-path="`${jsonPath}.value.value[${index}]`"
                  :struct-list-count="structListCount + 1"
                  style="position: relative"
                ></ParamNodeRender>
              </div> </NCollapseItem
          ></NCollapse>
        </div>
        <div
          class="operation sticky-title"
          :style="{ top: `${structListCount * 10}px` }"
        >
          <RemoveListElementButton
            v-on:update:selected="RemoveListElement(index)"
          ></RemoveListElementButton>
          <AddListElementButton
            v-on:update:selected="AddListElement(index)"
          ></AddListElementButton>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>

    <!-- 字典 -->
    <div
      v-if="(['Dict']as ParamType[]).includes(param.param_type)"
      class="listParam"
    >
      <div
        style="display: flex; flex-direction: column"
        v-for="(childrenParam, index) in (param.value as DictNode).value"
        :key="index"
        class="row"
      >
        <div class="dict">
          <ParamNodeRender
            class="key sticky-title"
            :style="{ top: `${structListCount * 10}px` }"
            :param="childrenParam.key"
            :json-path="`${jsonPath}.value.value[${index}.key`"
            :struct-list-count="structListCount + 1"
          ></ParamNodeRender>

          <ParamNodeRender
            class="value"
            :param="childrenParam.value"
            :json-path="`${jsonPath}.value.value[${index}.value`"
            :struct-list-count="structListCount + 1"
          ></ParamNodeRender>
          <div class="operation">
            <RemoveListElementButton
              v-on:update:selected="RemoveListElement(index)"
            ></RemoveListElementButton>
            <AddListElementButton
              v-on:update:selected="AddListElement(index)"
            ></AddListElementButton>
          </div>
        </div>
      </div>
      <AppendListElementButton
        v-on:update:selected="AppendListElement"
      ></AppendListElementButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeMount,
  onMounted,
  ref,
  Ref,
} from "vue";
import { BaseStruct } from "../types/WorkspaceManifest";
import {
  DictNode,
  ParamNode,
  ParamType,
  StructListNode,
  StructNode,
} from "../types/ParamsType";
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import { ParamMetaMap } from "../utils/variableTypeMap";
import { ParamChange } from "../types/ParamChange";
import AddListElementButton from "../button/AddListElementButton.vue";
import RemoveListElementButton from "../button/RemoveListElementButton.vue";
import AppendListElementButton from "../button/AppendListElementButton.vue";
import { consola } from "consola";
import { NCollapse, NCollapseItem, NEllipsis } from "naive-ui";
import { bus } from "@/services/bus/bus";

const baseStructList = inject<Ref<BaseStruct[]>>("baseStructList");

const props = defineProps<{
  param: ParamNode;
  jsonPath: string;
  structListCount: number;
}>();

const expandedNames = ref<number[]>([]);
onBeforeMount(() => {
  expandedNames.value = Array.from(
    { length: (props.param.value as StructListNode).value?.length },
    (_, i) => i,
  );

  bus.on("closeCollapse", () => {
    expandedNames.value = [];
  });
  bus.on("openCollapse", () => {
    expandedNames.value = Array.from(
      { length: (props.param.value as StructListNode).value?.length },
      (_, i) => i,
    );
  });
});

function ClickCollapse(index: number) {
  if (expandedNames.value.includes(index)) {
    expandedNames.value = expandedNames.value.filter((q) => q != index);
  } else {
    expandedNames.value.push(index);
  }
}

const ApplyParamNodeChange = inject<(paramChange: ParamChange) => void>(
  "ApplyParamNodeChange",
);
/**
 * 当输入内容改变时
 * @param e 事件
 * @param [listIndex=-1] 默认是-1,表示这是普通的value,若不是-1,则表示这个是list，需要改变元素，特殊情况三维向量表示第几个值
 * @param [isVector3=false] 是否是三维向量
 * @param [vector3Index=0] 若是三维向量时，则表示三维向量的第几位
 * @param [vector3Source=''] 三维向量的整一个值
 */
function onChange(
  e: Event,
  listIndex: number = -1,
  isVector3 = false,
  vector3Index: number = 0,
  vector3Source: string = "",
) {
  let value = (e.target as HTMLInputElement).value;
  let jsonPath = "";

  jsonPath = `${props.jsonPath}.value${
    listIndex == -1 ? "" : `[${listIndex}]`
  }`;
  //如果是三维向量，则特殊处理，取出原来的值，进行修改
  if (isVector3) {
    console.log("isVector3");
    value = vector3Source
      .split(",")
      .map((q, index) => {
        if (index != vector3Index) {
          return q;
        } else {
          return value;
        }
      })
      .join(",");
  }
  console.log(value);
  console.log(jsonPath);
  ApplyParamNodeChange?.({
    type: "set",
    path: jsonPath,
    value: value,
  } as ParamChange);
}

function GetParamDefaultValue(param_type: ParamType, structId = ""): any {
  switch (param_type) {
    case "String":
    case "StringList":
      return " ";
    case "Float":
    case "FloatList":
      return "0.00";
    case "Bool":
    case "BoolList":
      return "False";
    case "Vector3":
    case "Vector3List":
      return "0,0,0";
    case "Int32":
    case "Entity":
    case "Guid":
    case "ConfigReference":
    case "EntityReference":
    case "Army":
    case "Int32List":
    case "EntityList":
    case "GuidList":
    case "ConfigReferenceList":
    case "EntityReferenceList":
    case "ArmyList":
      return "0";

    case "Struct":
      return {
        param_type: "Struct",
        value: {
          structId: structId,
          type: "Struct",
          value: baseStructList?.value
            ?.find((q) => q.structId == structId)
            ?.structDefinition.value.map((v: any) => ({ ...v.value })),
        },
      };
    case "StructList":
      return GetParamDefaultValue("Struct", structId);
    // return {
    //   param_type: "StructList",
    //   value: GetParamDefaultValue("Struct", structId),
    // };
    case "Dict":
      const key = {
        param_type: (props.param.value as DictNode).key_type,
        value: GetParamDefaultValue((props.param.value as DictNode).key_type),
      };

      let value;
      if ((props.param.value as DictNode).value_type == "StructList") {
        value = {
          param_type: "StructList",
          value: { structId: structId, value: [] },
        };
      } else if ((props.param.value as DictNode).value_type == "Struct") {
        value = GetParamDefaultValue("Struct", structId);
      } else {
        value = {
          param_type: (props.param.value as DictNode).value_type,
          value: GetParamDefaultValue(
            (props.param.value as DictNode).value_type,
            structId,
          ),
        };
      }

      return {
        key: key,
        value: value,
      };
  }
  return;
}

function insertAndShift(list: number[], n: number) {
  const newList = list.map((v) => (v >= n ? v + 1 : v));
  newList.push(n);

  return newList.sort((a, b) => a - b);
}

async function AddListElement(index: number) {
  let jsonPath = `${props.jsonPath}.value`;

  if (["StructList", "Dict"].includes(props.param.param_type)) {
    jsonPath += ".value";
  }

  let structId = "";
  structId =
    (props.param.param_type == "StructList"
      ? (props.param.value as StructNode).structId
      : (props.param.value as DictNode).value_structId) ?? "0";

  consola.trace(expandedNames);
  insertAndShift(expandedNames.value, index);
  await nextTick();
  ApplyParamNodeChange?.({
    type: "add",
    path: jsonPath,
    index: index,
    value: GetParamDefaultValue(props.param.param_type, structId),
  } as ParamChange);
}
function RemoveListElement(index: number) {
  let jsonPath = `${props.jsonPath}.value`;

  if (["StructList", "Dict"].includes(props.param.param_type)) {
    jsonPath += ".value";
  }

  ApplyParamNodeChange?.({
    type: "delete",
    path: jsonPath,
    index: index,
  } as ParamChange);
}
function AppendListElement() {
  if (["StructList", "Dict"].includes(props.param.param_type)) {
    AddListElement(((props.param.value as any).value as any[]).length);
    return;
  }
  AddListElement((props.param.value as any[]).length);
}

function fastHash(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}
</script>

<style scoped>
.container {
  width: 100%;
  padding-left: 0%;
  text-align: left;
  box-sizing: border-box;
}

.listParam {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.listParam .row {
  display: flex;
  flex-direction: row;
  gap: 10px;
  overflow: visible;
}
.listParam .row .input {
  flex: 1;
}
.listParam .row .operation {
  display: flex;
  flex-direction: row;
  gap: 10px;
  height: 20px;
}

.structNode {
  min-height: 0;
  width: 100%;
  /* overflow-y: auto; */
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: transparent;
  /* margin: 10px; */
  /* padding: 10px; */
}

.structNode .sticky-title {
  position: sticky;
  top: 0;
  z-index: 10;
}

.structNode::-webkit-scrollbar {
  display: none; /* Chrome / Safari */
}

.structNode .param {
  display: flex;
  flex-direction: row;
  width: 100%;
  padding: 10px;
  z-index: 20;
}
.structNode .param .definition {
  flex: 1;
  width: 120px;
  z-index: 20;
  display: flex;
  flex-direction: row;
  height: min-content;
}
.structNode .param .definition .name {
  max-width: 50%;
}
.structNode .param .definition .paramType {
  background-color: var(--bg-color, #ccc);
  color: var(--color, #fff);
  height: min-content;
  border-radius: 6px;
  padding: 4px 10px;
  margin: 0 5px;
  max-width: 50%;
  font-size: 0.8rem;
}
.structNode .param .value {
  position: relative;
  flex: 7;
  width: 100%;
  overflow: visible;
  left: 7px;
}
.vector3Param {
  display: flex;
  flex-direction: row;
  gap: 10px;
}

.dict {
  display: flex;
  flex-direction: row;
  gap: 10px;
}
.dict .key {
  width: 100px;
  height: min-content;
}
.dict .value {
  flex: 1;
}

select {
  width: 100%;
  border: none;
  border-radius: 6px;
  /* 去掉默认边框 */
  border-bottom: 1px solid #ccc;
  /* 初始底线 */
  padding: 0.5rem 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  outline: none;
  transition: border-color 0.3s;
  /* 颜色渐变 */
  box-sizing: border-box;
}
</style>
