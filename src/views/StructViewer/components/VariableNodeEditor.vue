<template>
  <div class="variable-node" :class="{ invalid: hasNodeError }">
    <div v-if="errorMessages.length" class="issue">
      <div
        v-for="(message, index) in errorMessages"
        :key="index"
        class="issue-line"
      >
        {{ message }}
      </div>
    </div>
    <div v-if="isContainer" class="node-toolbar sticky-title">
      <button class="collapse-button" type="button" @click="collapsed = !collapsed">
        {{ collapsed ? "▶" : "▼" }} {{ variable.name || typeMeta.title }}
      </button>
      <span class="type-badge" :style="badgeStyle">{{ typeMeta.title }}</span>
      <span v-if="variable.structId" class="struct-id">ID: {{ variable.structId }}</span>
      <span class="toolbar-spacer"></span>
      <button v-if="canCopyNode" class="node-action" type="button" @click="copyNode">复制</button>
      <button v-if="canCopyNode" class="node-action" type="button" @click="pasteNode">粘贴</button>
    </div>

    <template v-if="!collapsed">
      <select v-if="renderType === 'Bool'" :value="variable.value" @change="changePrimitive">
        <option value="True">是</option>
        <option value="False">否</option>
      </select>

      <div v-else-if="renderType === 'Vector3'" class="vector3-param">
        <input
          v-for="index in 3"
          :key="index"
          type="number"
          step="0.01"
          :value="vectorParts(variable.value)[index - 1]"
          @change="changeVector($event, index - 1)"
        />
      </div>

      <div v-else-if="isPlainList" class="list-param">
        <div v-for="(item, index) in listItems" :key="index" class="row">
          <div v-if="elementType === 'Vector3'" class="vector3-param input">
            <input
              v-for="partIndex in 3"
              :key="partIndex"
              type="number"
              step="0.01"
              :value="vectorParts(item)[partIndex - 1]"
              @change="changeListVector($event, index, partIndex - 1)"
            />
          </div>
          <select
            v-else-if="elementType === 'Bool'"
            class="input"
            :value="item"
            @change="changeListItem($event, index)"
          >
            <option value="True">是</option>
            <option value="False">否</option>
          </select>
          <input
            v-else
            class="input"
            :type="inputType(elementType)"
            :step="elementType === 'Float' ? '0.01' : undefined"
            :value="item"
            @change="changeListItem($event, index)"
          />
          <div class="operation">
            <RemoveListElementButton @update:selected="removeItem(index)" />
            <AddListElementButton @update:selected="insertItem(index)" />
          </div>
        </div>
        <AppendListElementButton @update:selected="appendItem" />
      </div>

      <div v-else-if="renderType === 'Struct'" class="struct-node">
        <PanelLayout
          v-for="([fieldName, child], index) in structFields"
          :key="child.path + '-' + index"
          class="param"
        >
          <div class="definition sticky-title" :style="{ top: depth * 10 + 2 + 'px' }">
            <div class="name"><NEllipsis>{{ fieldName }}</NEllipsis></div>
            <span class="type-badge" :style="metaStyle(child)">
              {{ metaFor(child.isMissing ? child.defineType : child.type).title }}
            </span>
          </div>
          <div class="field-value">
            <VariableNodeEditor :variable="child" :revision="revision" :depth="depth + 1" />
          </div>
        </PanelLayout>
        <div v-if="structFields.length === 0" class="empty-state">
          未找到可编辑字段，请检查结构体定义和变量数据。
        </div>
      </div>

      <div v-else-if="renderType === 'StructList'" class="list-param">
        <div v-for="(child, index) in structItems" :key="child.path" class="row">
          <div class="nested-value">
            <div class="item-title">第 {{ index }} 项 · {{ child.name || child.structId }}</div>
            <VariableNodeEditor :variable="child" :revision="revision" :depth="depth + 1" />
          </div>
          <div class="operation sticky-title" :style="{ top: depth * 10 + 'px' }">
            <RemoveListElementButton @update:selected="removeItem(index)" />
            <AddListElementButton @update:selected="insertItem(index)" />
          </div>
        </div>
        <AppendListElementButton @update:selected="appendItem" />
      </div>

      <div v-else-if="renderType === 'Dict'" class="list-param">
        <div v-for="(entry, index) in dictItems" :key="index" class="dict row">
          <div class="dict-part key">
            <div class="item-title">键</div>
            <VariableNodeEditor :variable="entry.key" :revision="revision" :depth="depth + 1" />
          </div>
          <div class="dict-part value">
            <div class="item-title">值</div>
            <VariableNodeEditor :variable="entry.value" :revision="revision" :depth="depth + 1" />
          </div>
          <div class="operation">
            <RemoveListElementButton @update:selected="removeItem(index)" />
            <AddListElementButton @update:selected="insertItem(index)" />
          </div>
        </div>
        <AppendListElementButton @update:selected="appendItem" />
      </div>

      <input
        v-else
        :type="inputType(renderType)"
        :step="renderType === 'Float' ? '0.01' : undefined"
        :value="variable.value"
        placeholder="请输入值"
        @change="changePrimitive"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { NEllipsis } from "naive-ui";
import type {
  ParamType,
  VariableClipboardData,
  VariableDictEntryValue,
  VariableValue,
} from "miliastra-variable";
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import AddListElementButton from "../button/AddListElementButton.vue";
import RemoveListElementButton from "../button/RemoveListElementButton.vue";
import AppendListElementButton from "../button/AppendListElementButton.vue";
import { ParamMetaMap, type ParamMeta } from "../utils/variableTypeMap";
import { bus } from "@/services/bus/bus";
import { toast } from "vue-sonner";

type ApplyVariableMutation = (
  label: string,
  mutate: () => unknown,
) => Promise<boolean>;

const props = withDefaults(
  defineProps<{ variable: VariableValue; revision: number; depth?: number }>(),
  { depth: 0 },
);
const applyMutation = inject<ApplyVariableMutation>("ApplyVariableMutation");
const collapsed = ref(false);
const memoryClipboard = inject<Ref<VariableClipboardData | undefined>>("VariableClipboard");

const renderType = computed<ParamType>(() => {
  void props.revision;
  return props.variable.isMissing
    ? props.variable.defineType || props.variable.type
    : props.variable.type;
});
const isPlainList = computed(
  () => renderType.value.endsWith("List") && renderType.value !== "StructList",
);
const isContainer = computed(() => ["Struct", "StructList", "Dict"].includes(renderType.value));
const canCopyNode = computed(() => ["Struct", "Dict"].includes(renderType.value));
const elementType = computed(() =>
  isPlainList.value ? renderType.value.slice(0, -"List".length) : "",
);
const listItems = computed<unknown[]>(() => {
  void props.revision;
  return isPlainList.value && Array.isArray(props.variable.value) ? props.variable.value : [];
});
const structFields = computed<[string, VariableValue][]>(() => {
  void props.revision;
  const value = props.variable.value;
  return renderType.value === "Struct" && value && typeof value === "object"
    ? (Object.entries(value) as [string, VariableValue][])
    : [];
});
const structItems = computed<VariableValue[]>(() => {
  void props.revision;
  return renderType.value === "StructList" && Array.isArray(props.variable.value)
    ? props.variable.value
    : [];
});
const dictItems = computed<VariableDictEntryValue[]>(() => {
  void props.revision;
  return renderType.value === "Dict" && Array.isArray(props.variable.value)
    ? props.variable.value
    : [];
});
const nodeIssues = computed(() => {
  void props.revision;
  return props.variable.issues.filter(
    (issue) => issue.path === props.variable.path,
  );
});
const hasStructDefinition = computed(() => {
  void props.revision;
  if (!["Struct", "StructList", "Dict"].includes(renderType.value)) return true;
  const structId = props.variable.structId;
  return !structId || props.variable.workspace.hasDefinition(structId);
});
const errorMessages = computed(() => {
  void props.revision;
  const messages: string[] = [];

  if (!hasStructDefinition.value) {
    messages.push("结构体id不存在：" + props.variable.structId);
  }

  for (const issue of nodeIssues.value) {
    if (issue.kind === "type-mismatch") {
      messages.push(
        "字段类型错误！" +
          (props.variable.structId
            ? "结构体id：" + props.variable.structId
            : ""),
      );
      messages.push(
        "变量类型：" + metaFor(issue.type).title + "（" + issue.type + "）",
      );
      messages.push(
        "结构体定义类型：" +
          metaFor(issue.defineType).title +
          "（" +
          (issue.defineType || "未知") +
          "）",
      );
      continue;
    }

    if (issue.kind === "struct-id-mismatch") {
      messages.push(
        "结构体ID不一致：变量为 " +
          (issue.structId || "空") +
          "，定义为 " +
          (issue.defineStructId || "空"),
      );
      continue;
    }

    messages.push(issue.message);
  }

  return [...new Set(messages)];
});
const hasNodeError = computed(() => errorMessages.value.length > 0);
const typeMeta = computed(() => metaFor(renderType.value));
const badgeStyle = computed(() => ({
  "--bg-color": typeMeta.value.background,
  "--color": typeMeta.value.color,
}));

onMounted(() => {
  bus.on("closeCollapse", closeNode);
  bus.on("openCollapse", openNode);
});
onBeforeUnmount(() => {
  bus.off("closeCollapse", closeNode);
  bus.off("openCollapse", openNode);
});
function closeNode() {
  if (isContainer.value) collapsed.value = true;
}
function openNode() {
  collapsed.value = false;
}

function metaFor(type: ParamType | undefined): ParamMeta {
  return ParamMetaMap[type as keyof typeof ParamMetaMap] || {
    title: type || "未知",
    color: "#454545",
    background: "#e5e7eb",
  };
}
function metaStyle(variable: VariableValue) {
  const meta = metaFor(variable.isMissing ? variable.defineType : variable.type);
  return { "--bg-color": meta.background, "--color": meta.color };
}
function inputType(type: ParamType | string) {
  return ["Int32", "Float", "Guid", "ConfigReference", "Army", "Entity", "EntityReference"].includes(
    type,
  )
    ? "number"
    : "text";
}
function vectorParts(value: unknown) {
  const parts = String(value ?? "").split(",");
  return [parts[0] || "0", parts[1] || "0", parts[2] || "0"];
}
function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
async function mutate(label: string, action: () => unknown) {
  await applyMutation?.(label, action);
}
function warnLongString(value: string) {
  if (value.length >= 500) {
    toast.warning("输入的字符超过 500，可能导致导入千星编辑器失败。目前字数：" + value.length);
  }
}
function changePrimitive(event: Event) {
  const value = inputValue(event);
  if (renderType.value === "String") warnLongString(value);
  void mutate("设置变量", () => props.variable.setValue(value));
}
function changeVector(event: Event, partIndex: number) {
  const next = vectorParts(props.variable.value);
  next[partIndex] = inputValue(event);
  void mutate("设置三维向量", () => props.variable.setValue(next.join(",")));
}
function changeListItem(event: Event, index: number) {
  const value = inputValue(event);
  if (elementType.value === "String") warnLongString(value);
  void mutate("设置列表项", () => {
    const next = [...listItems.value];
    next[index] = value;
    props.variable.setValue(next);
  });
}
function changeListVector(event: Event, index: number, partIndex: number) {
  void mutate("设置三维向量列表项", () => {
    const next = [...listItems.value];
    const vector = vectorParts(next[index]);
    vector[partIndex] = inputValue(event);
    next[index] = vector.join(",");
    props.variable.setValue(next);
  });
}
function insertItem(index: number) {
  void mutate("插入列表项", () => props.variable.insertItem(index));
}
function appendItem() {
  void mutate("追加列表项", () => props.variable.appendItem());
}
function removeItem(index: number) {
  void mutate("删除列表项", () => void props.variable.removeItem(index));
}

async function copyNode() {
  const data = props.variable.copy();
  if (memoryClipboard) memoryClipboard.value = data;
  try {
    await navigator.clipboard.writeText(JSON.stringify(data));
    toast.success("已复制" + typeMeta.value.title);
  } catch {
    toast.info("已复制到编辑器内部剪贴板");
  }
}
async function readClipboard(): Promise<VariableClipboardData | undefined> {
  try {
    const parsed = JSON.parse(await navigator.clipboard.readText()) as VariableClipboardData;
    if (parsed?.format === "miliastra-variable/clipboard@1") return parsed;
  } catch {
    // 浏览器拒绝读取时使用本页内的复制结果。
  }
  return memoryClipboard?.value;
}
async function pasteNode() {
  const data = await readClipboard();
  if (!data) {
    toast.warning("剪贴板中没有可粘贴的结构体或字典");
    return;
  }
  if (!props.variable.canPaste(data)) {
    toast.warning("复制内容与目标的类型或结构体 ID 不一致");
    return;
  }
  await mutate("粘贴" + typeMeta.value.title, () => props.variable.paste(data));
}
</script>

<style scoped>
.variable-node { width: 100%; min-width: 0; }
.variable-node.invalid {
  border: 1px solid rgba(218, 46, 84, .65);
  border-left: 4px solid #da2e54;
  border-radius: 10px;
  padding: 8px;
  background: rgba(255, 137, 170, .16);
  box-sizing: border-box;
}
.issue {
  background: #ff89aabb;
  border: 1px solid rgba(218, 46, 84, .55);
  border-radius: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  color: #5f1025;
}
.issue-line + .issue-line { margin-top: 4px; }
.node-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; z-index: 15; background: rgba(255,255,255,.88); backdrop-filter: blur(12px); border-radius: 10px; }
.collapse-button, .node-action { border: 0; border-radius: 6px; cursor: pointer; padding: 4px 8px; background: rgba(142,177,255,.35); color: #26334d; }
.collapse-button { background: transparent; font-weight: 600; }
.node-action:hover { background: rgba(142,177,255,.65); }
.toolbar-spacer { flex: 1; }
.struct-id, .item-title { color: #64748b; font-size: .8rem; }
.type-badge { background: var(--bg-color); color: var(--color); border-radius: 6px; padding: 4px 10px; font-size: .8rem; white-space: nowrap; }
input, select { box-sizing: border-box; width: 100%; border: 0; border-bottom: 1px solid #ccc; border-radius: 6px; outline: none; padding: .5rem; font-size: 1rem; font-weight: 600; }
.list-param, .struct-node { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.row { display: flex; gap: 10px; width: 100%; }
.input, .nested-value, .dict .value { flex: 1; min-width: 0; }
.operation { display: flex; gap: 8px; height: 28px; }
.vector3-param { display: flex; gap: 10px; width: 100%; }
.vector3-param input { min-width: 0; }
.param { display: flex; gap: 10px; overflow: visible; padding: 10px; }
.definition { display: flex; gap: 6px; width: 180px; height: min-content; z-index: 12; }
.definition .name { flex: 1; min-width: 0; }
.field-value { flex: 1; min-width: 0; }
.sticky-title { position: sticky; top: 0; }
.item-title { margin: 4px 0 8px; }
.dict { align-items: flex-start; }
.dict-part { min-width: 0; }
.dict .key { width: min(220px, 30%); }
.empty-state { padding: 16px; color: #8a5a44; }
</style>
