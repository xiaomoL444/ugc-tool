<template>
  <button class="storage-trigger" type="button" :title="status.message" @click="openSettings">
    <span class="storage-dot" :class="{ online: !desktop || status.connected, failed: !!status.lastSaveError }" />
    {{ desktop ? labels.disk : labels.browser }}
    <span v-if="status.lastSaveError">!</span>
  </button>
  <Teleport to="body">
    <div v-if="syncLocked && !syncBusy" class="storage-alert" role="status">
      <span>{{ labels.synced }}</span><button type="button" @click="reloadPage">{{ labels.reload }}</button>
    </div>
    <div v-else-if="desktop && (status.lastSaveError || !status.connected)" class="storage-alert" role="status">
      <span>{{ status.lastSaveError || labels.offline }}</span>
      <button type="button" @click="openSettings">{{ labels.settings }}</button>
    </div>
    <dialog ref="dialog" class="storage-dialog" aria-labelledby="storage-title" @cancel="onCancel">
      <form @submit.prevent="applySettings">
        <div class="storage-heading">
          <h2 id="storage-title">{{ labels.settings }}</h2>
          <button type="button" :aria-label="labels.close" :disabled="syncBusy" @click="dialog?.close()">×</button>
        </div>
        <div class="storage-fields">
        <p class="storage-development" role="status">{{ t('common.storageUnderDevelopment') }}</p>
        <p>{{ labels.description }}</p>
        <p><a class="storage-companion-link" href="https://github.com/xiaomoL444/ugc-tool-desktop/" target="_blank" rel="noopener noreferrer">{{ labels.companionLink }}</a></p>
        <label>{{ labels.location }}
          <select v-model="draft.mode" :disabled="syncBusy || syncLocked">
            <option value="browser">{{ labels.browser }}</option>
            <option value="desktop">{{ labels.disk }}</option>
          </select>
        </label>
        <button type="button" :disabled="syncBusy || syncLocked" @click="showSync = !showSync">{{ labels.sync }}</button>
        <template v-if="draft.mode === 'desktop' || showSync">
          <ol>
            <li>{{ labels.step1 }}</li>
            <li>{{ labels.step2 }} <code>{{ origin }}</code>
              <button type="button" class="storage-copy" @click="copyOrigin">{{ labels.copy }}</button>
            </li>
            <li>{{ labels.step3 }}</li>
          </ol>
          <label>{{ labels.address }}
            <input v-model="draft.endpoint" :required="draft.mode === 'desktop'" :disabled="syncBusy || syncLocked" spellcheck="false" placeholder="http://127.0.0.1:27182" />
          </label>
          <label>{{ labels.token }}
            <input v-model="draft.token" type="password" :required="draft.mode === 'desktop'" :disabled="syncBusy || syncLocked" autocomplete="off" spellcheck="false" />
          </label>
          <button type="button" :disabled="busy || syncBusy" @click="testConnection">{{ labels.test }}</button>
          <p v-if="desktop" class="storage-status">{{ status.message }}</p>
          <p v-if="status.lastChange" class="storage-change">{{ labels.change }} {{ status.lastChange }}</p>
        </template>
        <StorageSyncPanel v-if="showSync" :settings="draft" @busy="syncBusy = $event" @locked="syncLocked = true" />
        <p class="storage-note">{{ labels.note }}</p>
        <p v-if="feedback" :class="{ 'storage-error': failed }" role="status">{{ feedback }}</p>
        </div>
        <div class="storage-actions">
          <button type="button" :disabled="syncBusy" @click="dialog?.close()">{{ labels.close }}</button>
          <button v-if="syncLocked" class="storage-primary" type="button" :disabled="syncBusy" @click="reloadPage">{{ labels.reload }}</button>
          <button v-else class="storage-primary" type="submit" :disabled="busy || syncBusy">{{ labels.apply }}</button>
        </div>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { StorageClass } from "../services/storage/storage";
import { DesktopStorage, readStorageSettings, saveStorageSettings, type DesktopStatus } from "../services/storage/desktopStorage";
import StorageSyncPanel from './StorageSyncPanel.vue';

const storage = inject<StorageClass>("storage")!;
const desktop = storage.provider instanceof DesktopStorage ? storage.provider : undefined;
const dialog = ref<HTMLDialogElement>();
const draft = reactive(readStorageSettings());
const showSync = ref(false), syncBusy = ref(false), syncLocked = ref(false);
const status = ref<DesktopStatus>({ connected: false, message: "", lastSaveError: "", lastChange: "" });
const unsubscribe = desktop?.onStatus(value => { status.value = value; });
onBeforeUnmount(() => unsubscribe?.());
const busy = ref(false);
const failed = ref(false);
const feedback = ref("");
const origin = window.location.origin;
const { locale, t } = useI18n({ useScope: "global" });
const labels = computed(() => locale.value.startsWith("zh") ? {
  browser: "浏览器存档", disk: "电脑存档", settings: "存储设置", close: "关闭",
  sync: "迁移 / 双向同步存档", synced: "同步操作后已暂停编辑器读写，请刷新页面读取存档。", reload: "刷新并读取存档",
  description: "选择 UGC Tools 的存档位置。电脑模式需要运行本地存档助手。", location: "存档位置",
  companionLink: "本地存档助手（GitHub）",
  step1: "在 C# 程序中选择存档目录。", step2: "将当前网站来源加入程序的“允许的网站”：",
  step3: "启动服务，复制配对码并粘贴到下方。若浏览器询问本地网络访问，请允许。",
  copy: "复制", address: "本地服务地址", token: "配对码", test: "测试连接", connected: "连接成功，可以使用电脑存档。",
  note: "可先通过“迁移 / 双向同步存档”复制已有存档，再切换保存位置。切换设置会刷新页面，请先保存或导出当前编辑。电脑模式断线时不会自动改存到浏览器。",
  apply: "应用设置并刷新", confirm: "即将刷新页面，尚未保存的编辑会丢失。确认已经保存或导出，并应用存储设置？",
  offline: "电脑存档未连接，当前修改尚未确认保存到磁盘。", change: "最近收到的文件变更：", copied: "网站来源已复制。",
} : {
  browser: "Browser saves", disk: "Desktop saves", settings: "Storage settings", close: "Close",
  sync: "Migrate / sync saves", synced: "Editor storage is paused after sync. Reload to read the saves.", reload: "Reload saves",
  description: "Choose where UGC Tools saves your work. Desktop mode requires the local save companion.", location: "Save location",
  companionLink: "Local save companion (GitHub)",
  step1: "Choose a save folder in the C# companion.", step2: "Add this website origin to the companion's allowed websites:",
  step3: "Start the service, copy its pairing code and paste it below. Allow local network access if your browser asks.",
  copy: "Copy", address: "Local service address", token: "Pairing code", test: "Test connection", connected: "Connected. Desktop storage is ready.",
  note: "Use Migrate / sync saves before switching save locations. Applying settings reloads the page; save or export your edits first. Desktop mode never falls back to browser storage on disconnection.",
  apply: "Apply and reload", confirm: "Reloading discards unsaved edits. Have you saved or exported your work and want to apply these settings?",
  offline: "Desktop storage is disconnected. Current edits are not confirmed saved to disk.", change: "Latest file change:", copied: "Website origin copied.",
});

function openSettings() {
  if (!showSync && !syncLocked) Object.assign(draft, readStorageSettings());
  feedback.value = "";
  dialog.value?.showModal();
}
function onCancel(event: Event) { if (syncBusy.value) event.preventDefault(); }
function reloadPage() { window.location.reload(); }

async function check() {
  const probe = new DesktopStorage({ ...draft });
  try { await probe.checkConnection(); }
  finally { probe.dispose(); }
}

async function testConnection() {
  busy.value = true; feedback.value = ""; failed.value = false;
  try { await check(); feedback.value = labels.value.connected; }
  catch (error) { failed.value = true; feedback.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function copyOrigin() {
  try { await navigator.clipboard.writeText(origin); failed.value = false; feedback.value = labels.value.copied; }
  catch { feedback.value = origin; }
}

async function applySettings() {
  if (syncBusy.value || syncLocked.value) return;
  busy.value = true; feedback.value = ""; failed.value = false;
  try {
    if (draft.mode === "desktop") await check();
    if (!window.confirm(labels.value.confirm)) return;
    saveStorageSettings({ ...draft });
    window.location.reload();
  } catch (error) { failed.value = true; feedback.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}
</script>

<style scoped>
.storage-trigger { display: flex; align-items: center; gap: 7px; flex-shrink: 0; min-height: 42px; padding: 0 12px; border: 1px solid #6a5acd40; border-radius: 10px; background: #ffffffbf; color: #35476b; font: inherit; font-size: 13px; cursor: pointer; }
.storage-dot { width: 8px; height: 8px; border-radius: 50%; background: #c47e1b; }
.storage-dot.online { background: #218552; }
.storage-dot.failed { background: #bf3333; }
.storage-dialog { box-sizing: border-box; width: min(608px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 0; overflow: hidden; border: 1px solid #dce0ed; border-radius: 16px; box-shadow: 0 20px 80px #19264f40; color: #2c3e50; font: 14px/1.6 "Microsoft YaHei UI", sans-serif; }
.storage-dialog form { display: flex; flex-direction: column; max-height: calc(100dvh - 50px); }
.storage-fields { min-height: 0; overflow: auto; padding: 0 24px; }
.storage-dialog::backdrop { background: #18223c66; backdrop-filter: blur(3px); }
.storage-heading { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding: 20px 24px 8px; }
.storage-heading h2 { margin: 0; font-size: 22px; }
.storage-dialog label { display: grid; gap: 6px; margin: 15px 0; font-weight: 600; }
.storage-dialog input, .storage-dialog select { box-sizing: border-box; width: 100%; min-height: 40px; border: 1px solid #cbd2e3; border-radius: 8px; padding: 8px 10px; color: #263650; background: white; font: inherit; }
.storage-dialog button, .storage-alert button { border: 1px solid #cbd2e3; border-radius: 8px; padding: 7px 12px; background: #f5f6fb; color: #35476b; cursor: pointer; font: inherit; }
.storage-dialog button:disabled { opacity: .55; cursor: wait; }
.storage-dialog li { margin: 8px 0; }
.storage-companion-link { color: #6554c0; text-decoration: underline; text-underline-offset: 3px; }
.storage-dialog code { overflow-wrap: anywhere; user-select: all; }
.storage-dialog .storage-copy { padding: 2px 6px; margin-left: 6px; }
.storage-note { padding: 12px; background: #f2f4fb; border-radius: 8px; }
.storage-development { padding: 10px 12px; border: 1px solid #e5ba75; border-radius: 8px; background: #fff6e7; color: #7b4815; }
.storage-change { color: #60708d; overflow-wrap: anywhere; }
.storage-error { color: #b72c2c; }
.storage-actions { display: flex; justify-content: flex-end; flex-shrink: 0; gap: 10px; padding: 16px 24px; border-top: 1px solid #e8eaf1; }
.storage-dialog .storage-primary { background: #6554c0; color: white; border-color: #6554c0; }
.storage-alert { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 2000; display: flex; gap: 12px; align-items: center; max-width: min(760px, calc(100vw - 48px)); width: max-content; padding: 10px 14px; border: 1px solid #e5ba75; border-radius: 10px; background: #fff6e7; color: #7b4815; box-shadow: 0 4px 20px #0002; font: 13px/1.5 sans-serif; }
.storage-alert button { flex-shrink: 0; }
@media (max-width: 600px) { .storage-trigger { max-width: 98px; padding: 0 7px; font-size: 11px; } .storage-fields { padding: 0 18px; } .storage-heading { padding: 16px 18px 8px; } .storage-actions { padding: 12px 18px; } }
</style>
