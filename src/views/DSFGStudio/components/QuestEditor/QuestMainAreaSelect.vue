<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { SCENE_FILE, createSceneProject, decodeSceneProject, type SceneMainArea } from "../SceneEditor/sceneProject";

const props = defineProps<{ modelValue: number }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const storage = inject<StorageClass>("storage")!;
const workspace = inject<Ref<string>>("selectedWorkspaceId")!.value;
const file = `/${workspace}/${SCENE_FILE}`;
const mainAreas = ref<SceneMainArea[]>([]);
const busy = ref(false);
const error = ref("");
let disposed = false;
const options = computed(() => {
  const valid = mainAreas.value.filter(area => /^[+-]?\d+$/.test(area.id.trim())
    && Number(area.id) >= -2147483648 && Number(area.id) <= 2147483647);
  const counts = new Map<number, number>();
  for (const area of valid) counts.set(Number(area.id), (counts.get(Number(area.id)) ?? 0) + 1);
  return valid.filter(area => counts.get(Number(area.id)) === 1)
    .map(area => ({ id: Number(area.id), name: area.name || "未命名一级区域" }));
});
const currentExists = computed(() => options.value.some(area => area.id === props.modelValue));
const hasInvalidAreas = computed(() => options.value.length !== mainAreas.value.length);

async function load() {
  if (busy.value || disposed) return;
  busy.value = true;
  error.value = "";
  try {
    const exists = await storage.setProject(ProjectID).exists(file);
    if (disposed) return;
    // 与场景编辑器首次打开时使用相同默认数据；此处只读，不创建或覆盖场景文件。
    const scene = exists ? decodeSceneProject(await storage.setProject(ProjectID).readFile(file)) : createSceneProject();
    if (!disposed) mainAreas.value = scene.mainAreas;
  } catch (reason) {
    if (!disposed) error.value = reason instanceof Error ? reason.message : "无法读取一级区域列表";
  } finally { if (!disposed) busy.value = false; }
}
function selectMainArea(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (!busy.value && !error.value && options.value.some(area => area.id === value)) emit("update:modelValue", value);
}
onMounted(load);
onBeforeUnmount(() => { disposed = true; });
</script>

<template>
  <div class="area-select">
    <div class="area-select-row">
      <select :value="modelValue" aria-label="所属一级区域" :disabled="busy || Boolean(error) || !options.length" @change="selectMainArea">
        <option v-if="!currentExists" :value="modelValue" disabled>{{ busy ? '正在读取一级区域' : error ? '当前一级区域' : '未匹配一级区域' }} · #{{ modelValue }}</option>
        <option v-for="area in options" :key="area.id" :value="area.id">{{ area.name }} · #{{ area.id }}</option>
      </select>
      <button type="button" :disabled="busy" aria-label="刷新一级区域列表" @click="load">{{ busy ? '读取中…' : '刷新' }}</button>
    </div>
    <small v-if="error" class="area-warning" role="alert">{{ error }}；当前编号已保留，可刷新重试。</small>
    <template v-else-if="!busy">
      <small v-if="!mainAreas.length">场景中还没有一级区域，请先在“场景”中创建，再刷新列表。</small>
      <small v-else-if="!currentExists" class="area-warning">当前编号 #{{ modelValue }} 未关联有效一级区域，请选择所属一级区域。</small>
      <small v-else>关联当前工作区“场景”中的一级区域。</small>
      <small>旧存档若关联的是世界，请重新确认一级区域；不会自动转换编号。</small>
      <small v-if="hasInvalidAreas" class="area-warning">部分一级区域 ID 无效或重复，请在“场景”中修正后刷新。</small>
    </template>
  </div>
</template>

<style scoped>
.area-select { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.area-select-row { display: flex; gap: 6px; min-width: 0; }
select, button { font: inherit; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; padding: 8px 10px; }
select { flex: 1; width: 0; min-width: 0; }
button { flex-shrink: 0; cursor: pointer; }
button:hover:not(:disabled) { background: #eff6ff; border-color: #93b4e1; }
select:focus-visible, button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
:disabled { opacity: .6; cursor: default; }
small { color: #64748b; font-size: 11px; line-height: 1.6; }
.area-warning { color: #a16207; }
</style>
