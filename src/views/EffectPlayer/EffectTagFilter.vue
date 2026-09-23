<template>
  <div class="tag-filter">
    <div class="filter-bar">
      <button class="filter-trigger" type="button" :disabled="!groups.length" @click="openFilter">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
        {{ t('effectPlayer.filter.open') }}
        <span v-if="modelValue.length" class="selection-badge">{{ modelValue.length }}</span>
      </button>
      <span v-if="!modelValue.length" class="filter-hint">{{ t('effectPlayer.filter.hint') }}</span>
      <span v-else class="filter-hint">{{ t('effectPlayer.filter.selectionSummary', { groups: selectedGroups.length, tags: modelValue.length }) }}</span>
      <button v-if="modelValue.length" class="clear-selection" type="button" @click="emit('update:modelValue', [])">
        {{ t('effectPlayer.filter.clear') }}
      </button>
    </div>
    <div v-if="modelValue.length" class="selected-groups" :aria-label="t('effectPlayer.filter.selected')">
      <div v-for="group in selectedGroups" :key="group.id" class="selected-group">
        <span class="selected-group-name">{{ group.name }}</span>
        <button
          v-for="tag in group.tags"
          :key="tag.id"
          class="selected-tag"
          type="button"
          :aria-label="t('effectPlayer.filter.removeTag', { group: group.name, tag: tag.name })"
          @click="emit('update:modelValue', modelValue.filter((id) => id !== tag.id))"
        >
          {{ tag.name }} <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <dialog ref="dialog" class="filter-dialog" aria-labelledby="effect-filter-title" @click.self="closeFilter" @close="isOpen = false">
      <div v-if="isOpen" class="filter-panel">
        <header class="filter-header">
          <h2 id="effect-filter-title">{{ t('effectPlayer.filter.title') }}</h2>
          <button class="filter-close" type="button" :aria-label="t('effectPlayer.filter.close')" autofocus @click="closeFilter">×</button>
        </header>
        <p class="filter-description">{{ t('effectPlayer.filter.description') }}</p>
        <div class="filter-groups">
          <details v-for="group in groups" :key="group.id" class="filter-group" open>
            <summary>
              <span>{{ group.name }}</span>
              <span v-if="selectedCount(group)" class="group-selected-count">{{ t('effectPlayer.filter.selectedCount', { count: selectedCount(group) }) }}</span>
            </summary>
            <div class="group-tags">
              <button
                class="filter-chip select-all"
                :class="{ active: isGroupSelected(group) }"
                type="button"
                :aria-label="t('effectPlayer.filter.selectGroup', { group: group.name })"
                :aria-pressed="isGroupSelected(group)"
                @click="toggleGroup(group)"
              >
                {{ t('effectPlayer.filter.selectAll') }} <span class="chip-count">{{ counts.groupCounts.get(group.id) ?? 0 }}</span>
              </button>
              <button
                v-for="tag in group.tags"
                :key="tag.id"
                class="filter-chip"
                :class="{ active: draftTagIds.includes(tag.id), empty: !counts.tagCounts.get(tag.id) }"
                type="button"
                :aria-pressed="draftTagIds.includes(tag.id)"
                @click="toggleDraftTag(tag.id)"
              >
                {{ tag.name }} <span class="chip-count">{{ counts.tagCounts.get(tag.id) ?? 0 }}</span>
              </button>
            </div>
          </details>
        </div>
        <footer class="filter-footer">
          <div class="filter-result" aria-live="polite">
            <I18nT keypath="effectPlayer.filter.matchCount" :plural="previewCount" scope="global">
              <template #count><strong>{{ previewCount }}</strong></template>
            </I18nT>
            <span v-if="draftTagIds.length"> · {{ t('effectPlayer.filter.selectedTagCount', { count: draftTagIds.length }, draftTagIds.length) }}</span>
          </div>
          <div class="filter-actions">
            <button class="filter-reset" type="button" @click="draftTagIds = []">{{ t('effectPlayer.filter.clear') }}</button>
            <button class="filter-apply" type="button" @click="applyFilter">{{ t('effectPlayer.filter.apply') }}</button>
          </div>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Translation as I18nT, useI18n } from "vue-i18n";
import { countEffectTags, matchesEffectTagGroups } from "./tagFilters";
import type { EffectTagGroup } from "./tagFilters";
import type { EffectItem } from "./types/EffectData";

const { t } = useI18n({ useScope: "global" });
const props = defineProps<{
  modelValue: number[];
  groups: EffectTagGroup[];
  items: EffectItem[];
}>();
const emit = defineEmits<{ (event: "update:modelValue", value: number[]): void }>();
const dialog = ref<HTMLDialogElement | null>(null);
const isOpen = ref(false);
const draftTagIds = ref<number[]>([]);
const selectedGroups = computed(() => props.groups
  .map((group) => ({ ...group, tags: group.tags.filter((tag) => props.modelValue.includes(tag.id)) }))
  .filter((group) => group.tags.length));
const counts = computed(() => countEffectTags(props.items, props.groups));
const previewCount = computed(() => props.items.filter((item) =>
  matchesEffectTagGroups(item, draftTagIds.value, props.groups),
).length);

function selectedCount(group: EffectTagGroup) {
  return group.tags.filter((tag) => draftTagIds.value.includes(tag.id)).length;
}

function isGroupSelected(group: EffectTagGroup) {
  return group.tags.length > 0 && selectedCount(group) === group.tags.length;
}

function toggleDraftTag(tagId: number) {
  draftTagIds.value = draftTagIds.value.includes(tagId)
    ? draftTagIds.value.filter((id) => id !== tagId)
    : [...draftTagIds.value, tagId];
}

function toggleGroup(group: EffectTagGroup) {
  const remaining = draftTagIds.value.filter((id) => !group.tags.some((tag) => tag.id === id));
  draftTagIds.value = isGroupSelected(group)
    ? remaining
    : [...remaining, ...group.tags.map((tag) => tag.id)];
}

async function openFilter() {
  draftTagIds.value = [...props.modelValue];
  isOpen.value = true;
  await nextTick();
  dialog.value?.showModal();
}

function closeFilter() {
  dialog.value?.close();
}

function applyFilter() {
  emit("update:modelValue", [...draftTagIds.value]);
  closeFilter();
}
</script>

<style scoped>
.filter-bar,
.filter-trigger,
.selected-group,
.filter-header,
.filter-group summary,
.filter-chip {
  display: flex;
  align-items: center;
}

.filter-bar { gap: 12px; flex-wrap: wrap; }
.filter-trigger {
  gap: 7px;
  padding: 7px 12px;
  border: 1px solid rgba(106, 90, 205, 0.3);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  color: #35476b;
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}
.filter-trigger:hover { border-color: #0ea2e5; }
.filter-trigger:disabled { cursor: default; opacity: 0.5; }
.filter-trigger svg { width: 18px; height: 18px; }
.selection-badge {
  min-width: 18px;
  padding: 1px 4px;
  border-radius: 6px;
  background: #e1ecff;
  color: #305da4;
  font-size: 0.75rem;
}
.filter-hint { color: #6a7385; font-size: 0.8rem; text-align: left; }
.clear-selection {
  margin-left: auto;
  padding: 4px 0;
  border: 0;
  background: none;
  color: #546a9e;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.selected-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  max-height: 76px;
  margin-top: 10px;
  overflow-y: auto;
}
.selected-group { flex-wrap: wrap; gap: 5px; }
.selected-group-name { color: #69758c; font-size: 0.75rem; margin-right: 2px; }
.selected-tag {
  padding: 3px 8px;
  border: 1px solid rgba(14, 162, 229, 0.22);
  border-radius: 999px;
  background: #e4effb;
  color: #315882;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.selected-tag span { margin-left: 4px; }
.filter-dialog {
  width: min(880px, calc(100vw - 32px));
  max-width: none;
  max-height: calc(100dvh - 40px);
  padding: 0;
  border: 1px solid #414655;
  border-radius: 14px;
  background: #282c3a;
  color: #f2f4fa;
  font-family: StarRailFont, Avenir, Helvetica, Arial, sans-serif;
  box-shadow: 0 24px 90px #080b184d;
  overflow: hidden;
}
.filter-dialog::backdrop { background: #0a1025a6; backdrop-filter: blur(4px); }
.filter-panel { display: flex; flex-direction: column; max-height: min(760px, calc(100dvh - 42px)); }
.filter-header { justify-content: space-between; padding: 14px 24px; background: #20232e; }
.filter-header h2 { margin: 0; font-size: 1.1rem; font-weight: 500; }
.filter-close {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: #c3c8d7;
  font-size: 1.9rem;
  line-height: 1;
  cursor: pointer;
}
.filter-close:hover { color: white; background: #ffffff12; }
.filter-description { margin: 0; padding: 14px 24px 10px; color: #aeb7cd; font-size: 0.8rem; }
.filter-groups { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 20px 12px; scrollbar-color: #646b80 transparent; scrollbar-width: thin; }
.filter-group { margin: 6px 0; }
.filter-group summary {
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #222634;
  font-size: 0.95rem;
  cursor: pointer;
  list-style: none;
}
.filter-group summary::-webkit-details-marker { display: none; }
.filter-group summary::before {
  content: "";
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 6px solid #b6bdce;
  transition: transform 0.15s ease;
}
.filter-group[open] summary::before { transform: rotate(90deg); }
.group-selected-count { margin-left: auto; color: #a8c4ff; font-size: 0.75rem; }
.group-tags { display: flex; flex-wrap: wrap; gap: 10px; padding: 14px 12px 12px; }
.filter-chip {
  gap: 10px;
  min-height: 34px;
  padding: 5px 12px;
  border: 1.5px solid #6b7181;
  border-radius: 999px;
  background: transparent;
  color: #ecedf5;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.chip-count { color: #b1b6c6; font-variant-numeric: tabular-nums; }
.filter-chip:hover { border-color: #adc2ff; background: #ffffff08; }
.filter-chip.empty { color: #939aad; }
.filter-chip.active { background: #4d79ef; border-color: #7299ff; color: white; }
.filter-chip.active .chip-count { color: #eef3ff; }
.select-all { font-weight: 600; }
.filter-footer { padding: 12px 32px 22px; border-top: 1px solid #ffffff0f; background: #2a2e3d; }
.filter-result { margin-bottom: 12px; color: #abb4c9; font-size: 0.8rem; text-align: center; }
.filter-result strong { color: #e3eaff; font-weight: 500; }
.filter-actions { display: flex; justify-content: center; gap: 20px; }
.filter-actions button { flex: 1; max-width: 320px; padding: 11px 16px; border-radius: 999px; font: inherit; font-size: 0.95rem; cursor: pointer; }
.filter-reset { border: 1.5px solid #72798c; background: transparent; color: #eceef7; }
.filter-reset:hover { background: #ffffff08; }
.filter-apply { border: 1.5px solid #4e7eff; background: #4e7eff; color: white; }
.filter-apply:hover { background: #638dff; }
button:focus-visible, summary:focus-visible { outline: 2px solid #90baff; outline-offset: 3px; }
@media (max-width: 600px) {
  .filter-bar { gap: 8px; }
  .filter-hint { flex: 1; font-size: 0.75rem; }
  .filter-dialog { width: calc(100vw - 20px); max-height: calc(100dvh - 24px); }
  .filter-panel { max-height: calc(100dvh - 26px); }
  .filter-header { padding: 12px 16px; }
  .filter-description { padding: 12px 16px 8px; font-size: 0.72rem; }
  .filter-groups { padding: 0 10px 8px; }
  .group-tags { gap: 8px; padding: 12px 6px; }
  .filter-chip { font-size: 0.8rem; gap: 8px; padding: 5px 10px; }
  .filter-footer { padding: 12px 16px 16px; }
  .filter-actions { gap: 12px; }
}
</style>
