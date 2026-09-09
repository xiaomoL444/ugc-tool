<template>
  <button
    ref="trigger"
    class="preview-preset-trigger"
    type="button"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="menuId"
    :aria-label="`预览设备与画布比例：${currentGroup?.label ?? ''} ${currentPreset?.ratio ?? ''}`"
    :title="currentPreset ? `${currentGroup?.label} · ${currentPreset.width} × ${currentPreset.height}` : '预览设备与画布比例'"
    @click="toggleMenu"
    @keydown="handleTriggerKeydown"
  >
    <DevicePreviewIcon :mode="deviceId" :size="21" />
    <span>{{ currentPreset?.ratio ?? '选择比例' }}</span>
    <svg class="preview-preset-chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 5 5-5Z" fill="currentColor" /></svg>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      class="preview-preset-menu"
      :style="menuStyle"
      role="listbox"
      aria-label="预览设备与画布比例"
      :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
      tabindex="-1"
      @contextmenu.prevent
      @keydown.stop="handleMenuKeydown"
    >
      <div v-for="group in menuGroups" :key="group.id" class="preview-preset-group" role="group" :aria-label="group.label">
        <div
          v-for="option in group.options"
          :id="optionId(option.index)"
          :key="option.id"
          class="preview-preset-option"
          :class="{ selected: presetId === option.id, highlighted: activeIndex === option.index }"
          role="option"
          :aria-selected="presetId === option.id"
          :aria-label="`${group.label} ${option.ratio}`"
          :title="`${group.label} · ${option.width} × ${option.height}`"
          @pointermove="activeIndex = option.index"
          @click="selectOption(option.id)"
        >
          <DevicePreviewIcon :mode="group.id" :size="24" />
          <span>{{ option.ratio }}</span>
          <svg v-if="presetId === option.id" class="preview-preset-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue';
import DevicePreviewIcon from './DevicePreviewIcon.vue';

interface PreviewPreset { id: string; ratio: string; width: number; height: number }
interface PreviewGroup { id: string; label: string; presets: PreviewPreset[] }

const props = defineProps<{ groups: PreviewGroup[]; deviceId: string; presetId: string }>();
const emit = defineEmits<{ select: [presetId: string] }>();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const menuStyle = ref<CSSProperties>({});
const menuId = `preview-presets-${getCurrentInstance()?.uid ?? 0}`;
const optionId = (index: number) => `${menuId}-option-${index}`;
const currentGroup = computed(() => props.groups.find((group) => group.id === props.deviceId));
const currentPreset = computed(() => currentGroup.value?.presets.find((preset) => preset.id === props.presetId) ?? currentGroup.value?.presets[0]);
const menuGroups = computed(() => {
  let index = 0;
  return props.groups.map((group) => ({ ...group, options: group.presets.map((preset) => ({ ...preset, index: index++ })) }));
});
const options = computed(() => menuGroups.value.flatMap((group) => group.options));

function positionMenu() {
  if (!open.value || !trigger.value) return;
  const bounds = trigger.value.getBoundingClientRect();
  const margin = 8;
  const gap = 2;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const width = Math.min(Math.max(bounds.width, 224), Math.max(0, viewportWidth - margin * 2));
  const fullHeight = options.value.length * 36 + Math.max(0, props.groups.length - 1) * 7 + 10;
  const below = Math.max(0, viewportHeight - bounds.bottom - gap - margin);
  const above = Math.max(0, bounds.top - gap - margin);
  const placeAbove = below < Math.min(fullHeight, 200) && above > below;
  const maxHeight = Math.min(fullHeight, placeAbove ? above : below);
  menuStyle.value = {
    width: `${width}px`,
    left: `${Math.max(margin, Math.min(bounds.left, viewportWidth - width - margin))}px`,
    top: `${placeAbove ? Math.max(margin, bounds.top - gap - maxHeight) : bounds.bottom + gap}px`,
    maxHeight: `${maxHeight}px`,
  };
}

async function revealActiveOption() {
  await nextTick();
  if (!open.value || !menu.value) return;
  const active = menu.value.querySelector<HTMLElement>(`#${optionId(activeIndex.value)}`);
  if (!active) return;
  const offsetTop = active.offsetTop;
  const bottom = offsetTop + active.offsetHeight;
  if (offsetTop < menu.value.scrollTop) menu.value.scrollTop = offsetTop;
  else if (bottom > menu.value.scrollTop + menu.value.clientHeight) menu.value.scrollTop = bottom - menu.value.clientHeight;
}

async function openMenu(index?: number) {
  if (!options.value.length) return;
  activeIndex.value = index ?? Math.max(0, options.value.findIndex((option) => option.id === props.presetId));
  open.value = true;
  positionMenu();
  await nextTick();
  menu.value?.focus({ preventScroll: true });
  await revealActiveOption();
}

function closeMenu(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}

function toggleMenu() {
  if (open.value) closeMenu();
  else void openMenu();
}

function selectOption(id: string) {
  emit('select', id);
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.value.length - 1 : undefined;
    void openMenu(index);
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
  }
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === 'Tab') {
    // Returning focus before the native Tab action preserves the toolbar's tab order.
    closeMenu(true);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const option = options.value[activeIndex.value];
    if (option) selectOption(option.id);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const last = options.value.length - 1;
    if (event.key === 'Home') activeIndex.value = 0;
    else if (event.key === 'End') activeIndex.value = last;
    else activeIndex.value = Math.max(0, Math.min(last, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1)));
    void revealActiveOption();
  }
}

function handleOutsidePointer(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && !trigger.value?.contains(target) && !menu.value?.contains(target)) closeMenu();
}

function handleOutsideFocus(event: FocusEvent) {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && !trigger.value?.contains(target) && !menu.value?.contains(target)) closeMenu();
}

watch(() => props.presetId, () => {
  if (!open.value) return;
  activeIndex.value = Math.max(0, options.value.findIndex((option) => option.id === props.presetId));
  void revealActiveOption();
});

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer, true);
  document.addEventListener('focusin', handleOutsideFocus);
  window.addEventListener('resize', positionMenu);
  window.addEventListener('scroll', positionMenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer, true);
  document.removeEventListener('focusin', handleOutsideFocus);
  window.removeEventListener('resize', positionMenu);
  window.removeEventListener('scroll', positionMenu, true);
});
</script>

<style scoped>
.preview-preset-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 1 174px;
  min-width: 130px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #59617280;
  border-radius: 5px;
  background: #292e38;
  color: #eef0f5;
  box-shadow: inset 0 1px 2px #0003;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.preview-preset-trigger:hover { background: #353b47; border-color: #747e90; }
.preview-preset-trigger[aria-expanded="true"] { border-color: #8892a4; }
.preview-preset-trigger:focus-visible { outline: 2px solid #83a0ff; outline-offset: 2px; }
.preview-preset-chevron { width: 10px; height: 7px; margin-left: auto; color: #cbd0d8; }
.preview-preset-menu {
  position: fixed;
  z-index: 4000;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px;
  border: 1px solid #c1c3c3;
  border-radius: 5px;
  outline: none;
  background: linear-gradient(115deg, #dfdfdb, #d0d2d1);
  color: #575d5d;
  box-shadow: 0 8px 22px #1116204d;
  font-family: "StarRailFont", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  font-weight: 600;
  scrollbar-width: thin;
  scrollbar-color: #9b9f9e transparent;
}
.preview-preset-group + .preview-preset-group { margin-top: 3px; padding-top: 3px; border-top: 1px solid #b9bcba80; }
.preview-preset-option {
  display: flex;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  height: 36px;
  padding: 0 8px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
}
.preview-preset-option.selected { background: #eeefeb85; }
.preview-preset-option.highlighted { background: #f5f5f0; color: #444b4c; }
.preview-preset-check { flex-shrink: 0; margin-left: auto; }
</style>
