<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import StudioIcon from "./StudioIcon.vue";
const props = defineProps<{ values: string[]; selectedValue: string; disabled?: boolean }>();
const emit = defineEmits<{ select: [value: string]; add: []; delete: [] }>();
const search = ref("");
const fileList = ref<HTMLElement>();
const visibleFiles = computed(() => props.values.filter(name => name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
function closeFileMenuOutside(event: PointerEvent) {
  const menu = fileList.value?.querySelector<HTMLDetailsElement>(".studio-file-menu[open]");
  if (menu && !event.composedPath().includes(menu)) menu.open = false;
}
onMounted(() => document.addEventListener("pointerdown", closeFileMenuOutside, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeFileMenuOutside, true));
function remove(event: Event) {
  (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  emit("delete");
}
</script>

<template>
  <div ref="fileList" class="studio-file-list" :inert="disabled">
    <label class="studio-file-search"><StudioIcon name="search" /><input v-model="search" type="search" placeholder="搜索文件…" aria-label="搜索文件" /></label>
    <div class="studio-file-items" aria-label="文件列表">
      <div v-for="file in visibleFiles" :key="file" class="studio-file-row" :class="{ selected: selectedValue === file }">
        <button type="button" class="studio-file-select" :aria-pressed="selectedValue === file" :title="file" @click="emit('select', file)"><StudioIcon name="file" /><span>{{ file }}</span></button>
        <details v-if="selectedValue === file" class="studio-file-menu"><summary :aria-label="`${file} 的操作`"><StudioIcon name="more" /></summary><div><button type="button" @click="remove"><StudioIcon name="trash" :size="15" />删除文件</button></div></details>
      </div>
      <p v-if="!visibleFiles.length" class="studio-sidebar-hint">{{ search.trim() ? '没有匹配的文件' : '还没有文件，创建一份开始编辑。' }}</p>
    </div>
    <div class="studio-file-actions"><button type="button" @click="emit('add')"><StudioIcon name="plus" :size="16" />新建文件</button><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.studio-file-list { display: flex; flex-direction: column; min-height: 0; gap: 14px; }
.studio-file-search { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; border: 1px solid #ced3f3; border-radius: 8px; background: #ffffffc9; color: #8b9cc5; }
.studio-file-search input { min-width: 0; width: 100%; padding: 9px 0; border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 400; color: #344672; }
.studio-file-search:focus-within { outline: 2px solid #5aaeff66; }
.studio-file-items { display: grid; align-content: start; gap: 5px; }
.studio-file-row { position: relative; display: flex; align-items: center; border-radius: 8px; }
.studio-file-row:hover { background: #ffffff9c; }
.studio-file-row.selected { background: linear-gradient(100deg, #b9deffb0, #c9eeff80); }
.studio-file-select { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 11px 10px; border: 0; background: transparent; color: #35446b; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.studio-file-select svg { flex-shrink: 0; }
.studio-file-select span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected .studio-file-select { color: #0788e8; }
.studio-file-menu { margin-right: 5px; }
.studio-file-menu summary { display: grid; place-items: center; width: 28px; height: 30px; border-radius: 5px; list-style: none; cursor: pointer; color: #5475a8; }
.studio-file-menu summary::-webkit-details-marker { display: none; }
.studio-file-menu summary:hover { background: #ffffffad; }
.studio-file-menu > div { position: absolute; z-index: 20; right: 4px; top: calc(100% - 2px); min-width: 126px; padding: 5px; border: 1px solid #d7dbed; border-radius: 8px; background: #fff; box-shadow: 0 8px 24px #35487418; }
.studio-file-menu button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px; color: #af5262; border: 0; background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.studio-file-menu button:hover { background: #fff0f2; }
.studio-file-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 14px; border-top: 1px solid #cfd7ef88; }
.studio-file-actions > button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid #ced3f3; border-radius: 7px; background: #ffffffb3; color: #42659b; font: inherit; font-size: 12px; cursor: pointer; }
.studio-sidebar-hint { margin: 8px 2px; color: #8593b1; font-size: 12px; line-height: 1.8; }
button:focus-visible, summary:focus-visible { outline: 2px solid #52a5fa; outline-offset: 2px; }
</style>
