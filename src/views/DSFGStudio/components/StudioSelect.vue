<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  options: { id: string; label: string }[];
  label: string;
  showId?: boolean;
  compact?: boolean;
  placeholder?: string;
}>(), { showId: false, compact: false, placeholder: "未设置" });
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const open = ref(false);
const active = ref(0);
const position = ref({ left: "0px", top: "0px", width: "280px", maxHeight: "320px" });
const menuId = `studio-select-${crypto.randomUUID()}`;
const choices = computed(() => props.options.some(item => item.id === props.modelValue)
  ? props.options : [{ id: props.modelValue, label: props.modelValue || props.placeholder }, ...props.options]);
const selected = computed(() => choices.value.find(item => item.id === props.modelValue)!);
const selectedLabel = computed(() => !props.showId || selected.value.label === selected.value.id ? selected.value.label : `${selected.value.label}（${selected.value.id}）`);

async function show() {
  if (open.value || !trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const width = Math.min(Math.max(280, rect.width), window.innerWidth - 16);
  const below = window.innerHeight - rect.bottom - 16;
  const above = rect.top - 16;
  const upward = below < 240 && above > below;
  const height = Math.min(320, Math.max(0, upward ? above : below));
  position.value = { left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: `${upward ? Math.max(8, rect.top - height - 6) : rect.bottom + 6}px`, width: `${width}px`, maxHeight: `${height}px` };
  active.value = Math.max(0, choices.value.findIndex(item => item.id === props.modelValue));
  open.value = true;
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", close);
  await nextTick();
  if (upward && menu.value) position.value.top = `${Math.max(8, rect.top - menu.value.offsetHeight - 6)}px`;
  revealActive();
}
function close() {
  open.value = false;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", close);
}
function outside(event: PointerEvent) {
  const path = event.composedPath();
  if (!path.includes(trigger.value!) && !path.includes(menu.value!)) close();
}
function onScroll(event: Event) {
  if (!menu.value?.contains(event.target as Node)) close();
}
function revealActive() { menu.value?.querySelectorAll<HTMLElement>('[role="option"]')[active.value]?.scrollIntoView({ block: "nearest" }); }
function select(index: number) {
  const item = choices.value[index];
  if (!item) return;
  close();
  if (item.id !== props.modelValue) emit("update:modelValue", item.id);
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Tab") { close(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") { close(); return; }
  if (!open.value) { void show(); return; }
  if (event.key === "Enter" || event.key === " ") { select(active.value); return; }
  if (event.key === "Home") active.value = 0;
  else if (event.key === "End") active.value = choices.value.length - 1;
  else active.value = (active.value + (event.key === "ArrowDown" ? 1 : -1) + choices.value.length) % choices.value.length;
  revealActive();
}
watch(() => props.modelValue, close);
watch(() => props.options, close);
onBeforeUnmount(close);
</script>

<template>
  <span class="studio-select" :class="{ compact }">
    <button ref="trigger" type="button" class="style-trigger" :class="{ 'is-open': open }" role="combobox" :aria-label="label" aria-haspopup="listbox"
      :aria-expanded="open" :aria-controls="menuId" :aria-activedescendant="open ? `${menuId}-${active}` : undefined" :title="selectedLabel"
      @click.stop="open ? close() : show()" @keydown="keydown" @blur="close">
      <span>{{ selectedLabel }}</span>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Teleport to="body">
      <div v-if="open" :id="menuId" ref="menu" class="style-menu dsfg-typography" :style="position" role="listbox" :aria-label="`${label}列表`" @pointerdown.prevent.stop @click.stop @wheel.stop>
        <div v-for="(item, index) in choices" :id="`${menuId}-${index}`" :key="item.id" class="style-option" :class="{ 'is-selected': item.id === modelValue, 'is-active': index === active }"
          role="option" :aria-selected="item.id === modelValue" @pointermove="active = index" @click="select(index)">
          <span class="option-label"><strong>{{ item.label }}</strong><small v-if="showId && item.id && item.id !== item.label">{{ item.id }}</small></span>
          <svg v-if="item.id === modelValue" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.studio-select { display: block; min-width: 0; }
.style-trigger { display: flex; align-items: center; gap: 7px; box-sizing: border-box; width: 100%; min-width: 0; min-height: 36px; padding: 8px 10px; border: 1px solid #ded9f0; border-radius: 9px; background: #fff; color: #596780; font: inherit; font-size: 12px; cursor: pointer; }
.compact .style-trigger { min-height: 0; padding: 3px 5px; border-color: transparent; border-radius: 6px; background: transparent; color: #718097; font-size: 10px; }
.style-trigger > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.style-trigger:hover, .style-trigger.is-open, .compact .style-trigger:hover, .compact .style-trigger.is-open { border-color: #c6bdeb; background: #faf8ff; color: #6a5acd; }
.style-trigger:focus-visible { outline: 2px solid #887bd7; outline-offset: 2px; }
.style-trigger svg { width: 13px; height: 13px; transition: transform 150ms; }
.style-trigger.is-open svg { transform: rotate(180deg); }
svg { flex-shrink: 0; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.style-menu { position: fixed; z-index: 10000; box-sizing: border-box; padding: 7px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid #e9e5f7; border-radius: 13px; background: #fff; color: #555b70; box-shadow: 0 12px 36px #35276c29; scrollbar-width: thin; scrollbar-color: #d4cdee transparent; }
.style-option { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 12px; border-radius: 8px; text-align: left; cursor: pointer; }
.style-option.is-active { background: #f0edff; }
.style-option.is-selected { color: #6a5acd; }
.option-label { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.option-label strong { font-size: 13px; font-weight: 500; line-height: 1.5; }
.option-label small { color: #9290a5; font-size: 11px; line-height: 1.4; }
.style-option svg { width: 17px; height: 17px; }
@media (prefers-reduced-motion: reduce) { .style-trigger svg { transition: none; } }
</style>
