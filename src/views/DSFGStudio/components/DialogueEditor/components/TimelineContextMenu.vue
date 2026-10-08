<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  position: { x: number; y: number };
  title: string;
  items: { id: string; label: string; disabled?: boolean; hint?: string; danger?: boolean }[];
}>();
const emit = defineEmits<{ select: [action: string]; close: [restoreFocus?: boolean] }>();
const menu = ref<HTMLElement>();
const position = ref({ left: "0px", top: "0px" });
let disposed = false;

async function place() {
  await nextTick();
  if (disposed || !menu.value) return;
  position.value = {
    left: `${Math.max(8, Math.min(props.position.x, window.innerWidth - menu.value.offsetWidth - 8))}px`,
    top: `${Math.max(8, Math.min(props.position.y, window.innerHeight - menu.value.offsetHeight - 8))}px`,
  };
  (menu.value.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? menu.value).focus({ preventScroll: true });
}

function outside(event: PointerEvent) {
  if (!event.composedPath().includes(menu.value!)) emit("close");
}

function scroll(event: Event) {
  if (!menu.value?.contains(event.target as Node)) emit("close");
}

function close() {
  emit("close");
}

function keydown(event: KeyboardEvent) {
  if (event.key === "Tab") {
    emit("close");
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close", true);
    return;
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
}

watch(() => props.position, place);
onMounted(() => {
  void place();
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("scroll", scroll, true);
  window.removeEventListener("resize", close);
  window.removeEventListener("blur", close);
});
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="timeline-context-menu dsfg-typography" data-clip-editor role="menu" tabindex="-1"
      :aria-label="title" :style="position"
      @contextmenu.prevent.stop @pointerdown.stop @click.stop @keydown="keydown">
      <p>{{ title }}</p>
      <button v-for="item in items" :key="item.id" type="button" role="menuitem"
        :disabled="item.disabled" :title="item.hint" :class="{ danger: item.danger }"
        @click="emit('select', item.id)">{{ item.label }}</button>
      <small v-if="items.some(item => item.disabled && item.hint)">
        {{ items.find(item => item.disabled && item.hint)?.hint }}
      </small>
    </div>
  </Teleport>
</template>

<style scoped>
.timeline-context-menu {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  width: 212px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  padding: 6px;
  overflow-y: auto;
  color: #4b5670;
  background: #fff;
  border: 1px solid #e5dff3;
  border-radius: 10px;
  box-shadow: 0 8px 28px #6252a526;
}
.timeline-context-menu p {
  margin: 2px 8px 6px;
  color: #8490a7;
  font-size: 11px;
}
.timeline-context-menu button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.timeline-context-menu button:hover:not(:disabled),
.timeline-context-menu button:focus-visible {
  color: #6a5acd;
  background: #f0edff;
  outline: none;
}
.timeline-context-menu button.danger { color: #b65d6e; }
.timeline-context-menu button:disabled { color: #a5aabb; cursor: default; }
.timeline-context-menu small {
  display: block;
  padding: 6px 8px 2px;
  color: #8490a7;
  font-size: 11px;
  line-height: 1.5;
}
</style>
