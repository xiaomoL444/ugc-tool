<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { toast } from "vue-sonner";
import ClipPropertyEditor from "../DialogueEditor/components/clip-editors/ClipPropertyEditor.vue";
import { CAMERA_SLOT_PROPERTIES } from "../DialogueEditor/config/cameraClip";
import type { ClipPropertyDefinition } from "../DialogueEditor/types/DialogueNode";
import { createQuestChapter, createQuestMain, createQuestSub, removeQuestSubQuests } from "./questProject";
import type { QuestMain, QuestProject, QuestSelection, QuestSub } from "./types";

const props = defineProps<{ project: QuestProject }>();
const selection = ref<QuestSelection | null>(null);
const search = ref("");
const expanded = ref(new Set<string>(["unassigned"]));
const subPages = ref<Record<number, number>>({});
const treePage = ref(0);
const nextQuestIdInput = ref("");
const SUB_PAGE_SIZE = 50;
const TREE_PAGE_SIZE = 200;
const pointProperty: ClipPropertyDefinition = {
  key: "investigationPoint", label: "调查点", type: "struct", defaultValue: {},
  properties: CAMERA_SLOT_PROPERTIES,
  description: "PositionSlot；坐标空间和点位类型决定需要填写的参数。",
};

const chaptersById = computed(() => new Map(props.project.chapters.map((item) => [item.id, item])));
const mainsById = computed(() => new Map(props.project.mainQuests.map((item) => [item.id, item])));
const subsById = computed(() => new Map(props.project.subQuests.map((item) => [item.id, item])));
const subGroups = computed(() => {
  const groups = new Map<number, QuestSub[]>();
  for (const sub of props.project.subQuests) {
    const group = groups.get(sub.mainQuestId) ?? [];
    group.push(sub);
    groups.set(sub.mainQuestId, group);
  }
  return groups;
});
const selectedChapter = computed(() => selection.value?.kind === "chapter"
  ? chaptersById.value.get(selection.value.id) : undefined);
const selectedMain = computed(() => selection.value?.kind === "main"
  ? mainsById.value.get(selection.value.id) : undefined);
const selectedSub = computed(() => selection.value?.kind === "sub"
  ? subsById.value.get(selection.value.id) : undefined);
const selectedItem = computed(() => selectedChapter.value ?? selectedMain.value ?? selectedSub.value);
const selectedParentMain = computed(() => selectedMain.value
  ?? (selectedSub.value ? mainsById.value.get(selectedSub.value.mainQuestId) : undefined));
const selectedKindLabel = computed(() => ({ chapter: "章节", main: "主任务", sub: "子任务" })[selection.value?.kind ?? "chapter"]);
const activeChapterId = computed(() => selectedChapter.value?.id ?? selectedParentMain.value?.chapterId ?? null);

type TreeRow = {
  key: string;
  kind: "unassigned" | "chapter" | "main" | "sub" | "pagination";
  id: number;
  label: string;
  depth: number;
  count?: number;
  page?: number;
  pageCount?: number;
};

function isOpen(key: string) {
  return Boolean(search.value.trim()) || expanded.value.has(key);
}

function matches(item: { id: number; title: string; description?: string }, query: string) {
  return `${item.id} ${item.title} ${item.description ?? ""}`.toLocaleLowerCase().includes(query);
}

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = [];
  const query = search.value.trim().toLocaleLowerCase();
  const filteredSubs = new Map<number, QuestSub[]>();
  const visibleMains = new Set<number>();
  const mainGroups = new Map<number | null, QuestMain[]>();
  for (const main of props.project.mainQuests) {
    const chapter = main.chapterId === null ? undefined : chaptersById.value.get(main.chapterId);
    const includeAll = !query || matches(main, query) || (chapter && matches(chapter, query));
    const children = subGroups.value.get(main.id) ?? [];
    const matchingChildren = includeAll ? children : children.filter((sub) => matches(sub, query));
    filteredSubs.set(main.id, matchingChildren);
    if (includeAll || matchingChildren.length) visibleMains.add(main.id);
    const chapterKey = chapter?.id ?? null;
    const siblings = mainGroups.get(chapterKey) ?? [];
    siblings.push(main);
    mainGroups.set(chapterKey, siblings);
  }

  function addMains(chapterId: number | null) {
    for (const main of mainGroups.get(chapterId) ?? []) {
      if (!visibleMains.has(main.id)) continue;
      const key = `main:${main.id}`;
      rows.push({ key, kind: "main", id: main.id, label: main.title || "未命名主任务", depth: 1,
        count: subGroups.value.get(main.id)?.length ?? 0 });
      if (!isOpen(key)) continue;
      const children = filteredSubs.get(main.id) ?? [];
      const pageCount = Math.max(1, Math.ceil(children.length / SUB_PAGE_SIZE));
      const page = Math.min(subPages.value[main.id] ?? 0, pageCount - 1);
      for (const sub of children.slice(page * SUB_PAGE_SIZE, (page + 1) * SUB_PAGE_SIZE)) {
        rows.push({ key: `sub:${sub.id}`, kind: "sub", id: sub.id,
          label: sub.title || "未命名子任务", depth: 2 });
      }
      if (pageCount > 1) rows.push({ key: `pages:${main.id}`, kind: "pagination", id: main.id,
        label: main.title, depth: 2, page, pageCount, count: children.length });
    }
  }

  for (const chapter of props.project.chapters) {
    const mains = mainGroups.get(chapter.id) ?? [];
    if (query && !matches(chapter, query) && !mains.some((main) => visibleMains.has(main.id))) continue;
    const key = `chapter:${chapter.id}`;
    rows.push({ key, kind: "chapter", id: chapter.id, label: chapter.title || "未命名章节", depth: 0, count: mains.length });
    if (isOpen(key)) addMains(chapter.id);
  }
  const unassigned = mainGroups.get(null) ?? [];
  if (!query || unassigned.some((main) => visibleMains.has(main.id))) {
    rows.push({ key: "unassigned", kind: "unassigned", id: -1, label: "直属主任务", depth: 0, count: unassigned.length });
    if (isOpen("unassigned")) addMains(null);
  }
  return rows;
});
const treePageCount = computed(() => Math.max(1, Math.ceil(treeRows.value.length / TREE_PAGE_SIZE)));
const visibleRows = computed(() => treeRows.value.slice(treePage.value * TREE_PAGE_SIZE, (treePage.value + 1) * TREE_PAGE_SIZE));

watch(treePageCount, (count) => { treePage.value = Math.min(treePage.value, count - 1); });
watch(search, () => { treePage.value = 0; subPages.value = {}; });
watch(() => selectedSub.value?.id, () => { nextQuestIdInput.value = ""; });
watch(() => props.project, () => {
  selection.value = null;
  search.value = "";
  expanded.value = new Set(["unassigned"]);
  subPages.value = {};
  treePage.value = 0;
});

function toggle(key: string) {
  if (search.value.trim()) return;
  const updated = new Set(expanded.value);
  if (updated.has(key)) updated.delete(key);
  else updated.add(key);
  expanded.value = updated;
}

function selectRow(row: TreeRow) {
  if (row.kind === "unassigned") {
    selection.value = null;
    toggle(row.key);
  } else if (row.kind !== "pagination") {
    selection.value = { kind: row.kind, id: row.id };
  }
}

async function reveal(target: QuestSelection) {
  search.value = "";
  selection.value = target;
  // Wait for the search reset before choosing a child page; search clears pagination.
  await nextTick();
  const open = new Set(expanded.value);
  const main = target.kind === "main" ? mainsById.value.get(target.id)
    : target.kind === "sub" ? mainsById.value.get(subsById.value.get(target.id)?.mainQuestId ?? -1) : undefined;
  if (target.kind === "chapter") open.add(`chapter:${target.id}`);
  if (main) {
    open.add(main.chapterId === null ? "unassigned" : `chapter:${main.chapterId}`);
    open.add(`main:${main.id}`);
    if (target.kind === "sub") {
      const index = (subGroups.value.get(main.id) ?? []).findIndex((sub) => sub.id === target.id);
      subPages.value = { ...subPages.value, [main.id]: Math.max(0, Math.floor(index / SUB_PAGE_SIZE)) };
    }
  }
  expanded.value = open;
  const index = treeRows.value.findIndex((row) => row.key === `${target.kind}:${target.id}`);
  treePage.value = Math.max(0, Math.floor(index / TREE_PAGE_SIZE));
}

function reportError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

function addChapter() {
  try { void reveal({ kind: "chapter", id: createQuestChapter(props.project).id }); }
  catch (error) { reportError(error); }
}

function addMain(chapterId: number | null = activeChapterId.value) {
  try { void reveal({ kind: "main", id: createQuestMain(props.project, chapterId).id }); }
  catch (error) { reportError(error); }
}

function addSub(mainId = selectedParentMain.value?.id) {
  if (mainId === undefined) { toast.warning("请先选择一个主任务，再添加子任务"); return; }
  try { void reveal({ kind: "sub", id: createQuestSub(props.project, mainId).id }); }
  catch (error) { reportError(error); }
}

function changeChapter(event: Event) {
  if (!selectedMain.value) return;
  const raw = (event.target as HTMLSelectElement).value;
  const chapterId = raw === "" ? null : Number(raw);
  if (chapterId !== null && !chaptersById.value.has(chapterId)) return;
  selectedMain.value.chapterId = chapterId;
  void reveal({ kind: "main", id: selectedMain.value.id });
}

function changeMain(event: Event) {
  if (!selectedSub.value) return;
  const mainId = Number((event.target as HTMLSelectElement).value);
  if (!mainsById.value.has(mainId)) return;
  selectedSub.value.mainQuestId = mainId;
  void reveal({ kind: "sub", id: selectedSub.value.id });
}

function updatePoint(value: unknown) {
  if (selectedSub.value && value && typeof value === "object" && !Array.isArray(value)) {
    selectedSub.value.investigationPoint = value as Record<string, unknown>;
  }
}

function updateRange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (selectedSub.value && Number.isFinite(input.valueAsNumber)) {
    selectedSub.value.investigationRange = input.valueAsNumber;
  }
}

function updateSubInteger(key: "failureQuestId" | "questProgress", event: Event, commit = false) {
  const sub = selectedSub.value;
  if (!sub) return;
  const input = event.target as HTMLInputElement;
  if (key === "failureQuestId" && input.value.trim() === "" && !input.validity?.badInput) {
    sub.failureQuestId = null;
    return;
  }
  const value = input.valueAsNumber;
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    if (commit) {
      toast.warning(`${key === "failureQuestId" ? "失败回溯任务 ID" : "任务进度"}必须是 Int32 整数`);
      input.value = String(sub[key] ?? "");
    }
    return;
  }
  sub[key] = value;
}

function addNextQuest() {
  const sub = selectedSub.value;
  const text = nextQuestIdInput.value.trim();
  const id = Number(text);
  if (!sub || sub.nextQuestIds.length >= 100) return;
  if (!/^[+-]?\d+$/.test(text) || !Number.isInteger(id) || id < -2147483648 || id > 2147483647) {
    toast.warning("请输入 Int32 范围内的后续任务 ID"); return;
  }
  sub.nextQuestIds.push(id);
  nextQuestIdInput.value = "";
}

function updateNextQuest(index: number, event: Event, commit = false) {
  const sub = selectedSub.value;
  const input = event.target as HTMLInputElement;
  const id = input.valueAsNumber;
  if (!sub || index < 0 || index >= sub.nextQuestIds.length) return;
  // 数字框在输入负号等中间态时也可能返回空字符串，不能误当作主动清空。
  if (input.value.trim() === "" && !input.validity?.badInput) {
    sub.nextQuestIds[index] = null;
    return;
  }
  if (!Number.isInteger(id) || id < -2147483648 || id > 2147483647) {
    if (commit) {
      toast.warning("后续任务 ID 必须是 Int32 整数");
      input.value = String(sub.nextQuestIds[index] ?? "");
    }
    return;
  }
  sub.nextQuestIds[index] = id;
}

function moveNextQuest(index: number, offset: number) {
  const ids = selectedSub.value?.nextQuestIds;
  const destination = index + offset;
  if (!ids || index < 0 || index >= ids.length || destination < 0 || destination >= ids.length) return;
  [ids[index], ids[destination]] = [ids[destination], ids[index]];
}

function removeNextQuest(index: number) {
  const ids = selectedSub.value?.nextQuestIds;
  if (ids && index >= 0 && index < ids.length) ids.splice(index, 1);
}

function removeSelected() {
  const target = selection.value;
  const item = selectedItem.value;
  if (!target || !item) return;
  let clearedReferenceCount = 0;
  if (target.kind === "chapter") {
    const count = props.project.mainQuests.filter((main) => main.chapterId === target.id).length;
    if (!confirm(`删除章节「${item.title}」？\n其下 ${count} 个主任务将移到“直属主任务”，主任务和子任务不会删除。`)) return;
    for (const main of props.project.mainQuests) if (main.chapterId === target.id) main.chapterId = null;
    props.project.chapters = props.project.chapters.filter((chapter) => chapter.id !== target.id);
    expanded.value = new Set([...expanded.value, "unassigned"]);
    selection.value = null;
  } else if (target.kind === "main") {
    const count = subGroups.value.get(target.id)?.length ?? 0;
    if (!confirm(`删除主任务「${item.title}」及其 ${count} 个子任务？\n此操作会同时移除这些任务的数据，其他子任务指向它们的后续任务和失败回溯引用将置空，后续任务列表保留位置。`)) return;
    const removedIds = new Set(props.project.subQuests.filter((sub) => sub.mainQuestId === target.id).map((sub) => sub.id));
    clearedReferenceCount = removeQuestSubQuests(props.project, removedIds).clearedReferenceCount;
    props.project.mainQuests = props.project.mainQuests.filter((main) => main.id !== target.id);
    selection.value = null;
  } else {
    if (!confirm(`删除子任务「${item.title}」（ID ${target.id}）？\n其他子任务指向它的后续任务和失败回溯引用将置空，后续任务列表保留位置。`)) return;
    const parentId = selectedSub.value?.mainQuestId;
    clearedReferenceCount = removeQuestSubQuests(props.project, new Set([target.id])).clearedReferenceCount;
    selection.value = parentId === undefined ? null : { kind: "main", id: parentId };
  }
  toast.success(`已删除${({ chapter: "章节", main: "主任务", sub: "子任务" })[target.kind]}${clearedReferenceCount ? `，已将 ${clearedReferenceCount} 项任务引用置空` : ""}`);
}

function changeSubPage(row: TreeRow, offset: number) {
  const page = Math.min((row.pageCount ?? 1) - 1, Math.max(0, (row.page ?? 0) + offset));
  subPages.value = { ...subPages.value, [row.id]: page };
}

function parentLabel(main: QuestMain) {
  const chapter = main.chapterId === null ? undefined : chaptersById.value.get(main.chapterId);
  return `${chapter?.title || "直属主任务"} / ${main.title || "未命名主任务"} #${main.id}`;
}
</script>

<template>
  <section class="quest-panel" aria-label="任务层级编辑器">
    <header class="quest-toolbar">
      <div>
        <strong>任务编排</strong>
        <span class="quest-counts">章节 {{ project.chapters.length }}/100 · 主任务 {{ project.mainQuests.length }}/100 · 子任务 {{ project.subQuests.length }}/10000</span>
      </div>
      <div class="toolbar-actions">
        <button type="button" :disabled="project.chapters.length >= 100" @click="addChapter">＋ 章节</button>
        <button type="button" :disabled="project.mainQuests.length >= 100" :title="activeChapterId === null ? '创建直属主任务' : '在当前章节创建主任务'" @click="addMain()">＋ 主任务</button>
        <button type="button" class="primary" :disabled="!selectedParentMain || project.subQuests.length >= 10000" @click="addSub()">＋ 子任务</button>
      </div>
    </header>

    <div class="quest-columns">
      <aside class="quest-browser" aria-label="任务层级">
        <div class="tree-search">
          <input v-model="search" type="search" aria-label="搜索任务" placeholder="搜索标题、描述或 ID" />
          <small v-if="search.trim()">搜索结果会展开匹配任务的父级</small>
        </div>
        <div class="tree-scroll">
          <p v-if="!visibleRows.length" class="tree-empty">没有匹配的章节或任务</p>
          <div v-for="row in visibleRows" :key="row.key" class="tree-row" :class="[row.kind, { selected: selection?.kind === row.kind && selection?.id === row.id }]" :style="{ '--tree-depth': row.depth }">
            <template v-if="row.kind === 'pagination'">
              <div class="sub-pagination">
                <button type="button" :disabled="row.page === 0" :aria-label="`${row.label} 上一页子任务`" @click="changeSubPage(row, -1)">‹</button>
                <span>{{ (row.page ?? 0) + 1 }}/{{ row.pageCount }} 页 · {{ row.count }} 项</span>
                <button type="button" :disabled="(row.page ?? 0) + 1 >= (row.pageCount ?? 1)" :aria-label="`${row.label} 下一页子任务`" @click="changeSubPage(row, 1)">›</button>
              </div>
            </template>
            <template v-else>
              <button v-if="row.kind !== 'sub'" type="button" class="fold-button" :aria-label="`${isOpen(row.key) ? '折叠' : '展开'}${row.label}`" :aria-expanded="isOpen(row.key)" :disabled="Boolean(search.trim())" @click="toggle(row.key)">{{ isOpen(row.key) ? '▾' : '▸' }}</button>
              <span v-else class="sub-dot">·</span>
              <button type="button" class="tree-item" :title="`${row.label}${row.id >= 0 ? ` · ID ${row.id}` : ''}`" :aria-current="selection?.kind === row.kind && selection?.id === row.id ? 'true' : undefined" @click="selectRow(row)">
                <span class="tree-kind">{{ row.kind === 'chapter' ? '章' : row.kind === 'sub' ? '子' : '主' }}</span>
                <span class="tree-title">{{ row.label }}</span>
                <small v-if="row.id >= 0">#{{ row.id }}</small>
                <span v-if="row.count !== undefined" class="tree-count">{{ row.count }}</span>
              </button>
              <button v-if="row.kind !== 'sub'" type="button" class="tree-add" :disabled="row.kind === 'main' ? project.subQuests.length >= 10000 : project.mainQuests.length >= 100" :aria-label="`在${row.label}下添加${row.kind === 'main' ? '子任务' : '主任务'}`" :title="row.kind === 'main' ? '添加子任务' : '添加主任务'" @click="row.kind === 'main' ? addSub(row.id) : addMain(row.kind === 'chapter' ? row.id : null)">＋</button>
            </template>
          </div>
          <div v-if="!project.chapters.length && !project.mainQuests.length && !search.trim()" class="tree-empty">
            <p>先创建章节，或直接创建主任务。</p>
            <button type="button" @click="addMain(null)">＋ 创建主任务</button>
          </div>
        </div>
        <footer v-if="treePageCount > 1" class="tree-pagination">
          <button type="button" :disabled="treePage === 0" @click="treePage--">上一页</button>
          <span>{{ treePage + 1 }} / {{ treePageCount }}</span>
          <button type="button" :disabled="treePage + 1 >= treePageCount" @click="treePage++">下一页</button>
        </footer>
        <p class="tree-footnote">ID 是稳定的任务标识，改名、移动归属不会改变 ID。子任务每 100 个 ID 分为一个字典桶。</p>
      </aside>

      <main class="quest-inspector" aria-label="任务属性">
        <template v-if="selectedItem">
          <header class="inspector-header">
            <div><span class="kind-badge">{{ selectedKindLabel }}</span><h2>{{ selectedItem.title || `未命名${selectedKindLabel}` }}</h2></div>
            <button type="button" class="danger" @click="removeSelected">删除{{ selectedKindLabel }}</button>
          </header>
          <div class="identity-strip">
            <span>ID <code>{{ selectedItem.id }}</code></span>
            <span v-if="selectedSub">字典桶 <code>{{ Math.floor(selectedSub.id / 100) }}</code> / 自身 ID <code>{{ selectedSub.id }}</code></span>
            <span v-else>只读 · 移动时保持不变</span>
          </div>
          <label class="quest-field"><span>{{ selectedKindLabel }}标题 <code>title</code></span><input v-model="selectedItem.title" :aria-label="`${selectedKindLabel}标题`" placeholder="填写标题" /></label>

          <template v-if="selectedChapter">
            <section class="inspector-info"><h3>章节内容</h3><p>包含 {{ project.mainQuests.filter(main => main.chapterId === selectedChapter?.id).length }} 个主任务。章节用于组织任务；删除章节时，下属任务会保留并移到直属主任务。</p><button type="button" :disabled="project.mainQuests.length >= 100" @click="addMain(selectedChapter.id)">＋ 在此章节创建主任务</button></section>
          </template>
          <template v-else-if="selectedMain">
            <label class="quest-field"><span>归属章节 <code>chapter</code></span><select :value="selectedMain.chapterId ?? ''" aria-label="归属章节" @change="changeChapter"><option value="">无章节 · 直属主任务</option><option v-for="chapter in project.chapters" :key="chapter.id" :value="chapter.id">{{ chapter.title || '未命名章节' }} #{{ chapter.id }}</option></select></label>
            <label class="quest-field"><span>主任务样式 <code>style</code></span><input v-model="selectedMain.style" type="text" aria-label="主任务样式" placeholder="Mainline" /><small>默认 Mainline，可填写自定义样式名称；保存和导出时保留原文。</small></label>
            <section class="inspector-info"><h3>子任务</h3><p>包含 {{ subGroups.get(selectedMain.id)?.length ?? 0 }} 个子任务。可通过左侧层级选择子任务并设置调查点、范围及其他参数。</p><button type="button" :disabled="project.subQuests.length >= 10000" @click="addSub(selectedMain.id)">＋ 在此主任务创建子任务</button></section>
          </template>
          <template v-else-if="selectedSub">
            <label class="quest-field"><span>归属主任务 <code>mainQuestId</code></span><select :value="selectedSub.mainQuestId" aria-label="归属主任务" @change="changeMain"><option v-for="main in project.mainQuests" :key="main.id" :value="main.id">{{ parentLabel(main) }}</option></select></label>
            <label class="quest-field"><span>任务描述 <code>desc</code></span><textarea v-model="selectedSub.description" aria-label="任务描述" rows="4" placeholder="填写任务描述" /></label>
            <label class="quest-field"><span>单位状态 <code>unitState · ConfigReference</code></span><input v-model="selectedSub.unitState" aria-label="单位状态" placeholder="填写配置引用" /><small>以字符串保存 ConfigReference。</small></label>
            <div class="position-editor"><ClipPropertyEditor :property="pointProperty" :model-value="selectedSub.investigationPoint" @update:model-value="updatePoint" /></div>
            <label class="quest-field"><span>调查范围 <code>investigationRange</code></span><input type="number" aria-label="调查范围" :value="selectedSub.investigationRange" step="any" @input="updateRange" /><small>保留结构体默认值 -1；可填写所需范围。</small></label>
            <label class="hidden-field"><input v-model="selectedSub.hidden" type="checkbox" /><span>隐藏任务 <code>hidden</code></span></label>
            <section class="next-quests" aria-label="后续任务">
              <header><h3>后续任务 <code>nextQuestIds · Int32List</code></h3><small>{{ selectedSub.nextQuestIds.length }}/100</small></header>
              <p>按列表顺序导出完整子任务 ID，不取余数；空列表表示没有后续任务。</p>
              <ol v-if="selectedSub.nextQuestIds.length">
                <li v-for="(id, index) in selectedSub.nextQuestIds" :key="index" :class="{ 'is-empty': id === null }">
                  <span class="next-quest-order">{{ index + 1 }}</span>
                  <input type="number" :value="id ?? ''" step="1" min="-2147483648" max="2147483647" placeholder="空引用" :aria-label="`后续任务 ${index + 1} ID`" @input="updateNextQuest(index, $event)" @change="updateNextQuest(index, $event, true)" />
                  <small v-if="id === null">空引用 · 导出为 -1</small>
                  <small v-else :title="subsById.get(id)?.title">{{ subsById.has(id) ? (subsById.get(id)?.title || '未命名子任务') : '当前文件未找到此 ID' }}</small>
                  <button type="button" :disabled="index === 0" :aria-label="`上移后续任务 ${index + 1}`" @click="moveNextQuest(index, -1)">↑</button>
                  <button type="button" :disabled="index === selectedSub.nextQuestIds.length - 1" :aria-label="`下移后续任务 ${index + 1}`" @click="moveNextQuest(index, 1)">↓</button>
                  <button type="button" :aria-label="`移除后续任务 ${index + 1}`" @click="removeNextQuest(index)">×</button>
                </li>
              </ol>
              <div class="next-quest-add">
                <input v-model="nextQuestIdInput" inputmode="numeric" aria-label="添加后续任务 ID" placeholder="填写后续任务 ID" :disabled="selectedSub.nextQuestIds.length >= 100" @keydown.enter.prevent="addNextQuest" />
                <button type="button" :disabled="selectedSub.nextQuestIds.length >= 100" @click="addNextQuest">＋ 添加</button>
              </div>
              <small>删除任务时，指向它的引用会置空并保留位置；可以重新填写 ID 或移除此项。导出时会警告空引用及当前文件中不存在的 ID。</small>
            </section>
            <label class="quest-field"><span>失败回溯任务 <code>失败回溯任务 · Int32</code></span>
              <input type="number" aria-label="失败回溯任务 ID" :value="selectedSub.failureQuestId ?? ''" step="1" min="-2147483648" max="2147483647" placeholder="空引用" @input="updateSubInteger('failureQuestId', $event)" @change="updateSubInteger('failureQuestId', $event, true)" />
              <small v-if="selectedSub.failureQuestId === null">空引用 · 导出为 -1 并警告；默认值为 -1。</small>
              <small v-else-if="selectedSub.failureQuestId === -1">默认 -1；可填写完整子任务 ID，跨字典时不取余数。</small>
              <small v-else>{{ subsById.has(selectedSub.failureQuestId) ? (subsById.get(selectedSub.failureQuestId)?.title || '未命名子任务') : '当前工作区未找到此子任务 ID，导出时将警告但保留原值。' }}</small>
            </label>
            <label class="hidden-field"><input v-model="selectedSub.finishMainQuest" type="checkbox" aria-label="完成主任务" /><span>完成主任务 <code>finishMainQuest</code></span></label>
            <label class="quest-field"><span>任务进度 <code>questProgress · Int32</code></span><input type="number" aria-label="任务进度" :value="selectedSub.questProgress" step="1" min="-2147483648" max="2147483647" @input="updateSubInteger('questProgress', $event)" @change="updateSubInteger('questProgress', $event, true)" /><small>默认 0，按填写的整数导出。</small></label>
            <p class="inspector-note">导出到任务配置数据的子任务字典，桶键为 {{ Math.floor(selectedSub.id / 100) }}；桶内是结构体列表，自身 ID 保留为 {{ selectedSub.id }}，不使用列表位置作为 ID。</p>
          </template>
        </template>
        <div v-else class="inspector-empty">
          <span class="empty-symbol">☷</span><h2>按层级组织任务</h2><p>章节 → 主任务 → 子任务<br />也可以跳过章节，直接创建主任务。</p>
          <div><button type="button" :disabled="project.chapters.length >= 100" @click="addChapter">＋ 创建章节</button><button type="button" class="primary" :disabled="project.mainQuests.length >= 100" @click="addMain(null)">＋ 创建主任务</button></div>
          <small>选择左侧条目编辑属性。任务配置自动保存在当前工作区，下载文件保留可编辑数据，结构体导出用于千星变量。</small>
        </div>
      </main>
    </div>
  </section>
</template>

<style scoped>
.quest-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: #334155; background: #f8fafc; font-size: 13px; }
button, input, textarea, select { font: inherit; }
button { border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; cursor: pointer; padding: 6px 10px; line-height: 1.4; }
button:hover:not(:disabled) { background: #eff6ff; border-color: #93b4e1; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
button:disabled { opacity: .45; cursor: default; }
button.primary { background: #2563eb; border-color: #2563eb; color: white; }
button.primary:hover:not(:disabled) { background: #1d4ed8; }
button.danger { color: #b91c1c; border-color: #fecaca; white-space: nowrap; }
button.danger:hover { background: #fef2f2; }
.quest-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #dbe3ed; background: #fff; }
.quest-toolbar > div:first-child { display: flex; flex-direction: column; gap: 4px; }
.quest-toolbar strong { font-size: 15px; color: #1e293b; }
.quest-counts { font-size: 11px; color: #64748b; }
.toolbar-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.quest-columns { display: grid; grid-template-columns: minmax(240px, 34%) minmax(0, 1fr); flex: 1; min-height: 0; }
.quest-browser { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #fff; border-right: 1px solid #dbe3ed; }
.tree-search { padding: 12px; border-bottom: 1px solid #eef2f7; }
.tree-search input, .quest-field > input, .quest-field > textarea, .quest-field > select { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #fff; color: #1e293b; }
.tree-search small { display: block; color: #64748b; margin-top: 6px; font-size: 11px; }
.tree-scroll { flex: 1; min-height: 0; overflow: auto; padding: 6px; }
.tree-row { display: flex; align-items: center; min-height: 36px; min-width: 0; padding-left: calc(var(--tree-depth) * 15px); border-radius: 6px; margin: 2px 0; }
.tree-row.selected { background: #e8f0fe; }
.tree-row.chapter, .tree-row.unassigned { margin-top: 7px; }
.tree-row:hover { background: #f1f5f9; }
.tree-row.selected:hover { background: #e0ebfe; }
.tree-row button { border: none; background: transparent; border-radius: 4px; }
.fold-button, .sub-dot { flex: 0 0 24px; text-align: center; color: #64748b; }
.fold-button { padding: 5px 0; }
.sub-dot { font-size: 20px; }
.tree-item { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; text-align: left; padding: 6px 2px; }
.tree-kind { flex-shrink: 0; color: #5273a0; font-size: 10px; padding: 1px 4px; background: #e8eef8; border-radius: 3px; }
.chapter .tree-kind { color: #8264a3; background: #f1ebf7; }
.sub .tree-kind { color: #4c856d; background: #e8f3ec; }
.tree-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.tree-item small { color: #94a3b8; font: 10px ui-monospace, monospace; }
.tree-count { font-size: 10px; color: #64748b; padding: 1px 4px; background: #f1f5f9; border-radius: 8px; }
.tree-add { flex: 0 0 28px; padding: 6px 0; color: #5273a0; }
.tree-empty { padding: 14px 8px; color: #94a3b8; font-size: 12px; line-height: 1.7; }
.tree-empty p { margin: 0 0 10px; }
.sub-pagination { display: flex; align-items: center; justify-content: center; flex: 1; gap: 7px; font-size: 10px; color: #64748b; }
.sub-pagination button { padding: 3px 10px; border: 1px solid #e2e8f0; }
.tree-pagination { display: flex; align-items: center; justify-content: space-between; gap: 5px; padding: 8px 12px; border-top: 1px solid #e2e8f0; font-size: 11px; }
.tree-footnote { margin: 0; padding: 10px 12px; font-size: 10px; line-height: 1.7; color: #94a3b8; border-top: 1px solid #eef2f7; }
.quest-inspector { overflow: auto; min-height: 0; min-width: 0; padding: 20px 24px 32px; }
.inspector-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.inspector-header > div { min-width: 0; }
.kind-badge { display: inline-block; font-size: 10px; color: #5273a0; background: #e8eef8; border-radius: 4px; padding: 3px 6px; }
.inspector-header h2 { margin: 8px 0 12px; color: #1e293b; font-size: 20px; line-height: 1.4; overflow-wrap: anywhere; }
.identity-strip { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 11px; color: #64748b; padding: 9px 11px; background: #eef2f7; border-radius: 6px; margin-bottom: 20px; }
code { color: #7a8ca2; font: 11px ui-monospace, monospace; }
.identity-strip code { color: #334155; margin-left: 4px; }
.quest-field { display: flex; flex-direction: column; gap: 7px; margin-top: 17px; }
.quest-field > span { color: #475569; font-size: 12px; }
.quest-field code, .hidden-field code { margin-left: 5px; }
.quest-field > textarea { min-height: 90px; resize: vertical; line-height: 1.6; }
.quest-field small { font-size: 11px; color: #94a3b8; }
.position-editor { margin-top: 20px; padding: 7px 12px 12px; background: #202937; border: 1px solid #39475b; border-radius: 8px; }
.position-editor :deep(.clip-property) { font-size: 12px; }
.position-editor :deep(code), .position-editor :deep(.field-description) { font-size: 10px; }
.position-editor :deep(input:not([type='checkbox'])), .position-editor :deep(select) { padding: 8px; }
.hidden-field { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
.hidden-field input { accent-color: #2563eb; }
.next-quests { margin-top: 22px; padding: 14px; border: 1px solid #dbe3ed; border-radius: 8px; background: #fff; }
.next-quests header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.next-quests h3 { margin: 0; font-size: 13px; }
.next-quests p, .next-quests small { color: #7b8ba1; font-size: 11px; line-height: 1.7; }
.next-quests ol { list-style: none; padding: 0; margin: 12px 0; }
.next-quests li { display: flex; align-items: center; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
.next-quest-order { width: 18px; color: #94a3b8; font-size: 11px; }
.next-quests input { box-sizing: border-box; min-width: 0; border: 1px solid #cbd5e1; border-radius: 5px; padding: 7px; background: #fff; color: #1e293b; font-size: 12px; }
.next-quests li input { width: 100px; }
.next-quests li small { flex: 1; min-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.next-quests li.is-empty input { border-color: #d9aa59; background: #fffbeb; }
.next-quests li.is-empty small { color: #a16b19; }
.next-quests li button { padding: 5px 7px; }
.next-quest-add { display: flex; gap: 8px; margin: 10px 0; }
.next-quest-add input { flex: 1; }
.inspector-note { color: #94a3b8; line-height: 1.7; font-size: 11px; margin-top: 20px; }
.inspector-info { border: 1px solid #dbe3ed; background: #fff; padding: 16px; border-radius: 8px; margin-top: 24px; }
.inspector-info h3 { margin: 0; font-size: 13px; color: #475569; }
.inspector-info p { font-size: 12px; line-height: 1.8; color: #64748b; margin: 10px 0 16px; }
.inspector-empty { max-width: 420px; margin: 50px auto; text-align: center; }
.empty-symbol { display: block; color: #b0c4df; font-size: 42px; }
.inspector-empty h2 { color: #475569; font-size: 18px; margin: 12px 0; }
.inspector-empty p { font-size: 13px; line-height: 1.9; color: #64748b; }
.inspector-empty > div { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin: 22px 0; }
.inspector-empty small { display: block; font-size: 11px; color: #94a3b8; line-height: 1.8; }
@media (max-width: 900px) {
  .quest-columns { grid-template-columns: minmax(210px, 40%) minmax(0, 1fr); }
  .quest-inspector { padding: 16px; }
  .inspector-header { flex-wrap: wrap; }
  .tree-row { padding-left: calc(var(--tree-depth) * 10px); }
}
</style>
