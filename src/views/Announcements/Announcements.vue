<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { announcements, indexLoading, indexFailed, isUnread, markRead, refreshAnnouncements, fetchAnnouncement, announcementUrl } from "@/services/announcements";
import { renderAnnouncement } from "@/services/announcements/markdown";
const { t } = useI18n({ useScope: "global" });
const selectedId = ref("");
const selected = computed(() => announcements.value.find(item => item.id === selectedId.value) ?? announcements.value[0]);
const html = ref("");
const contentLoading = ref(false);
const contentFailed = ref(false);
const retry = ref(0);
const reader = ref<HTMLElement | null>(null);
watch([selected, retry], async ([item], _, cleanup) => {
  html.value = "";
  contentFailed.value = false;
  contentLoading.value = false;
  if (!item) return;
  const controller = new AbortController();
  let cancelled = false;
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  cleanup(() => { cancelled = true; controller.abort(); window.clearTimeout(timeout); });
  contentLoading.value = true;
  try {
    const source = await fetchAnnouncement(item, controller.signal);
    if (cancelled) return;
    html.value = renderAnnouncement(source, announcementUrl(item));
    markRead(item);
    await nextTick();
    if (!cancelled) reader.value?.scrollTo({ top: 0 });
  } catch {
    if (!cancelled) contentFailed.value = true;
  } finally {
    window.clearTimeout(timeout);
    if (!cancelled) contentLoading.value = false;
  }
}, { immediate: true });
onMounted(() => { void refreshAnnouncements(); });
</script>
<template>
  <div class="announcements-page">
    <aside class="announcement-list" :aria-label="t('announcements.list')">
      <header class="list-header">
        <h1>{{ t('announcements.title') }}</h1>
        <button type="button" :disabled="indexLoading" @click="refreshAnnouncements(true)">{{ t('announcements.refresh') }}</button>
      </header>
      <div v-if="indexFailed" class="status" role="alert">
        <p>{{ t('announcements.indexError') }}</p>
        <button type="button" :disabled="indexLoading" @click="refreshAnnouncements(true)">{{ t('announcements.retry') }}</button>
      </div>
      <p v-else-if="indexLoading && !announcements.length" class="status" role="status">{{ t('announcements.loading') }}</p>
      <p v-else-if="!announcements.length" class="status">{{ t('announcements.empty') }}</p>
      <ol>
        <li v-for="item in announcements" :key="item.id">
          <button type="button" class="announcement-item" :class="{ selected: selected?.id === item.id }"
            :aria-current="selected?.id === item.id ? 'true' : undefined" @click="selectedId = item.id">
            <span class="item-title">{{ item.title }} <span v-if="isUnread(item)" class="item-dot" :aria-label="t('announcements.unread')"></span></span>
            <time :datetime="item.date">{{ item.date }}</time>
          </button>
        </li>
      </ol>
    </aside>
    <section ref="reader" class="announcement-reader" :aria-label="t('announcements.content')" :aria-busy="contentLoading">
      <template v-if="selected">
        <header class="article-header"><h2>{{ selected.title }}</h2><time :datetime="selected.date">{{ selected.date }}</time></header>
        <p v-if="contentLoading" class="status" role="status">{{ t('announcements.loading') }}</p>
        <div v-else-if="contentFailed" class="status" role="alert">
          <p>{{ t('announcements.contentError') }}</p>
          <button type="button" @click="retry++">{{ t('announcements.retry') }}</button>
        </div>
        <article v-else class="markdown-body" v-html="html"></article>
      </template>
      <p v-else class="status">{{ t(indexLoading ? 'announcements.loading' : indexFailed ? 'announcements.indexError' : 'announcements.empty') }}</p>
    </section>
  </div>
</template>
<style scoped>
.announcements-page { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 18px; padding: 12px; box-sizing: border-box; text-align: left; overflow: hidden; }
.announcement-list, .announcement-reader { min-width: 0; min-height: 0; overflow: auto; border: 1px solid #d9d4ee; border-radius: 14px; background: #ffffffcf; }
.list-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 20px 16px; border-bottom: 1px solid #e8e3f3; }
.list-header h1 { margin: 0; font-size: 20px; }
button { font: inherit; color: #574a98; background: #f0ecfc; border: 1px solid #d9d1ee; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:focus-visible { outline: 2px solid #887bd7; outline-offset: -2px; }
button:disabled { opacity: .5; cursor: wait; }
ol { list-style: none; padding: 10px; margin: 0; }
li + li { margin-top: 6px; }
.announcement-item { display: block; width: 100%; padding: 16px 12px; text-align: left; border: 1px solid transparent; background: transparent; color: #35476b; overflow-wrap: anywhere; }
.announcement-item:hover { background: #f6f3ff; }
.announcement-item.selected { background: #ede8fc; border-color: #c7b9ef; }
.item-title { display: block; font-weight: 600; line-height: 1.6; }
.item-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #df3f55; vertical-align: middle; margin-left: 4px; }
time { display: block; margin-top: 8px; color: #758099; font-size: 13px; }
.announcement-reader { padding: 28px clamp(18px, 4vw, 56px); user-select: text; -webkit-user-select: text; }
.article-header { padding-bottom: 20px; border-bottom: 1px solid #e8e3f3; margin-bottom: 24px; }
.article-header h2 { margin: 0; font-size: 26px; line-height: 1.5; overflow-wrap: anywhere; }
.status { padding: 16px; color: #758099; line-height: 1.7; }
.markdown-body { line-height: 1.85; overflow-wrap: anywhere; color: #35415d; }
.markdown-body :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.markdown-body :deep(pre) { overflow-x: auto; padding: 16px; border-radius: 8px; background: #f0eef7; line-height: 1.6; }
.markdown-body :deep(code) { background: #f0eef7; border-radius: 4px; padding: 2px 5px; }
.markdown-body :deep(pre code) { padding: 0; }
.markdown-body :deep(blockquote) { margin-left: 0; padding: 4px 18px; border-left: 3px solid #a18bd1; background: #f6f3fb; }
.markdown-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.markdown-body :deep(th), .markdown-body :deep(td) { padding: 8px 12px; border: 1px solid #d9d4ee; }
.markdown-body :deep(a) { color: #6652b1; text-decoration: underline; }
@media (max-width: 680px) {
  .announcements-page { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(120px, 32%) minmax(0, 1fr); gap: 10px; padding: 4px; }
  .list-header { padding: 10px 14px; }
  .announcement-item { padding: 10px; }
  .announcement-reader { padding: 20px 16px; }
  .article-header h2 { font-size: 21px; }
}
</style>
