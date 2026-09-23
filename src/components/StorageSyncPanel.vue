<template>
  <section class="sync-panel" aria-labelledby="sync-title">
    <h3 id="sync-title">{{ t('title') }}</h3>
    <p>{{ t('intro') }}</p>
    <label class="sync-check"><input v-model="acknowledged" type="checkbox" :disabled="busy" />{{ t('ack') }}</label>
    <label>{{ t('direction') }}
      <select v-model="direction" :disabled="busy">
        <option value="both">{{ t('both') }}</option><option value="to-desktop">{{ t('toDesktop') }}</option><option value="to-browser">{{ t('toBrowser') }}</option>
      </select>
    </label>
    <div class="sync-buttons">
      <button type="button" :disabled="busy || !acknowledged" @click="compare">{{ t('compare') }}</button>
      <button v-if="busy" type="button" @click="controller?.abort()">{{ t('cancel') }}</button>
    </div>
    <p v-if="busy" role="status">{{ t(phase) }} {{ completed }}<br /><span class="sync-path">{{ currentPath }}</span></p>
    <p v-if="error" role="alert" class="sync-error">{{ error }}</p>
    <template v-if="rows && !result">
      <div class="sync-summary"><span v-for="status in statuses" :key="status">{{ t(status) }}: {{ count(status) }}</span></div>
      <template v-if="count('conflict')">
        <p>{{ t('conflictHint') }}</p>
        <div class="sync-buttons">
          <button v-if="direction !== 'to-browser'" type="button" :disabled="busy" @click="chooseAll('browser')">{{ t('allBrowser') }}</button>
          <button v-if="direction !== 'to-desktop'" type="button" :disabled="busy" @click="chooseAll('desktop')">{{ t('allDesktop') }}</button>
          <button type="button" :disabled="busy" @click="chooseAll('skip')">{{ t('allSkip') }}</button>
        </div>
      </template>
      <div class="sync-table"><table>
        <thead><tr><th>{{ t('path') }}</th><th>{{ t('difference') }}</th><th>{{ t('action') }}</th></tr></thead>
        <tbody><tr v-for="row in changedRows.slice(0, limit)" :key="row.path">
          <td class="sync-path">{{ row.path }}</td><td>{{ t(row.status) }}</td>
          <td><select v-if="row.status === 'conflict'" v-model="row.choice" :aria-label="t('action') + ' ' + row.path" :disabled="busy">
            <option value="skip">{{ t('skip') }}</option>
            <option v-if="direction !== 'to-browser'" value="browser">{{ t('useBrowser') }}</option>
            <option v-if="direction !== 'to-desktop'" value="desktop">{{ t('useDesktop') }}</option>
          </select><span v-else>{{ actionLabel(row) }}</span></td>
        </tr></tbody>
      </table></div>
      <button v-if="changedRows.length > limit" type="button" @click="limit += 200">{{ t('more') }}</button>
      <p>{{ t('planned') }} {{ actions.length }} {{ t('items') }}</p>
      <button type="button" class="sync-primary" :disabled="busy || !actions.length || !acknowledged" @click="run">{{ t('run') }}</button>
    </template>
    <div v-if="result" class="sync-result" role="status">
      <strong>{{ t(result.error ? 'failed' : result.cancelled ? 'cancelled' : 'done') }}</strong>
      <p>{{ result.completed }} / {{ result.total }} {{ t('items') }}</p>
      <p v-if="result.error" class="sync-error">{{ result.failedPath }}: {{ result.error }}</p>
      <p>{{ t('after') }}</p><button type="button" class="sync-primary" @click="reload">{{ t('reload') }}</button>
    </div>
    <p class="sync-note">{{ t('scope') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { BrowserStorage } from '../services/storage/browserStorage';
import { DesktopStorage, rememberDesktopConnection, type StorageSettings } from '../services/storage/desktopStorage';
import type { StorageClass } from '../services/storage/storage';
import { compareStorage, executeSync, planSync, type SyncChoice, type SyncDirection, type SyncResult, type SyncRow } from '../services/storage/storageSync';
const props = defineProps<{ settings: StorageSettings }>();
const emit = defineEmits<{ (event: 'busy', value: boolean): void; (event: 'locked'): void }>();
const storage = inject<StorageClass>('storage')!;
const { locale } = useI18n({ useScope: 'global' });
const acknowledged = ref(false), busy = ref(false), error = ref(''), completed = ref(0), currentPath = ref('');
const phase = ref<'scan' | 'sync'>('scan'), limit = ref(200), direction = ref<SyncDirection>('both');
const rows = ref<SyncRow[]>(), result = shallowRef<SyncResult>(), controller = shallowRef<AbortController>();
let browser: BrowserStorage | undefined, desktop: DesktopStorage | undefined;
let paused = false, scanEndpoint = '', scanToken = '';
const statuses: SyncRow['status'][] = ['browser-only', 'desktop-only', 'same', 'conflict', 'blocked'];
const actions = computed(() => planSync(rows.value || [], direction.value));
const changedRows = computed(() => (rows.value || []).filter(row => row.status !== 'same'));
const count = (status: SyncRow['status']) => (rows.value || []).filter(row => row.status === status).length;
watch(busy, value => emit('busy', value), { flush: 'sync' });
watch(() => [props.settings.endpoint, props.settings.token], () => { if (!busy.value) { rows.value = undefined; result.value = undefined; } });
onBeforeUnmount(() => { controller.value?.abort(); desktop?.dispose(); });
const messages = {
  title: ['迁移与双向同步', 'Migrate and sync'],
  intro: ['先比较已保存的存档，再执行复制。双向合并补齐各自缺少的文件；同名但内容不同的文件由你选择。比较成功后记住连接，不改变当前保存位置。', 'Compare saved files before copying. Merge fills missing files on both sides; choose a version for conflicting files. A successful comparison remembers the connection without changing your save location.'],
  ack: ['我已保存或导出当前编辑，并关闭其他 UGC Tools 编辑页面。', 'I saved or exported my edits and closed other UGC Tools editor tabs.'],
  direction: ['同步方向', 'Direction'], both: ['双向合并', 'Merge both ways'], toDesktop: ['浏览器 → 电脑', 'Browser → Desktop'], toBrowser: ['电脑 → 浏览器', 'Desktop → Browser'],
  compare: ['比较两边存档', 'Compare saves'], cancel: ['取消（当前文件完成后停止）', 'Cancel after current file'], scan: ['正在比较', 'Comparing'], sync: ['正在同步', 'Syncing'],
  'browser-only': ['仅浏览器', 'Browser only'], 'desktop-only': ['仅电脑', 'Desktop only'], same: ['一致', 'Identical'], conflict: ['内容冲突', 'Content conflict'], blocked: ['文件/目录冲突', 'File/folder conflict'],
  conflictHint: ['冲突默认跳过。选择使用哪一边后，会备份并覆盖另一边的同名文件。文件/目录冲突需先重命名处理。', 'Conflicts are skipped by default. Choosing a version backs up and replaces the other side. Rename file/folder conflicts before syncing.'],
  allBrowser: ['所有冲突使用浏览器版本', 'Use browser for all conflicts'], allDesktop: ['所有冲突使用电脑版本', 'Use desktop for all conflicts'], allSkip: ['跳过所有冲突', 'Skip all conflicts'],
  path: ['文件路径', 'Path'], difference: ['差异', 'Difference'], action: ['处理方式', 'Action'], skip: ['跳过', 'Skip'], useBrowser: ['使用浏览器版本', 'Use browser version'], useDesktop: ['使用电脑版本', 'Use desktop version'],
  more: ['显示更多', 'Show more'], planned: ['将复制', 'Will copy'], items: ['项（含文件夹）', 'items (including folders)'], run: ['执行上述同步', 'Run this sync'],
  failed: ['同步已停止，部分操作可能已完成', 'Sync stopped; some operations may have completed'], cancelled: ['同步已取消', 'Sync cancelled'], done: ['所选同步操作已完成', 'Selected sync operations completed'],
  after: ['已完成的复制会保留。请刷新页面重新读取存档；未处理的冲突或失败项可在刷新后重新比较。', 'Completed copies are retained. Reload to read the saves, then compare again for any unresolved conflicts or failures.'],
  reload: ['刷新并读取存档', 'Reload saves'],
  scope: ['同步所有项目存档及空文件夹，不传播删除，不同步回收站、内部备份或浏览器偏好。电脑覆盖前使用历史备份，浏览器备份在 /.ugc-sync-backups/。这是手动同步，不会在后台持续运行。', 'Includes project saves and empty folders. No deletion propagation, trash, internal backups or browser preferences. Replaced desktop files use history; browser backups go to /.ugc-sync-backups/. Runs manually, not continuously.'],
} as const;
const t = (key: keyof typeof messages) => messages[key][locale.value.startsWith('zh') ? 0 : 1];
function actionLabel(row: SyncRow) { const action = planSync([row], direction.value)[0]; return action ? t(action.from === 'browser' ? 'toDesktop' : 'toBrowser') : t('skip'); }
function chooseAll(choice: SyncChoice) { for (const row of rows.value || []) if (row.status === 'conflict') row.choice = choice; }
function reload() { window.location.reload(); }
async function compare() {
  busy.value = true; phase.value = 'scan'; error.value = ''; result.value = undefined; rows.value = undefined; completed.value = 0; limit.value = 200;
  controller.value = new AbortController();
  try {
    scanEndpoint = props.settings.endpoint; scanToken = props.settings.token;
    desktop?.dispose(); desktop = new DesktopStorage({ ...props.settings }); await desktop.prepareSync();
    browser ??= new BrowserStorage(); await browser.init();
    const compared = await compareStorage(browser, desktop, path => { currentPath.value = path; completed.value++; }, controller.value.signal);
    rememberDesktopConnection(props.settings);
    rows.value = compared;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
async function run() {
  if (!browser || !desktop || !actions.value.length) return;
  busy.value = true; phase.value = 'sync'; error.value = ''; completed.value = 0; controller.value = new AbortController();
  try {
    if (scanEndpoint !== props.settings.endpoint || scanToken !== props.settings.token) throw new Error('连接设置已改变，请重新比较。');
    if (!paused) { await storage.pauseForSync(); paused = true; }
    emit('locked');
    result.value = await executeSync(actions.value, browser, desktop, (done, path) => { completed.value = done; currentPath.value = path; }, controller.value.signal);
    // Keep editors paused after even partial/uncertain writes until a reload.
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
</script>

<style scoped>
.sync-panel { border-top: 1px solid #dddbea; margin-top: 16px; padding: 16px 0; }
.sync-panel h3 { margin: 0; font-size: 18px; }
.sync-panel label { display: grid; gap: 6px; margin: 12px 0; }
.sync-panel .sync-check { display: flex; align-items: flex-start; gap: 8px; font-weight: 400; }
.sync-check input { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 4px; }
.sync-panel select { max-width: 100%; min-height: 34px; padding: 5px; border: 1px solid #cbd2e3; border-radius: 6px; background: white; color: #263650; }
.sync-panel button { padding: 8px 10px; border: 1px solid #cbd2e3; border-radius: 7px; color: #35476b; background: #f5f6fb; font: inherit; cursor: pointer; }
.sync-panel button:disabled { opacity: .5; cursor: default; }
.sync-panel .sync-primary { background: #6554c0; border-color: #6554c0; color: white; }
.sync-buttons, .sync-summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.sync-summary span { background: #f0eff9; padding: 4px 8px; border-radius: 6px; }
.sync-table { max-height: 300px; overflow: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; text-align: left; }
td, th { border-bottom: 1px solid #e6e7ef; padding: 8px 4px; }
th { position: sticky; top: 0; background: white; }
.sync-path { overflow-wrap: anywhere; }
td:first-child { max-width: 210px; }
.sync-error { color: #b72c2c; overflow-wrap: anywhere; }
.sync-note { font-size: 12px; color: #60708d; }
.sync-result { padding: 12px; background: #f3f4fa; border-radius: 8px; margin-top: 12px; }
</style>
