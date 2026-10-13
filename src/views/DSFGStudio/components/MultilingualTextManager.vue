<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { createOss } from "@/utils/oss";
import StudioSelectField from "./StudioSelectField.vue";
import multilingualTextData from "./multilingualTextData.json";

const search = ref("");
const selectedLanguage = ref("");
const downloading = ref<string | null>(null);
const downloadError = ref("");
const downloadNotice = ref("");
const oss = createOss("DSFGStudio/SaveI18nFile", "https://oss.xiaomol444.xyz/ugc-tool-data");
const languages = multilingualTextData.headers.slice(2);
const columns = computed(() => multilingualTextData.headers
  .map((label, index) => ({ label, index }))
  .filter(column => column.index < 2 || !selectedLanguage.value || column.label === selectedLanguage.value));
const rows = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return multilingualTextData.rows.filter(row => !query || row.some(value => value.toLocaleLowerCase().includes(query)));
});
let downloadController: AbortController | null = null;

async function downloadLanguageFile(filename: "AllLanguage.csv" | "ChineseLanguage.csv") {
  if (downloading.value) return;
  downloading.value = filename;
  downloadError.value = "";
  downloadNotice.value = "";
  const controller = new AbortController();
  downloadController = controller;
  try {
    const response = await fetch(oss.path(filename), { signal: controller.signal });
    if (!response.ok) throw new Error(`文件下载失败（${response.status}），请稍后重试。`);
    const blob = await response.blob();
    if (controller.signal.aborted) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try {
      link.click();
      downloadNotice.value = `已开始下载 ${filename}。`;
    } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (reason) {
    if (!controller.signal.aborted) {
      downloadError.value = reason instanceof Error && reason.message.startsWith("文件下载失败")
        ? reason.message : "无法下载语言文件，请检查网络后重试。";
    }
  } finally {
    if (downloadController === controller) downloadController = null;
    downloading.value = null;
  }
}

onBeforeUnmount(() => downloadController?.abort());
</script>

<template>
  <section class="language-manager" aria-labelledby="language-manager-title">
    <header class="language-header">
      <div>
        <h2 id="language-manager-title">多语言文本管理</h2>
        <p>查看对话与任务文本，下载语言文件。</p>
      </div>
      <div class="download-actions" :aria-busy="!!downloading">
        <button type="button" class="primary" :disabled="!!downloading" @click="downloadLanguageFile('AllLanguage.csv')">
          {{ downloading === 'AllLanguage.csv' ? '下载中…' : '下载所有语言文件' }}
        </button>
        <button type="button" :disabled="!!downloading" @click="downloadLanguageFile('ChineseLanguage.csv')">
          {{ downloading === 'ChineseLanguage.csv' ? '下载中…' : '仅下载简体中文语言文件' }}
        </button>
      </div>
    </header>

    <p v-if="downloadError" class="download-error" role="alert">{{ downloadError }}</p>
    <p v-if="downloadNotice" class="download-notice" role="status">{{ downloadNotice }}</p>

    <div class="language-card">
      <div class="table-toolbar">
        <label class="search-field" for="language-text-search">
          <span>搜索文本</span>
          <input id="language-text-search" v-model="search" type="search" placeholder="搜索文本映射 ID 或任意语言文本" autocomplete="off" />
        </label>
        <label class="language-field" for="language-column-select">
          <span>显示语言</span>
          <StudioSelectField id="language-column-select" v-model="selectedLanguage" aria-label="显示语言">
            <option value="">全部语言（{{ languages.length }} 种）</option>
            <option v-for="language in languages" :key="language" :value="language">{{ language }}</option>
          </StudioSelectField>
        </label>
        <p class="table-count">{{ rows.length }} / {{ multilingualTextData.rows.length }} 条文本</p>
      </div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="多语言文本表格，可横向滚动查看所有语言">
        <table>
          <caption class="visually-hidden">多语言文本，共 {{ multilingualTextData.rows.length }} 条文本、{{ languages.length }} 种语言。</caption>
          <thead>
            <tr>
              <th v-for="column in columns" :key="column.index" scope="col" :class="{ 'mapping-id': column.index === 0, 'translation-flag': column.index === 1 }">{{ column.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row[0]">
              <td v-for="column in columns" :key="column.index" :class="{ 'mapping-id': column.index === 0, 'translation-flag': column.index === 1 }">
                <code v-if="column.index === 0">{{ row[column.index] }}</code>
                <span v-else-if="column.index === 1" class="translation-value">{{ row[column.index] }}</span>
                <template v-else>{{ row[column.index] }}</template>
              </td>
            </tr>
            <tr v-if="!rows.length"><td :colspan="columns.length" class="empty-result">未找到匹配的文本，请尝试其他关键词。</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.language-manager { box-sizing: border-box; width: 100%; min-width: 0; height: 100%; padding: 8px 10px 22px; overflow-y: auto; color: #405477; }
.language-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px 24px; margin-bottom: 18px; }
h2 { margin: 0; color: #394e7e; font-size: 18px; font-weight: 600; line-height: 1.6; }
.language-header p { margin: 4px 0 0; color: #8290ad; font-size: 13px; line-height: 1.7; }
.download-actions { display: flex; flex-wrap: wrap; gap: 10px; }
button { min-height: 36px; padding: 8px 14px; border: 1px solid #d6dbf5; border-radius: 7px; background: #ffffffc9; color: #6554c9; font: inherit; font-size: 13px; cursor: pointer; }
button.primary { border-color: #078cff; background: linear-gradient(110deg, #1683ff, #00a7f2); color: #fff; box-shadow: 0 2px 5px #078cff1a; }
button:hover:not(:disabled) { filter: brightness(.97); }
button:disabled { opacity: .6; cursor: wait; }
button:focus-visible, input:focus-visible, .table-scroll:focus-visible { outline: 2px solid #5aaeff; outline-offset: 2px; }
.download-error, .download-notice { margin: 0 0 14px; padding: 10px 14px; border-radius: 7px; font-size: 13px; line-height: 1.6; }
.download-error { color: #aa4055; background: #fff0f3; }
.download-notice { color: #438472; background: #edf8f5; }
.language-card { min-width: 0; border: 1px solid var(--studio-line, #d6dbf5); border-top: 3px solid var(--studio-cyan, #36c4df); border-radius: 10px; background: #ffffffeb; box-shadow: 0 3px 12px #7283c10b; overflow: hidden; }
.table-toolbar { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 14px 18px; padding: 20px; border-bottom: 1px solid #e3e7f7; }
.table-toolbar label { display: grid; min-width: 0; gap: 7px; font-size: 13px; line-height: 1.5; }
.search-field { flex: 1 1 280px; }
.language-field { flex: 0 1 200px; }
.table-toolbar input { box-sizing: border-box; width: 100%; height: 36px; padding: 8px 10px; border: 1px solid #d6dbf5; border-radius: 7px; background: #f8faff; color: #405477; font: inherit; font-size: 13px; }
.table-toolbar input::placeholder { color: #8290ad; }
.table-count { margin: 0 0 8px; color: #8290ad; font-size: 12px; line-height: 20px; white-space: nowrap; }
.table-scroll { width: 100%; max-width: 100%; max-height: 660px; overflow: auto; scrollbar-color: #c7cbed #f4f5fc; scrollbar-width: thin; }
table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; line-height: 1.7; text-align: left; }
th, td { box-sizing: border-box; min-width: 180px; max-width: 220px; padding: 14px 16px; border-right: 1px solid #edf0fa; border-bottom: 1px solid #e7eaf6; overflow-wrap: anywhere; background: #fff; }
th { position: sticky; top: 0; z-index: 2; color: #536490; background: #f3f5ff; font-weight: 600; white-space: nowrap; }
tbody tr:nth-child(even) td { background: #fafbff; }
tbody tr:hover td { background: #f1f7ff; }
tr:last-child td { border-bottom: 0; }
th:last-child, td:last-child { border-right: 0; }
.mapping-id { position: sticky; left: 0; z-index: 1; min-width: 240px; max-width: 270px; border-right-color: #dce2f7; box-shadow: 3px 0 7px #6576ad08; }
th.mapping-id { z-index: 3; }
.mapping-id code { color: #536490; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.translation-flag { min-width: 126px; max-width: 126px; }
.translation-value { display: inline-block; padding: 1px 8px; border-radius: 5px; color: #4e7b91; background: #e9f6fb; font-size: 11px; }
.empty-result { padding: 36px 20px; color: #8290ad; text-align: left; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 720px) {
  .language-manager { padding: 8px 4px 16px; }
  .language-header { align-items: flex-start; }
  .download-actions { width: 100%; }
  .download-actions button { flex: 1 1 210px; }
  .table-toolbar { padding: 14px; }
  .language-field { flex-basis: 100%; }
  .table-count { margin-bottom: 0; }
  th, td { padding: 12px; }
  .mapping-id { min-width: 200px; max-width: 210px; }
}
</style>
