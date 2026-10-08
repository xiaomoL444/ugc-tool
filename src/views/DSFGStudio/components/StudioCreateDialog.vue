<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { studioEditorActiveKey } from "./studioSessionHistory";

const props = withDefaults(defineProps<{
  modelValue: string;
  title: string;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  busy?: boolean;
}>(), { placeholder: "", submitLabel: "创建", busy: false });
const emit = defineEmits<{ "update:modelValue": [value: string]; submit: []; close: [] }>();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const editorActive = inject(studioEditorActiveKey, () => true);
const previousFocus = document.activeElement as HTMLElement | null;

function close() {
  if (!props.busy) emit("close");
}
function submit() {
  if (!props.busy && props.modelValue.trim()) emit("submit");
}
function backdropClick(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return;
  const bounds = dialog.value.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) close();
}
onMounted(() => {
  if (!editorActive()) return;
  dialog.value?.showModal();
  input.value?.focus();
});
watch(editorActive, active => {
  if (!active) { dialog.value?.close(); emit("close"); }
}, { flush: "sync" });
onBeforeUnmount(() => {
  dialog.value?.close();
  void nextTick(() => {
    if (previousFocus?.isConnected && !previousFocus.closest("[inert]") && previousFocus.getClientRects().length) previousFocus.focus();
  });
});
</script>

<template>
  <dialog ref="dialog" class="studio-create-dialog dsfg-typography" :aria-label="title" :aria-busy="busy"
    @cancel.prevent="close" @click="backdropClick">
    <form @submit.prevent="submit">
      <header><h2>{{ title }}</h2><button type="button" class="dialog-close" :disabled="busy" aria-label="关闭" @click="close">×</button></header>
      <label>{{ label }}<input ref="input" :value="modelValue" :placeholder="placeholder" :aria-label="label" :disabled="busy"
        required autofocus autocomplete="off" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" /></label>
      <slot />
      <footer><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" class="dialog-primary" :disabled="busy || !modelValue.trim()">{{ busy ? '创建中…' : submitLabel }}</button></footer>
    </form>
  </dialog>
</template>

<style scoped>
.studio-create-dialog { box-sizing: border-box; width: min(360px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 20px; border: 1px solid #d4d8f4; border-radius: 14px; background: #f9faff; color: #35476c; box-shadow: 0 18px 60px #29396330; font-size: 13px; font-weight: 400; line-height: 1.5; text-align: left; }
.studio-create-dialog::backdrop { background: #29396330; }
form { display: grid; gap: 18px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; color: #34466b; font-size: 16px; font-weight: 600; }
label { display: grid; gap: 8px; color: #526588; }
input { box-sizing: border-box; width: 100%; min-width: 0; height: 40px; padding: 9px 11px; border: 1px solid #ced3f3; border-radius: 8px; background: #fff; color: #344672; font: inherit; }
input::placeholder { color: #8290ad; }
footer { display: flex; justify-content: flex-end; gap: 8px; }
button { min-height: 34px; padding: 7px 14px; border: 1px solid #ced3f3; border-radius: 7px; background: #fff; color: #526588; font: inherit; cursor: pointer; }
button:hover { background: #edf3ff; }
.dialog-close { display: grid; place-items: center; width: 28px; min-height: 28px; padding: 0; border-color: transparent; background: transparent; color: #8290ad; font-size: 22px; line-height: 1; }
.dialog-primary { border-color: #168cff; background: linear-gradient(110deg, #1981ff, #00a9f4); color: #fff; }
.dialog-primary:hover { background: #0788e8; }
button:disabled { opacity: .5; cursor: default; }
input:focus-visible, button:focus-visible { outline: 2px solid #54a8ff; outline-offset: 2px; }
</style>
