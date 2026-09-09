<template>
  <button
    ref="trigger"
    class="property-actions-trigger"
    type="button"
    :aria-label="`${label}属性操作`"
    :title="`${label}属性操作`"
    aria-haspopup="menu"
    :aria-expanded="isOpen"
    @pointerdown.stop
    @click.stop.prevent="toggleMenu"
    @keydown.stop="handleTriggerKeydown"
  ><span aria-hidden="true">≡</span></button>

  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="menu"
      class="property-actions-menu"
      role="menu"
      :aria-label="`${label}属性操作`"
      :style="menuStyle"
      @pointerdown.stop
      @click.stop
      @contextmenu.prevent
      @keydown.stop="handleMenuKeydown"
      @focusout="handleFocusOut"
    >
      <button type="button" role="menuitem" tabindex="-1" @click="choose('reset')">重置</button>
      <button type="button" role="menuitem" tabindex="-1" @click="choose('copy')">复制</button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        :disabled="!canPaste"
        :aria-disabled="!canPaste"
        :title="pasteHint || undefined"
        @click="choose('paste')"
      >粘贴</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties } from "vue";

const props = withDefaults(defineProps<{
  label: string;
  canPaste?: boolean;
  pasteHint?: string;
  contextKey?: string;
}>(), { canPaste: false, pasteHint: "", contextKey: "" });

const emit = defineEmits<{
  (event: "reset"): void;
  (event: "copy"): void;
  (event: "paste"): void;
}>();

const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLDivElement | null>(null);
const isOpen = ref(false);
const menuStyle = ref<CSSProperties>({ visibility: "hidden" });
let triggerObserver: ResizeObserver | undefined;

function enabledItems() {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
}

function updatePosition() {
  if (!isOpen.value || !trigger.value || !menu.value) return;
  const edge = 8;
  const gap = 5;
  const rect = trigger.value.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(208, Math.max(0, viewportWidth - edge * 2));
  const height = Math.min(menu.value.scrollHeight, Math.max(0, viewportHeight - edge * 2));
  const below = viewportHeight - rect.bottom - gap - edge;
  const above = rect.top - gap - edge;
  const preferredTop = height > below && above > below ? rect.top - gap - height : rect.bottom + gap;
  menuStyle.value = {
    left: `${Math.max(edge, Math.min(rect.right - width, viewportWidth - width - edge))}px`,
    top: `${Math.max(edge, Math.min(preferredTop, viewportHeight - height - edge))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(0, viewportHeight - edge * 2)}px`,
  };
}

function stopListening() {
  document.removeEventListener("pointerdown", handleOutsidePointer, true);
  document.removeEventListener("keydown", handleDocumentKeydown, true);
  window.removeEventListener("resize", updatePosition);
  window.removeEventListener("scroll", updatePosition, true);
  triggerObserver?.disconnect();
  triggerObserver = undefined;
}

function closeMenu(restoreFocus = false) {
  if (!isOpen.value) return;
  isOpen.value = false;
  stopListening();
  if (restoreFocus) void nextTick(() => trigger.value?.focus({ preventScroll: true }));
}

async function openMenu(focusLast = false) {
  if (isOpen.value) return;
  isOpen.value = true;
  menuStyle.value = { visibility: "hidden" };
  document.addEventListener("pointerdown", handleOutsidePointer, true);
  document.addEventListener("keydown", handleDocumentKeydown, true);
  window.addEventListener("resize", updatePosition);
  window.addEventListener("scroll", updatePosition, true);
  if (typeof ResizeObserver !== "undefined" && trigger.value) {
    triggerObserver = new ResizeObserver(updatePosition);
    triggerObserver.observe(trigger.value);
  }
  await nextTick();
  if (!isOpen.value) return;
  updatePosition();
  await nextTick();
  if (!isOpen.value) return;
  const items = enabledItems();
  items[focusLast ? items.length - 1 : 0]?.focus({ preventScroll: true });
}

function toggleMenu() {
  if (isOpen.value) closeMenu();
  else void openMenu();
}

function handleOutsidePointer(event: PointerEvent) {
  const target = event.target as Node | null;
  if (target && !trigger.value?.contains(target) && !menu.value?.contains(target)) closeMenu();
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  if (!isOpen.value) void openMenu(event.key === "ArrowUp");
  else {
    const items = enabledItems();
    items[event.key === "ArrowUp" ? items.length - 1 : 0]?.focus({ preventScroll: true });
  }
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Tab") {
    closeMenu();
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
  if (target && !menu.value?.contains(target) && !trigger.value?.contains(target)) closeMenu();
}

function choose(action: "reset" | "copy" | "paste") {
  if (action === "paste" && !props.canPaste) return;
  closeMenu(true);
  if (action === "reset") emit("reset");
  else if (action === "copy") emit("copy");
  else emit("paste");
}

watch(() => props.contextKey, () => closeMenu());
watch(() => props.canPaste, async () => {
  if (!isOpen.value) return;
  await nextTick();
  if (menu.value?.contains(document.activeElement) && (document.activeElement as HTMLButtonElement).disabled) {
    enabledItems()[0]?.focus({ preventScroll: true });
  }
});
onBeforeUnmount(stopListening);
</script>

<style scoped>
.property-actions-trigger {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 24px;
  margin: -4px -4px -4px auto;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #d6dbe5;
  font: inherit;
  cursor: pointer;
}

.property-actions-trigger > span { font-size: 23px; font-weight: 600; line-height: 1; transform: translateY(-1px); }
.property-actions-trigger:hover, .property-actions-trigger[aria-expanded="true"] { background: #43516a; color: #ffffff; }
.property-actions-trigger:focus-visible { outline: 2px solid #a5baff; outline-offset: 1px; }

.property-actions-menu {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  width: 208px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid #444d60;
  border-radius: 6px;
  background: #303746;
  box-shadow: 0 8px 22px #10131d55;
  color: #e4e7ef;
  font-family: "StarRailFont", "Microsoft YaHei", sans-serif;
}

.property-actions-menu > button {
  display: block;
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

.property-actions-menu > button:hover:not(:disabled), .property-actions-menu > button:focus-visible { outline: 0; background: #43516a; color: #ffffff; }
.property-actions-menu > button:disabled { color: #858c9a; cursor: default; }
</style>
