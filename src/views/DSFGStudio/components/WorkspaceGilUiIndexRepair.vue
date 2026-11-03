<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { GilUiIndexRepairResult } from "./gilUiIndexRepair";

const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const fileInput = ref<HTMLInputElement>();
const busy = ref(false), error = ref("");
const result = ref<Omit<GilUiIndexRepairResult, "bytes">>();
const fileName = ref(""), downloadUrl = ref("");
const changedCount = computed(() => result.value?.rows.filter(row => row.changed).length ?? 0);
function clearDownload() {
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
  downloadUrl.value = "";
}
onBeforeUnmount(clearDownload);
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file || busy.value || props.disabled) return;
  clearDownload(); result.value = undefined; error.value = "";
  busy.value = true; emit("busy", true);
  try {
    if (!/\.gil$/i.test(file.name)) throw new Error("请选择 .gil 存档文件。");
    if (file.size > 100 * 1024 * 1024) throw new Error("GIL 文件超过 100 MB，请选择较小的存档。");
    const { repairGilUiIndices } = await import("./gilUiIndexRepair");
    const { bytes, ...preview } = repairGilUiIndices(await file.arrayBuffer());
    if (preview.rows.some(row => row.changed)) {
      downloadUrl.value = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }));
    }
    fileName.value = file.name.replace(/\.gil$/i, "") + "_已修复索引.gil";
    // Retain only the preview; the download Blob owns the repaired archive bytes.
    result.value = preview;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; emit("busy", false); }
}
</script>

<template>
  <section class="ui-index-repair" aria-label="自动修复索引" :aria-busy="busy">
    <div class="repair-bar">
      <div><strong>自动修复索引</strong><p>读取 GIL 中的确认提示、对话 UI 索引，修复五个客户端脚本中的对应变量。文件在本机处理，修复后下载新存档。</p></div>
      <button type="button" :disabled="busy || disabled" @click="fileInput?.click()">{{ busy ? '修复中…' : '读取 GIL 并修复' }}</button>
      <input ref="fileInput" type="file" accept=".gil" hidden aria-label="选择修复索引用 GIL 存档" @change="readFile" />
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="result">
      <p class="notice" role="status">已检查 {{ result.rows.length }} 项脚本变量，{{ changedCount ? `${changedCount} 项索引已修复，请下载新存档并在千星编辑器中打开。` : '匹配到的索引均正确，无需修复。' }}</p>
      <p v-for="control in result.ui" :key="control.name" class="control-index">{{ control.name }}：<code>{{ control.index }}</code></p>
      <p v-for="warning in result.warnings" :key="warning" class="warning" role="alert">{{ warning }}</p>
      <details>
        <summary>查看脚本变量修复明细</summary>
        <ul><li v-for="row in result.rows" :key="`${row.script}:${row.variable}`"><strong>{{ row.script }}</strong><small>/{{ row.path.replace(/^\/+/, '') }}</small><span>{{ row.variable }}：<code>{{ row.previous.join(' / ') }}</code> → <code>{{ row.index }}</code>{{ row.changed ? '（已修复）' : '（已正确）' }}</span></li></ul>
      </details>
      <a v-if="downloadUrl" :href="downloadUrl" :download="fileName">下载修复后的 GIL</a>
    </template>
  </section>
</template>

<style scoped>
.ui-index-repair { margin-top: 12px; font-size: 12px; line-height: 1.7; color: #526588; }
.repair-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px; border-radius: 8px; background: #eef5fc; }
strong { font-size: 13px; color: #34445b; }
p { margin: 4px 0 0; overflow-wrap: anywhere; }
button, a { flex-shrink: 0; padding: 7px 12px; border: 1px solid #c8d5e5; border-radius: 6px; background: #fff; color: #345f91; font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid #5088ca; outline-offset: 2px; }
a { display: inline-block; margin-top: 12px; background: #2877c7; border-color: #2877c7; color: #fff; text-decoration: none; }
.notice { margin-top: 10px; padding: 10px; background: #f1f6fc; }
.control-index { padding: 0 10px; }
.error, .warning { margin-top: 10px; padding: 10px; background: #fff1f2; color: #a43d42; }
summary { margin-top: 10px; cursor: pointer; color: #345f91; }
ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
li { padding: 10px; border: 1px solid #e4ebf3; border-radius: 6px; overflow-wrap: anywhere; }
small, li span { display: block; } small { color: #8090a5; }
@media (max-width: 600px) { .repair-bar { align-items: flex-start; flex-direction: column; } }
</style>
