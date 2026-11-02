<template>
  <div ref="root" class="editor-guide" @pointerdown.stop @focusout="onFocusOut" @keydown.esc.stop.prevent="closeAndFocus">
    <button ref="trigger" class="guide-button" :aria-expanded="open" aria-controls="client-ui-guide-menu" @click.stop="toggle" @keydown.down.stop.prevent="focusLink(0)" @keydown.up.stop.prevent="focusLink(-1)">
      <EditorIcon name="info" :size="16" />
      <span>{{ t('clientUIAnimationEditor.ui.guide.title') }}</span>
      <EditorIcon name="chevron-down" :size="12" />
    </button>
    <div v-if="open" id="client-ui-guide-menu" class="guide-menu" @keydown.down.stop.prevent="moveFocus(1)" @keydown.up.stop.prevent="moveFocus(-1)">
      <a :href="videoUrl" target="_blank" rel="noopener noreferrer" @click="open = false">
        <EditorIcon class="guide-item-icon" name="play" :size="18" />
        <span class="guide-item-copy"><b>{{ t('clientUIAnimationEditor.ui.guide.video') }}</b><small>{{ t('clientUIAnimationEditor.ui.guide.videoHint') }}</small></span>
        <EditorIcon class="guide-item-action" name="external-link" :size="14" />
      </a>
      <a v-if="clientUIAnimationGuide.manual" :href="handbookDownloadUrl" :download="clientUIAnimationGuide.manual.fileName" target="_blank" rel="noopener noreferrer" @click="open = false">
        <EditorIcon class="guide-item-icon" name="download" :size="18" />
        <span class="guide-item-copy"><b>{{ t('clientUIAnimationEditor.ui.guide.manual') }}</b><small>{{ t('clientUIAnimationEditor.ui.guide.manualHint', { format: clientUIAnimationGuide.manual.format }) }}</small></span>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../../i18n";
import { clientUIAnimationGuide } from "../../configs/clientUIAnimationGuide";
import { useEditorGuideLinks } from "./useEditorGuideLinks";
import EditorIcon from "./EditorIcon.vue";

const emit = defineEmits<{ (event: "opened"): void }>();
const { videoUrl, handbookDownloadUrl } = useEditorGuideLinks();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

function toggle() {
  open.value = !open.value;
  if (open.value) emit("opened");
}
function closeAndFocus() {
  open.value = false;
  trigger.value?.focus();
}
async function focusLink(index: number) {
  if (!open.value) toggle();
  await nextTick();
  const links = root.value?.querySelectorAll<HTMLAnchorElement>(".guide-menu a");
  if (links?.length) links[index < 0 ? links.length - 1 : index]?.focus();
}
function moveFocus(direction: number) {
  const links = Array.from(root.value?.querySelectorAll<HTMLAnchorElement>(".guide-menu a") ?? []);
  if (!links.length) return;
  const index = links.findIndex(link => link === document.activeElement);
  links[(index + direction + links.length) % links.length]?.focus();
}
function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) open.value = false;
}
function onOutsidePointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node | null)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", onOutsidePointerDown, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutsidePointerDown, true));
</script>

<style scoped>
.editor-guide { position: relative; flex-shrink: 0; padding-left: 10px; border-left: 1px solid var(--line); }
.guide-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 32px; padding: 0 9px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #d9dde7; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; transition: background .12s, border-color .12s; }
.guide-button:hover, .guide-button[aria-expanded="true"] { background: #424b5e; border-color: #4c5362; color: white; }
.guide-menu { position: absolute; top: calc(100% + 7px); right: 0; z-index: 30; width: 254px; max-width: calc(100vw - 24px); padding: 5px; box-sizing: border-box; border: 1px solid #525b6d; border-radius: 8px; background: #353c49; box-shadow: 0 10px 28px #0005; }
.guide-menu a { display: flex; align-items: center; gap: 10px; padding: 11px 10px; border-radius: 5px; color: #e4e7ef; text-decoration: none; }
.guide-menu a:hover { background: #465166; }
.guide-button:focus-visible, .guide-menu a:focus-visible { outline: 2px solid #89a6ff; outline-offset: -2px; }
.guide-item-icon { color: #aebfe7; }
.guide-item-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.guide-item-copy b { font-size: 12px; font-weight: 500; }
.guide-item-copy small { color: #a9afbb; font-size: 11px; line-height: 1.5; }
.guide-item-action { align-self: flex-start; margin-top: 2px; color: #a9afbb; }
</style>
