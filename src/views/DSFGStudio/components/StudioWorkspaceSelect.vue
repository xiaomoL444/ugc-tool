<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import StudioIcon from "./StudioIcon.vue";

const props = withDefaults(defineProps<{ modelValue: string; workspaces: string[]; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ select: [id: string] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const open = ref(false);

async function show(last = false) {
  if (props.disabled) return;
  open.value = true;
  await nextTick();
  if (!open.value) return;
  const options = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
  const selected = props.workspaces.indexOf(props.modelValue);
  options?.[last ? props.workspaces.length - 1 : Math.max(0, selected)]?.focus();
}
function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
function toggle() { if (open.value) close(); else void show(); }
function select(id: string) {
  if (props.disabled || !props.workspaces.includes(id)) return;
  close(true);
  // The parent updates modelValue only after the current editor has saved successfully.
  if (id !== props.modelValue) emit("select", id);
}
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Tab") { close(true); return; }
  const options = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
  if (!options.length) return;
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  switch (event.key) {
    case "ArrowDown": next = (index + 1) % options.length; break;
    case "ArrowUp": next = (index - 1 + options.length) % options.length; break;
    case "Home": next = 0; break;
    case "End": next = options.length - 1; break;
    default: return;
  }
  event.preventDefault();
  options[next]?.focus();
}
function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close();
}
function onPointerDown(event: PointerEvent) {
  if (root.value && !event.composedPath().includes(root.value)) close();
}
watch(() => props.disabled, disabled => { if (disabled) close(); });
watch(() => props.modelValue, () => close());
onMounted(() => document.addEventListener("pointerdown", onPointerDown, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown, true));
</script>

<template>
  <div ref="root" class="studio-workspace-select" @focusout="onFocusOut" @keydown.esc.stop.prevent="close(true)">
    <button ref="trigger" type="button" class="workspace-trigger dropdown-trigger" :disabled="disabled"
      aria-label="选择工作区" :title="modelValue || '选择工作区'" aria-haspopup="menu" :aria-expanded="open" aria-controls="studio-workspace-options"
      @click="toggle" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <StudioIcon name="folder" :size="16" />
      <span>{{ modelValue || '选择工作区' }}</span>
      <svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Transition name="dropdown">
      <div v-if="open" class="workspace-options-card dropdown-menu dropdown-menu--start">
        <div id="studio-workspace-options" ref="menu" class="workspace-options" role="menu" aria-label="工作区列表" @keydown="onMenuKeydown">
          <button v-for="id in workspaces" :key="id" type="button" class="dropdown-option"
            role="menuitemradio" :aria-checked="id === modelValue" tabindex="-1" @click="select(id)">
            <span>{{ id }}</span>
            <svg v-if="id === modelValue" class="dropdown-check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          </button>
          <p v-if="!workspaces.length" class="workspace-empty">暂无工作区，请点击右侧 ＋ 新建</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.studio-workspace-select { position: relative; flex: 1; min-width: 0; z-index: 40; }
.workspace-trigger { width: 100%; --dropdown-gap: 7px; --dropdown-padding: 10px; --dropdown-font-size: 13px; }
.workspace-trigger span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.workspace-trigger > svg { flex-shrink: 0; }
.workspace-options-card { --dropdown-menu-width: max(100%, 240px); --dropdown-menu-max-width: calc(100vw - 48px); --dropdown-option-font-size: 14px; }
.workspace-options { position: relative; max-height: min(320px, max(100px, calc(100dvh - 200px))); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #d4cdee transparent; }
.workspace-empty { margin: 6px; padding: 8px; color: #73758b; font-size: 12px; line-height: 1.7; }
</style>
