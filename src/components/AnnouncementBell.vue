<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { unreadCount, refreshAnnouncements, syncReadState, readStorageKey } from "@/services/announcements";
const { t } = useI18n({ useScope: "global" });
const AnnouncementReader = defineAsyncComponent(() => import("@/views/Announcements/Announcements.vue"));
const dialog = ref<HTMLDialogElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
async function showAnnouncements() {
  open.value = true;
  await nextTick();
  if (open.value && dialog.value && !dialog.value.open) dialog.value.showModal();
}
function closeAnnouncements() {
  dialog.value?.close();
  open.value = false;
  trigger.value?.focus();
}
function onBackdropClick(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return;
  const bounds = dialog.value.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) closeAnnouncements();
}
let timer: number | undefined;
function refresh() {
  if (document.visibilityState === "visible") void refreshAnnouncements();
}
function onStorage(event: StorageEvent) {
  if (event.key === readStorageKey || event.key === null) syncReadState();
}
onMounted(() => {
  refresh();
  timer = window.setInterval(refresh, 300000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("storage", onStorage);
});
onBeforeUnmount(() => {
  window.clearInterval(timer);
  window.removeEventListener("focus", refresh);
  document.removeEventListener("visibilitychange", refresh);
  window.removeEventListener("storage", onStorage);
});
</script>
<template>
  <button ref="trigger" type="button" class="announcement-bell" aria-haspopup="dialog" :aria-expanded="open" @click="showAnnouncements"
    :title="t('announcements.title')"
    :aria-label="unreadCount ? t('announcements.unreadCount', { count: unreadCount }) : t('announcements.title')">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </svg>
    <span class="bell-label">{{ t('announcements.title') }}</span>
    <span v-if="unreadCount" class="unread-dot" aria-hidden="true"></span>
  </button>
  <Teleport to="body">
    <dialog ref="dialog" class="announcement-dialog" aria-labelledby="announcement-dialog-title"
      @cancel.prevent.stop="closeAnnouncements" @close="open = false"
      @click="onBackdropClick" @keydown.stop @keyup.stop>
      <header class="dialog-header">
        <h2 id="announcement-dialog-title">{{ t('announcements.title') }}</h2>
        <button type="button" class="dialog-close" autofocus
          :aria-label="t('announcements.close')" :title="t('announcements.close')" @click="closeAnnouncements">×</button>
      </header>
      <AnnouncementReader v-if="open" class="dialog-reader" />
    </dialog>
  </Teleport>
</template>
<style scoped>
.announcement-bell { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; flex-shrink: 0; box-sizing: border-box; height: 42px; padding: 0 12px; border: 1px solid #6a5acd40; border-radius: 10px; background: #ffffffbf; color: #35476b; text-decoration: none; font: inherit; font-size: .9rem; cursor: pointer; }
.announcement-bell:hover { background: #fff; border-color: #887bd7; }
.announcement-bell:focus-visible { outline: 2px solid #887bd7; outline-offset: 3px; }
.announcement-bell svg { width: 20px; height: 20px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.unread-dot { position: absolute; top: 3px; right: 4px; width: 9px; height: 9px; border: 2px solid #fff; border-radius: 50%; background: #df3f55; }
@media (max-width: 760px) { .bell-label { display: none; } .announcement-bell { width: 38px; padding: 0; } }
.announcement-dialog { width: min(1180px, calc(100vw - 48px)); height: min(800px, 86vh); height: min(800px, 86dvh); max-width: none; max-height: none; box-sizing: border-box; padding: 0; border: 1px solid #d9d4ee; border-radius: 18px; background: #f2f0fc; color: #35476b; font-family: var(--app-font-family); box-shadow: 0 24px 80px #1e174d40; overflow: hidden; }
.announcement-dialog[open] { display: flex; flex-direction: column; }
.announcement-dialog::backdrop { background: #1e174d66; backdrop-filter: blur(3px); }
.dialog-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 16px; padding: 14px 20px; border-bottom: 1px solid #d9d4ee; }
.dialog-header h2 { margin: 0; font-size: 20px; }
.dialog-close { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; padding: 0; border: 1px solid #d9d4ee; border-radius: 8px; background: #fff9; color: #574a98; font-size: 26px; cursor: pointer; }
.dialog-close:hover { background: #fff; }
.dialog-close:focus-visible { outline: 2px solid #887bd7; outline-offset: 2px; }
.dialog-reader { flex: 1; min-height: 0; }
@media (max-width: 680px) {
  .announcement-dialog { width: calc(100vw - 16px); height: 92vh; height: 92dvh; border-radius: 12px; }
  .dialog-header { padding: 10px 14px; }
}
</style>
