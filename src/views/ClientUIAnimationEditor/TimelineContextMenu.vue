<template>
  <Teleport to="body">
    <div
      v-if="target"
      ref="menu"
      class="timeline-context-menu"
      role="menu"
      :aria-label="`${target.label}轨道操作`"
      :style="menuStyle"
      @pointerdown.stop
      @click.stop
      @contextmenu.stop.prevent
      @keydown.stop="handleMenuKeydown"
      @focusout="handleFocusOut"
    >
      <button type="button" role="menuitem" tabindex="-1" :disabled="!target.canCreate" :title="target.createHint" @click="createClip">
        <EditorIcon name="plus" :size="16" />
        <span>在此位置创建 Tweenable Clip<small>{{ target.time.toFixed(3) }} 秒</small></span>
      </button>
      <p v-if="!target.canCreate" class="creation-hint">{{ target.createHint }}</p>
      <button v-if="target.clipId" type="button" role="menuitem" tabindex="-1" @click="deleteClip">
        <EditorIcon name="trash" :size="16" />
        <span>删除当前 Clip</span>
      </button>
      <button type="button" role="menuitem" tabindex="-1" @click="deleteTrack">
        <EditorIcon name="trash" :size="16" />
        <span>删除整条属性轨道</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import EditorIcon from "./EditorIcon.vue";

const props = defineProps<{
  target: { trackId: string; clipId: string | null; label: string; x: number; y: number; time: number; canCreate: boolean; createHint: string } | null;
}>();

const emit = defineEmits<{
  (event: "delete", trackId: string): void;
  (event: "create", trackId: string): void;
  (event: "delete-clip", trackId: string): void;
  (event: "close", restoreFocus?: boolean): void;
}>();

const menu = ref<HTMLDivElement | null>(null);
const menuStyle = ref<CSSProperties>({ visibility: "hidden" });
let openVersion = 0;

function enabledItems() {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
}

function stopListening() {
  document.removeEventListener("pointerdown", handleOutsidePointer, true);
  document.removeEventListener("keydown", handleDocumentKeydown, true);
  window.removeEventListener("scroll", handleScroll, true);
  window.removeEventListener("resize", handleResize);
}

function closeMenu(restoreFocus = false) {
  if (!props.target) return;
  openVersion++;
  stopListening();
  emit("close", restoreFocus);
}

async function openMenu() {
  const version = ++openVersion;
  stopListening();
  const target = props.target;
  if (!target) return;
  const edge = 8;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  menuStyle.value = {
    visibility: "hidden",
    left: "0px",
    top: "0px",
    maxWidth: `${Math.max(0, viewportWidth - edge * 2)}px`,
    maxHeight: `${Math.max(0, viewportHeight - edge * 2)}px`,
  };
  document.addEventListener("pointerdown", handleOutsidePointer, true);
  document.addEventListener("keydown", handleDocumentKeydown, true);
  window.addEventListener("scroll", handleScroll, true);
  window.addEventListener("resize", handleResize);
  await nextTick();
  if (version !== openVersion || target !== props.target || !menu.value) return;
  const rect = menu.value.getBoundingClientRect();
  menuStyle.value = {
    ...menuStyle.value,
    visibility: "visible",
    left: `${Math.max(edge, Math.min(target.x, viewportWidth - rect.width - edge))}px`,
    top: `${Math.max(edge, Math.min(target.y, viewportHeight - rect.height - edge))}px`,
  };
  await nextTick();
  if (version !== openVersion || target !== props.target) return;
  enabledItems()[0]?.focus({ preventScroll: true });
}

function handleOutsidePointer(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node | null)) closeMenu();
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu(true);
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Tab") {
    event.preventDefault();
    closeMenu(true);
    return;
  }
  const items = enabledItems();
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === "ArrowDown") next = (current + 1) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return;
  event.preventDefault();
  items[next]?.focus({ preventScroll: true });
}

function handleFocusOut(event: FocusEvent) {
  const target = event.relatedTarget as Node | null;
  if (target && !menu.value?.contains(target)) closeMenu();
}

function handleScroll(event: Event) {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  closeMenu();
}

function handleResize() {
  closeMenu();
}

function deleteTrack() {
  const trackId = props.target?.trackId;
  if (!trackId) return;
  openVersion++;
  stopListening();
  emit("delete", trackId);
  emit("close", false);
}
function createClip() {
  if (!props.target?.canCreate) return;
  const trackId = props.target.trackId;
  openVersion++;
  stopListening();
  emit("create", trackId);
  emit("close", false);
}
function deleteClip() {
  const clipId = props.target?.clipId;
  if (!clipId) return;
  openVersion++;
  stopListening();
  emit("delete-clip", clipId);
  emit("close", false);
}

watch(() => props.target, () => { void openMenu(); }, { immediate: true, flush: "post" });
onBeforeUnmount(() => {
  openVersion++;
  stopListening();
});
</script>

<style scoped>
.timeline-context-menu {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  width: 256px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid #444d60;
  border-radius: 6px;
  background: #303746;
  box-shadow: 0 8px 22px #10131d55;
  color: #e4e7ef;
  font-family: "StarRailFont", "Microsoft YaHei", sans-serif;
  color-scheme: dark;
}

.timeline-context-menu > button {
  display: flex;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  width: 100%;
  min-height: 35px;
  padding: 8px 13px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.timeline-context-menu > button:hover,
.timeline-context-menu > button:focus-visible {
  outline: 0;
  background: #43516a;
  color: #ffffff;
}
.timeline-context-menu > button:disabled { opacity: 0.4; cursor: not-allowed; background: transparent; }
.timeline-context-menu small { display: block; color: #aab8cd; font-size: 10px; font-weight: normal; }
.creation-hint { margin: 0 10px 6px; color: #aeb7c8; font-size: 11px; line-height: 1.5; }
</style>
