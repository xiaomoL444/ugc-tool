<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { StorageClass } from "@/services/storage/storage";
import { ProjectID } from "../../constant/constant";
import { SCENE_FILE, createSceneProject, decodeSceneProject, type SceneWorld } from "../SceneEditor/sceneProject";

const props = defineProps<{ modelValue: number }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const storage = inject<StorageClass>("storage")!;
const workspace = inject<Ref<string>>("selectedWorkspaceId")!.value;
const file = `/${workspace}/${SCENE_FILE}`;
const worlds = ref<SceneWorld[]>([]);
const busy = ref(false);
const error = ref("");
let disposed = false;
const options = computed(() => {
  const valid = worlds.value.filter(world => /^[+-]?\d+$/.test(world.id.trim())
    && Number(world.id) >= -2147483648 && Number(world.id) <= 2147483647);
  const counts = new Map<number, number>();
  for (const world of valid) counts.set(Number(world.id), (counts.get(Number(world.id)) ?? 0) + 1);
  return valid.filter(world => counts.get(Number(world.id)) === 1)
    .map(world => ({ id: Number(world.id), name: world.name || "未命名世界" }));
});
const currentExists = computed(() => options.value.some(world => world.id === props.modelValue));
const hasInvalidWorlds = computed(() => options.value.length !== worlds.value.length);

async function load() {
  if (busy.value || disposed) return;
  busy.value = true;
  error.value = "";
  try {
    const exists = await storage.setProject(ProjectID).exists(file);
    if (disposed) return;
    // 与场景编辑器首次打开时使用相同默认数据；此处只读，不创建或覆盖场景文件。
    const scene = exists ? decodeSceneProject(await storage.setProject(ProjectID).readFile(file)) : createSceneProject();
    if (!disposed) worlds.value = scene.worlds;
  } catch (reason) {
    if (!disposed) error.value = reason instanceof Error ? reason.message : "无法读取场景世界列表";
  } finally { if (!disposed) busy.value = false; }
}
function selectWorld(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (!busy.value && !error.value && options.value.some(world => world.id === value)) emit("update:modelValue", value);
}
onMounted(load);
onBeforeUnmount(() => { disposed = true; });
</script>

<template>
  <div class="world-select">
    <div class="world-select-row">
      <select :value="modelValue" aria-label="所属世界" :disabled="busy || Boolean(error) || !options.length" @change="selectWorld">
        <option v-if="!currentExists" :value="modelValue" disabled>{{ busy ? '正在读取世界' : error ? '当前世界' : '未匹配世界' }} · #{{ modelValue }}</option>
        <option v-for="world in options" :key="world.id" :value="world.id">{{ world.name }} · #{{ world.id }}</option>
      </select>
      <button type="button" :disabled="busy" aria-label="刷新世界列表" @click="load">{{ busy ? '读取中…' : '刷新' }}</button>
    </div>
    <small v-if="error" class="world-warning" role="alert">{{ error }}；当前编号已保留，可刷新重试。</small>
    <template v-else-if="!busy">
      <small v-if="!worlds.length">场景中还没有世界，请先在“场景”中创建，再刷新列表。</small>
      <small v-else-if="!currentExists" class="world-warning">当前编号 #{{ modelValue }} 未关联有效世界，请选择所属世界。</small>
      <small v-else>关联当前工作区“场景”中的世界。</small>
      <small v-if="hasInvalidWorlds" class="world-warning">部分世界 ID 无效或重复，请在“场景”中修正后刷新。</small>
    </template>
  </div>
</template>

<style scoped>
.world-select { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.world-select-row { display: flex; gap: 6px; min-width: 0; }
select, button { font: inherit; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; padding: 8px 10px; }
select { flex: 1; width: 0; min-width: 0; }
button { flex-shrink: 0; cursor: pointer; }
button:hover:not(:disabled) { background: #eff6ff; border-color: #93b4e1; }
select:focus-visible, button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
:disabled { opacity: .6; cursor: default; }
small { color: #64748b; font-size: 11px; line-height: 1.6; }
.world-warning { color: #a16207; }
</style>
