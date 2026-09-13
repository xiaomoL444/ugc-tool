<template>
  <section ref="panel" class="control-template-library" role="dialog" aria-label="控件模板库" tabindex="-1" @pointerdown.stop @keydown.esc.stop.prevent="emit('close')">
    <header>
      <strong>控件模板 <small>{{ assets.length }}</small></strong>
      <input v-model="search" type="search" placeholder="搜索名称或索引" aria-label="搜索控件模板" />
      <button :disabled="loading" @click="fileInput?.click()">{{ loading ? '正在解析…' : '导入控件模板 GIA' }}</button>
      <button v-if="selectable" @click="emit('select', null)">清除引用</button>
      <button aria-label="关闭控件模板库" @click="emit('close')">×</button>
      <input ref="fileInput" class="file-input" type="file" accept=".gia,application/octet-stream" @change="readFile" />
    </header>
    <p class="library-note">{{ selectable ? '点击模板即可引用。' : '选择模板可修改名称和索引。' }}模板随当前编辑文件保存，索引需与游戏中的配置一致。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="library-body">
      <div class="template-grid">
        <article v-for="asset in filteredAssets" :key="asset.id" class="template-card" :class="{ selected: asset.index === selectedIndex }">
          <button class="template-select" :aria-label="`引用模板 ${asset.name}，索引 ${asset.index}`" @click="selectable ? emit('select', asset.index) : editAsset(asset)">
            <div class="thumbnail"><ControlTemplatePreview :asset="asset" :width="120" :height="88" :device-index="deviceIndex" fit /></div>
            <b :title="asset.name">{{ asset.name }}</b><small>#{{ asset.index }} · {{ asset.devices[deviceIndex]?.length ?? 0 }} 个控件</small>
          </button>
          <button class="edit-template" :aria-label="`设置模板 ${asset.name}`" @click="editAsset(asset)">设置索引</button>
        </article>
        <p v-if="!filteredAssets.length" class="empty-state">{{ assets.length ? '没有匹配的模板' : '还没有控件模板，点击右上方导入 GIA。' }}</p>
      </div>
      <form v-if="draft" class="template-draft" @submit.prevent="saveDraft">
        <strong>{{ editing ? '设置控件模板' : '导入控件模板' }}</strong>
        <div class="draft-preview"><ControlTemplatePreview :asset="draft" :width="200" :height="112" :device-index="deviceIndex" fit /></div>
        <label>名称<input v-model="draftName" aria-label="模板名称" required /></label>
        <label>索引<input v-model="draftIndex" aria-label="模板索引" type="number" min="0" max="2147483647" step="1" required /></label>
        <small>{{ draft.sourceName }} · {{ draft.devices[deviceIndex]?.length }} 个控件</small>
        <p v-if="draftError" class="error" role="alert">{{ draftError }}</p>
        <details v-if="draft.warnings.length"><summary>导入提示（{{ draft.warnings.length }}）</summary><p v-for="warning in draft.warnings" :key="warning">{{ warning }}</p></details>
        <div class="draft-actions"><button type="button" @click="draft = null">取消</button><button type="submit" class="primary" :disabled="!!draftError">{{ editing ? '保存设置' : '确认导入' }}</button></div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import ControlTemplatePreview from "./ControlTemplatePreview.vue";
import { nextTemplateIndex, readControlTemplate, templateIndexError, type ControlTemplateAsset } from "./controlTemplates";

const props = withDefaults(defineProps<{ assets: ControlTemplateAsset[]; selectedIndex?: number | null; selectable: boolean; deviceIndex: number }>(), { selectedIndex: null });
const emit = defineEmits<{ (event: "close"): void; (event: "select", index: number | null): void; (event: "save", asset: ControlTemplateAsset): void }>();
const panel = ref<HTMLElement | null>(null), fileInput = ref<HTMLInputElement | null>(null);
const search = ref(""), error = ref(""), loading = ref(false);
const draft = ref<ControlTemplateAsset | null>(null), draftName = ref(""), draftIndex = ref<number | string>(1), editing = ref(false);
const filteredAssets = computed(() => props.assets.filter(asset => `${asset.name} ${asset.index} ${asset.sourceName}`.toLowerCase().includes(search.value.trim().toLowerCase())).slice().sort((a, b) => a.index - b.index));
const draftError = computed(() => !draftName.value.trim() ? "请填写模板名称" : String(draftIndex.value).trim() === "" ? "请填写模板索引"
  : templateIndexError(Number(draftIndex.value), props.assets, editing.value ? draft.value?.id : undefined));
let disposed = false;
let previousFocus: HTMLElement | null = null;
onMounted(() => { previousFocus = document.activeElement as HTMLElement | null; panel.value?.focus(); });
onBeforeUnmount(() => { disposed = true; if (previousFocus?.isConnected) previousFocus.focus(); });
function editAsset(asset: ControlTemplateAsset) {
  draft.value = asset; draftName.value = asset.name; draftIndex.value = asset.index; editing.value = true; error.value = "";
}
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  loading.value = true; error.value = "";
  try {
    const bytes = await file.arrayBuffer();
    if (disposed) return;
    const asset = readControlTemplate(bytes, file.name, nextTemplateIndex(props.assets));
    editAsset(asset); editing.value = false;
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : "无法读取控件模板"; }
  finally { if (!disposed) loading.value = false; }
}
function saveDraft() {
  if (!draft.value || draftError.value) return;
  emit("save", { ...draft.value, name: draftName.value.trim(), index: Number(draftIndex.value) });
  search.value = ""; draft.value = null;
}
</script>

<style scoped>
.control-template-library { position: absolute; inset: auto 0 0; z-index: 100; height: min(450px, 55%); min-height: 290px; display: flex; flex-direction: column; color: #e4e7ef; background: #292e39; border-top: 1px solid #58647b; box-shadow: 0 -8px 28px #0005; outline: none; font-size: 12px; }
header { display: flex; align-items: center; gap: 10px; padding: 12px 16px 4px; }
header strong { white-space: nowrap; } header strong small { color: #98a7c0; margin-left: 5px; }
header input[type=search] { margin-left: auto; width: 220px; }
button, input { border: 1px solid #50596b; border-radius: 5px; background: #343b49; color: inherit; font: inherit; padding: 6px 10px; }
button { cursor: pointer; } button:hover { background: #444f63; } button:focus-visible, input:focus-visible { outline: 2px solid #9dbbff; outline-offset: 1px; } button:disabled { opacity: .5; cursor: default; }
.file-input { display: none; }
.library-note { margin: 6px 16px 10px; color: #a6b2c7; font-size: 11px; }
.library-body { display: flex; flex: 1; min-height: 0; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fill, 146px); gap: 12px; align-content: start; flex: 1; min-width: 0; overflow: auto; padding: 4px 16px 16px; }
.template-card { border: 1px solid #495365; border-radius: 6px; overflow: hidden; background: #222833; }
.template-card.selected { border-color: #95b2ff; box-shadow: 0 0 0 1px #95b2ff; }
.template-select { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; padding: 10px 12px; border: 0; border-radius: 0; background: transparent; }
.thumbnail { width: 120px; height: 88px; background: repeating-conic-gradient(#333a46 0% 25%, #2c323d 0% 50%) 50% / 16px 16px; }
.template-select b { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; } .template-select small { color: #aebbd0; }
.edit-template { width: 100%; border: 0; border-top: 1px solid #495365; border-radius: 0; padding: 4px; font-size: 10px; }
.empty-state { grid-column: 1 / -1; color: #aebbd0; padding: 30px 12px; }
.template-draft { width: 228px; flex: none; padding: 4px 16px 16px; border-left: 1px solid #495365; overflow: auto; }
.draft-preview { width: 200px; height: 112px; margin: 8px auto; background: #222833; }
.template-draft label { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
.template-draft input { width: 100%; min-width: 0; flex: 1; box-sizing: border-box; }
.template-draft small { display: block; color: #a6b2c7; overflow-wrap: anywhere; }
.template-draft details { margin-top: 8px; color: #dac193; font-size: 11px; }
.draft-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.primary { background: #496cbd; border-color: #6d8ed6; }
.error { color: #ffacae; margin: 5px 16px; font-size: 11px; } .template-draft .error { margin: 5px 0; }
</style>
