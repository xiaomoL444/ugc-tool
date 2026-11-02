<template>
  <Teleport to="body">
    <dialog ref="dialog" class="first-use-guide" aria-labelledby="first-use-guide-title" aria-describedby="first-use-guide-description" @cancel.prevent="dismiss" @click.self="dismiss" @keydown.stop="trapFocus" @keyup.stop>
      <section class="first-use-content">
        <button class="guide-close" type="button" :aria-label="t('clientUIAnimationEditor.ui.actions.close')" @click="dismiss">×</button>
        <div class="guide-heading-icon"><EditorIcon name="info" :size="23" /></div>
        <h2 id="first-use-guide-title">{{ t('clientUIAnimationEditor.ui.onboarding.title') }}</h2>
        <p id="first-use-guide-description" class="guide-description">{{ t('clientUIAnimationEditor.ui.onboarding.description') }}</p>
        <div class="guide-choices">
          <a ref="videoLink" class="guide-choice video-choice" :href="videoUrl" target="_blank" rel="noopener noreferrer" @click="dismiss">
            <span class="choice-icon"><EditorIcon name="play" :size="25" /></span>
            <strong>{{ t('clientUIAnimationEditor.ui.guide.video') }}</strong>
            <span class="choice-description">{{ t('clientUIAnimationEditor.ui.guide.videoHint') }}</span>
            <span class="choice-action">{{ t('clientUIAnimationEditor.ui.onboarding.openVideo') }}<EditorIcon name="external-link" :size="14" /></span>
          </a>
          <a class="guide-choice manual-choice" :href="handbookDownloadUrl" target="_blank" rel="noopener noreferrer" @click="dismiss">
            <span class="choice-icon"><EditorIcon name="book" :size="25" /></span>
            <strong>{{ t('clientUIAnimationEditor.ui.onboarding.viewManual') }}</strong>
            <span class="choice-description">{{ t('clientUIAnimationEditor.ui.guide.manualHint', { format: clientUIAnimationGuide.manual.format }) }}</span>
            <span class="choice-action">{{ t('clientUIAnimationEditor.ui.onboarding.openManual') }}<EditorIcon name="external-link" :size="14" /></span>
          </a>
        </div>
        <p class="guide-reminder"><EditorIcon name="info" :size="16" /><span>{{ t('clientUIAnimationEditor.ui.onboarding.reminder') }}</span></p>
        <footer><button type="button" class="guide-start" @click="dismiss">{{ t('clientUIAnimationEditor.ui.onboarding.start') }}</button></footer>
      </section>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import type { StorageClass } from "../../services/storage/storage";
import { t } from "../../i18n";
import { clientUIAnimationGuide } from "../../configs/clientUIAnimationGuide";
import { useEditorGuideLinks } from "./useEditorGuideLinks";
import { hasDismissedEditorGuide, dismissEditorGuide } from "./editorGuideStorage";
import EditorIcon from "./EditorIcon.vue";

const emit = defineEmits<{ (event: "update:open", open: boolean): void }>();
const storage = inject<StorageClass | null>("storage", null);
const { videoUrl, handbookDownloadUrl } = useEditorGuideLinks();
const dialog = ref<HTMLDialogElement | null>(null);
const videoLink = ref<HTMLAnchorElement | null>(null);
let disposed = false;
let dismissed = false;
let previousFocus: HTMLElement | null = null;

function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = dialog.value?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
  if (!elements?.length) return;
  const first = elements[0], last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function dismiss() {
  if (dismissed || !dialog.value?.open) return;
  dismissed = true;
  dialog.value.close();
  emit("update:open", false);
  void nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
  if (storage) void dismissEditorGuide(storage).catch(() => {
    if (!disposed) toast.warning(t("clientUIAnimationEditor.ui.onboarding.saveFailed"));
  });
}

onMounted(async () => {
  let alreadyDismissed = false;
  try { alreadyDismissed = storage ? await hasDismissedEditorGuide(storage) : false; }
  catch { /* A failed preference read must not prevent using the editor or guide. */ }
  if (disposed || alreadyDismissed) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  emit("update:open", true);
  await nextTick();
  if (disposed) return;
  dialog.value?.showModal();
  videoLink.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  disposed = true;
  dialog.value?.close();
  emit("update:open", false);
});
</script>

<style scoped>
.first-use-guide { width: min(610px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; overflow: auto; color: #e4e7ef; background: #2d333f; border: 1px solid #535e73; border-radius: 14px; box-shadow: 0 24px 90px #0008; font-family: "StarRailFont", "Microsoft YaHei", sans-serif; color-scheme: dark; text-align: left; }
.first-use-guide::backdrop { background: #090f1cb8; backdrop-filter: blur(4px); }
.first-use-content { position: relative; padding: 30px; }
.first-use-guide * { box-sizing: border-box; }
.first-use-guide button { font: inherit; cursor: pointer; }
.guide-close { position: absolute; top: 13px; right: 13px; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; color: #b0bbce; background: transparent; border: 0; border-radius: 6px; font-size: 23px !important; }
.guide-close:hover { color: #fff; background: #424b5e; }
.guide-heading-icon { display: grid; place-items: center; width: 43px; height: 43px; margin-bottom: 16px; color: #b8ccff; background: #3b4b71; border: 1px solid #536a9a; border-radius: 12px; }
h2 { margin: 0 25px 10px 0; font-size: 22px; font-weight: 600; line-height: 1.5; }
.guide-description { margin: 0; color: #b6c0d0; font-size: 13px; line-height: 1.8; }
.guide-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 24px 0 20px; }
.guide-choice { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; gap: 10px; padding: 20px; border: 1px solid #525e76; border-radius: 10px; background: #343e50; color: #eef2fb; text-decoration: none; transition: background .15s, border-color .15s; }
.guide-choice:hover { background: #3d4b64; border-color: #9ab5f1; }
.video-choice { background: #344361; border-color: #5c78ac; }
.choice-icon { display: grid; place-items: center; width: 43px; height: 43px; margin-bottom: 3px; color: #c5d7ff; background: #ffffff0a; border: 1px solid #ffffff1f; border-radius: 10px; }
.guide-choice strong { font-size: 15px; font-weight: 500; line-height: 1.5; }
.choice-description { color: #b7c4dc; font-size: 11px; line-height: 1.7; }
.choice-action { display: flex; align-items: center; gap: 7px; margin-top: auto; padding-top: 12px; color: #c4d7ff; font-size: 12px; line-height: 1.5; }
.guide-reminder { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 12px 13px; border-radius: 7px; background: #242c39; color: #adbcd4; font-size: 12px; line-height: 1.8; }
.guide-reminder > svg { margin-top: 3px; }
footer { display: flex; justify-content: flex-end; margin-top: 22px; }
.guide-start { padding: 9px 16px; border: 1px solid #64728d; border-radius: 7px; background: #404b60; color: #e2e9f6; font-size: 12px !important; }
.guide-start:hover { background: #4d5c78; border-color: #94a6c9; }
.first-use-guide :is(button, a):focus-visible { outline: 2px solid #9cbaff; outline-offset: 3px; }
@media (max-width: 480px) { .first-use-content { padding: 24px 20px; } .guide-choices { gap: 10px; } .guide-choice { padding: 15px 12px; } h2 { font-size: 20px; } .choice-action { font-size: 11px; } }
</style>
