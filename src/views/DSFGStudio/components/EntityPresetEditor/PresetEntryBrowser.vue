<script lang="ts">
export interface PresetBrowserEntry {
  id: string;
  label: string;
  detail?: string;
  system: boolean;
}
export interface PresetBrowserGroup {
  key: string;
  title: string;
  entries: PresetBrowserEntry[];
}
export interface PresetBrowserSelection { category: string; id: string }
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  groups: PresetBrowserGroup[];
  activeCategory: string;
  selectedEntry?: PresetBrowserSelection;
  collapsed: boolean;
}>();
const emit = defineEmits<{
  select: [category: string, id: string];
}>();
const query = ref("");
const search = computed(() => query.value.trim().toLocaleLowerCase());
const activeGroup = computed(() => props.groups.find(group => group.key === props.activeCategory));
const filteredEntries = computed(() => (activeGroup.value?.entries ?? []).filter(entry => !search.value
    || entry.label.toLocaleLowerCase().includes(search.value)
    || entry.detail?.toLocaleLowerCase().includes(search.value)));
const entrySections = computed(() => [
  { key: "system", title: "系统默认", entries: filteredEntries.value.filter(entry => entry.system) },
  { key: "custom", title: "自定义", entries: filteredEntries.value.filter(entry => !entry.system) },
].filter(section => section.entries.length > 0));
watch(() => props.activeCategory, () => { query.value = ""; });
const isSelected = (category: string, id: string) => props.selectedEntry?.category === category && props.selectedEntry.id === id;
</script>

<template>
  <aside v-show="!collapsed" class="preset-entry-browser" aria-label="预设词条浏览">
    <div class="browser-body">
      <div class="browser-search">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.3 12.3 4.2 4.2" /></svg>
        <input v-model="query" type="search" aria-label="搜索词条或代号" placeholder="搜索代号" />
      </div>
      <div class="browser-groups">
        <section v-for="section in entrySections" :key="section.key" class="browser-group" :aria-label="section.title">
          <h4 class="group-title">{{ section.title }}</h4>
          <div class="group-entries">
            <button v-for="entry in section.entries" :key="entry.id" type="button" class="entry-button" :title="entry.label || '未命名词条'" :aria-current="isSelected(activeCategory, entry.id) ? 'true' : undefined" @click="emit('select', activeCategory, entry.id)">
              <span class="entry-label">{{ entry.label || '未命名词条' }}</span>
            </button>
          </div>
        </section>
        <p v-if="!filteredEntries.length" class="browser-empty" role="status">{{ search ? '未找到匹配的词条或代号。' : '暂无可浏览的词条。' }}</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.preset-entry-browser { display: flex; flex-direction: column; grid-column: 1; grid-row: 2; min-height: 0; min-width: 0; padding-top: 8px; color: #42516d; background: transparent; box-sizing: border-box; }
svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.browser-body { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.browser-search { display: flex; align-items: center; gap: 7px; margin: 0 14px 8px 10px; padding: 0 9px; min-width: 0; border: 1px solid #d5dcef; border-radius: 7px; background: #ffffffb8; color: #8a9bb1; }
.browser-search:focus-within { border-color: #9abdeb; outline: 2px solid #d6e7fc; }
.browser-search svg { flex-shrink: 0; }
.browser-search input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px 0; border: 0; outline: 0; color: #42516d; background: transparent; font: inherit; font-size: 12px; }
.browser-search input::placeholder { color: #94a0b1; }
.browser-groups { min-height: 0; flex: 1; overflow-y: auto; padding: 0 10px 12px; scrollbar-width: thin; scrollbar-color: #cdd6e5 transparent; }
.browser-group { margin: 0 0 8px; }
.group-title { margin: 0; padding: 9px 8px 5px; color: #8e98b0; font-size: 11px; font-weight: 400; }
.group-entries { display: grid; gap: 2px; }
.entry-button { display: flex; align-items: center; width: 100%; min-width: 0; padding: 9px 8px; border: 0; border-radius: 5px; color: #4d617e; background: transparent; text-align: left; cursor: pointer; font: inherit; }
.entry-button:hover { color: #315f98; background: #ffffff73; }
.entry-button[aria-current='true'] { color: #245aa2; background: #e6efff; box-shadow: inset 2px 0 #45a5ef; }
.entry-label { min-width: 0; font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.browser-empty { margin: 10px 8px; color: #94a0b1; font-size: 12px; line-height: 1.7; }
.entry-button:focus-visible { outline: 2px solid #91b9ed; outline-offset: 2px; }
</style>
