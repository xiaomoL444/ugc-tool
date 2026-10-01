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
    <button ref="trigger" type="button" class="workspace-trigger" :class="{ 'is-open': open }" :disabled="disabled"
      aria-label="选择工作区" :title="modelValue || '选择工作区'" aria-haspopup="menu" :aria-expanded="open" aria-controls="studio-workspace-options"
      @click="toggle" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <StudioIcon name="folder" :size="16" />
      <span>{{ modelValue || '选择工作区' }}</span>
      <svg class="workspace-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Transition name="workspace-menu">
      <div v-if="open" class="workspace-options-card">
        <div id="studio-workspace-options" ref="menu" class="workspace-options" role="menu" aria-label="工作区列表" @keydown="onMenuKeydown">
          <button v-for="id in workspaces" :key="id" type="button" class="workspace-option" :class="{ 'is-selected': id === modelValue }"
            role="menuitemradio" :aria-checked="id === modelValue" tabindex="-1" @click="select(id)">
            <span>{{ id }}</span>
            <svg v-if="id === modelValue" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          </button>
          <p v-if="!workspaces.length" class="workspace-empty">暂无工作区，请点击右侧 ＋ 新建</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Match the App language picker while keeping workspace names readable in the sidebar. */
.studio-workspace-select { position: relative; flex: 1; min-width: 0; z-index: 40; }
.workspace-trigger { display: flex; align-items: center; gap: 7px; width: 100%; height: 42px; padding: 0 10px; border: 1px solid rgba(106, 90, 205, .25); border-radius: 10px; background: rgba(255, 255, 255, .75); color: #35476b; font: inherit; font-size: 13px; cursor: pointer; transition: background 150ms, border-color 150ms; }
.workspace-trigger:hover:not(:disabled), .workspace-trigger.is-open { background: #fff; border-color: #887bd7; }
.workspace-trigger:focus-visible { outline: 2px solid #887bd7; outline-offset: 3px; }
.workspace-trigger:disabled { opacity: .5; cursor: default; }
.workspace-trigger span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
svg { flex-shrink: 0; width: 19px; height: 19px; stroke: currentColor; stroke-width: 1.5; }
.workspace-chevron { width: 14px; height: 14px; transition: transform 150ms; }
.is-open .workspace-chevron { transform: rotate(180deg); }
.workspace-options-card { position: absolute; top: calc(100% + 12px); left: 0; width: max(100%, 240px); max-width: calc(100vw - 48px); box-sizing: border-box; padding: 8px; border: 1px solid #e9e5f7; border-radius: 16px; background: #fff; box-shadow: 0 12px 36px rgba(53, 39, 108, .16); transform-origin: top left; }
.workspace-options-card::before { content: ''; position: absolute; top: -6px; left: 22px; width: 10px; height: 10px; background: #fff; border-top: 1px solid #e9e5f7; border-left: 1px solid #e9e5f7; transform: rotate(45deg); }
.workspace-options { position: relative; max-height: min(320px, max(100px, calc(100dvh - 200px))); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #d4cdee transparent; }
.workspace-option { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 46px; padding: 10px 14px; border: 0; border-radius: 9px; background: transparent; color: #555b70; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.workspace-option span { min-width: 0; overflow-wrap: anywhere; }
.workspace-option:hover, .workspace-option:focus-visible { background: #f0edff; outline: none; }
.workspace-option.is-selected { color: #6a5acd; }
.workspace-option svg { stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.workspace-empty { margin: 6px; padding: 8px; color: #73758b; font-size: 12px; line-height: 1.7; }
.workspace-menu-enter-active, .workspace-menu-leave-active { transition: opacity 150ms, transform 150ms; }
.workspace-menu-enter-from, .workspace-menu-leave-to { opacity: 0; transform: translateY(-4px) scale(.98); }
@media (prefers-reduced-motion: reduce) { .workspace-trigger, .workspace-chevron, .workspace-menu-enter-active, .workspace-menu-leave-active { transition: none; } }
</style>
