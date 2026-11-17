<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { createOss } from "@/utils/oss";

interface ResourceUpdate {
  date: string | null;
  isBeta: boolean;
  latestGiVersion: string | null;
}

const props = defineProps<{ entries: { id: string; title: string; index: string }[] }>();
const { t, locale } = useI18n({ useScope: "global" });
const dialog = ref<HTMLDialogElement | null>(null);
const updates = ref<Partial<Record<string, ResourceUpdate>>>({});
const rows = computed(() => props.entries.map(({ id, title }) => ({ id, title, update: updates.value[id] })));
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: "medium" }));
const oss = createOss("");
let activeRequest: AbortController | undefined;

function cancelRequests() {
  activeRequest?.abort();
  activeRequest = undefined;
}

async function refresh() {
  cancelRequests();
  const request = new AbortController();
  activeRequest = request;
  updates.value = {};
  const revision = Date.now();
  const timeout = window.setTimeout(() => request.abort(), 10000);
  try {
    await Promise.all(props.entries.map(async ({ id, index }) => {
      let update: ResourceUpdate = { date: null, isBeta: false, latestGiVersion: null };
      try {
        const response = await fetch(`${oss.path(index)}?_t=${revision}`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok || activeRequest !== request) return;

        const modified = response.headers.get("Last-Modified");
        const timestamp = modified ? Date.parse(modified) : NaN;
        update = {
          date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
          isBeta: response.headers.get("X-Ugc-Data-Source") === "beta",
          latestGiVersion: null,
        };
        // Show the date as soon as headers arrive, even for large indexes.
        updates.value[id] = update;

        const catalog = await response.json() as { latestGiVersion?: unknown } | null;
        const version = catalog?.latestGiVersion;
        if (typeof version === "string" && version.trim()) {
          update = { ...update, latestGiVersion: version.trim() };
        }
      } catch {
        // Keep the header date if the body could not be read.
      } finally {
        if (activeRequest === request) updates.value[id] = update;
      }
    }));
  } finally {
    window.clearTimeout(timeout);
    if (activeRequest === request) activeRequest = undefined;
  }
}

function show() {
  if (!dialog.value || dialog.value.open) return;
  dialog.value.showModal();
  void refresh();
}

function closeOnBackdrop(event: MouseEvent) {
  if (!dialog.value || event.target !== dialog.value) return;
  const { left, right, top, bottom } = dialog.value.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
    dialog.value.close();
  }
}

function onClose() {
  if (!dialog.value?.open) cancelRequests();
}

onBeforeUnmount(cancelRequests);
defineExpose({ show });
</script>

<template>
  <Teleport to="body">
    <dialog id="resource-updates-dialog" ref="dialog" class="resource-updates-dialog"
      aria-labelledby="resource-updates-title" aria-describedby="resource-updates-note"
      @close="onClose" @click="closeOnBackdrop" @keydown.stop @keyup.stop>
      <div class="resource-updates-body">
        <header class="dialog-header">
          <h2 id="resource-updates-title">{{ t('homePage.resourceUpdates.title') }}</h2>
          <button type="button" class="dialog-close" autofocus :aria-label="t('homePage.resourceUpdates.close')"
            @click="dialog?.close()">×</button>
        </header>
        <p id="resource-updates-note">{{ t('homePage.resourceUpdates.note') }}</p>
        <dl class="resource-dates" aria-live="polite">
          <div v-for="{ id, title, update } in rows" :key="id" class="resource-date-row">
            <dt>{{ title }}</dt>
            <dd>
              <span v-if="update?.isBeta" class="resource-date-source">Beta</span>
              <time v-if="update?.date" :datetime="update.date">{{ dateFormat.format(new Date(update.date)) }}</time>
              <span v-else>{{ t(update ? 'homePage.resourceUpdates.unavailable' : 'homePage.resourceUpdates.loading') }}</span>
              <span v-if="update?.latestGiVersion" class="resource-date-version"
                :title="t('homePage.resourceUpdates.latestVersion')">{{ update.latestGiVersion }}</span>
            </dd>
          </div>
        </dl>
        <footer class="dialog-footer">
          <button type="button" @click="refresh">{{ t('homePage.resourceUpdates.refresh') }}</button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.resource-updates-dialog {
  box-sizing: border-box;
  width: min(520px, calc(100% - 32px));
  max-width: none;
  max-height: calc(100% - 32px);
  padding: 0;
  border: 1px solid #d5dcf8;
  border-radius: 16px;
  background: #f8f9ff;
  color: #253455;
  font-family: var(--app-font-family);
  box-shadow: 0 24px 70px #24345b42;
}
.resource-updates-dialog::backdrop {
  background: #1e264566;
  backdrop-filter: blur(3px);
}
.resource-updates-body {
  padding: clamp(16px, 5vw, 24px);
}
.dialog-header,
.resource-date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dialog-header h2 {
  margin: 0;
  font-size: 21px;
}
.resource-updates-body p {
  margin: 8px 0 16px;
  color: #526482;
  font-size: 14px;
  line-height: 1.6;
}
.resource-dates {
  margin: 0;
  border: 1px solid #e0e5f7;
  border-radius: 10px;
  background: #fff;
}
.resource-date-row {
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 11px 14px;
  overflow-wrap: anywhere;
}
.resource-date-row + .resource-date-row {
  border-top: 1px solid #e0e5f7;
}
.resource-date-row dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px 8px;
  margin: 0 0 0 auto;
  color: #526482;
  font-size: 14px;
}
.resource-date-source,
.resource-date-version {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12px;
}
.resource-date-source {
  background: #eef0ff;
  color: #41558c;
}
.resource-date-version {
  background: #e4edf7;
  color: #304861;
  font-weight: 600;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.resource-updates-dialog button {
  padding: 6px 12px;
  border: 1px solid #d5dcf8;
  border-radius: 8px;
  background: #fff;
  color: #354a84;
  font: inherit;
  cursor: pointer;
}
.resource-updates-dialog button:hover {
  background: #eef0ff;
}
.resource-updates-dialog button:focus-visible {
  outline: 2px solid #6279d9;
  outline-offset: 2px;
}
.resource-updates-dialog .dialog-close {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 24px;
  line-height: 1;
}
</style>
