<template>
  <section ref="panel" class="primitive-resource-library" role="dialog" :aria-label="t('clientUIAnimationEditor.ui.primitives.fileResources')" tabindex="-1" @pointerdown.stop @keydown.esc.stop.prevent="emit('close')">
    <header><strong>{{ t('clientUIAnimationEditor.ui.primitiveResources.title') }}<small>{{ assets.length }}</small></strong><input v-model="search" type="search" :aria-label="t('clientUIAnimationEditor.ui.images.searchResourceLabel')" :placeholder="t('clientUIAnimationEditor.ui.primitives.searchCurrentFileImages')" /><button :disabled="reading || batchBusy" @click="fileInput?.click()">{{ reading ? t('clientUIAnimationEditor.ui.primitiveResources.importing') : t('clientUIAnimationEditor.ui.primitives.importImage') }}</button><button :disabled="batchBusy" @click="addEmpty">{{ t('clientUIAnimationEditor.ui.primitiveResources.addImageUrl') }}</button><button :aria-label="t('clientUIAnimationEditor.ui.primitiveResources.closePanel')" @click="emit('close')">×</button></header>
    <p class="library-note">{{ t('clientUIAnimationEditor.ui.primitives.libraryStorageHint') }}</p>
    <div class="batch-actions"><button class="primary" :disabled="batchBusy || reading || singleBusy || !missingCount" @click="generateMissing">{{ t('clientUIAnimationEditor.ui.primitives.generateMissing', { missingCount: missingCount }) }}</button><button v-if="batchBusy" :disabled="batchCancelling" @click="cancelBatch">{{ batchCancelling ? t('clientUIAnimationEditor.ui.primitives.cancelling') : t('clientUIAnimationEditor.ui.primitives.cancelBatch') }}</button><span v-if="batchStatus" role="status" aria-live="polite">{{ batchStatus }}</span></div>
    <progress v-if="batchBusy" class="batch-progress" :aria-label="t('clientUIAnimationEditor.ui.primitiveResources.batchProgress')" :value="batchProgress" :max="batchTotal" />
    <details v-if="batchFailures.length" class="batch-failures"><summary>{{ t('clientUIAnimationEditor.ui.primitiveResources.failedImageGenerationRetry', { count: batchFailures.length }) }}</summary><ul><li v-for="(failure, index) in batchFailures" :key="index">{{ failure.name }}：{{ failure.message }}</li></ul></details>
    <input ref="fileInput" class="file-input" type="file" accept="image/*" multiple @change="importFiles" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="library-body">
      <div class="resource-list">
        <button v-for="asset in filteredAssets" :key="asset.id" class="resource-card" :class="{ selected: asset.id === activeId }" :aria-label="t('clientUIAnimationEditor.ui.primitiveResources.configureImage', { name: asset.name })" @click="activeId = asset.id">
          <img v-if="primitiveImageSource(asset.imageUrl)" :src="primitiveImageSource(asset.imageUrl)" alt="" /><span v-else class="empty-thumbnail">▧</span>
          <b>{{ asset.name }}</b><small>{{ t('clientUIAnimationEditor.ui.primitives.resourceReferences', { count: asset.fitData ? t('clientUIAnimationEditor.ui.primitiveResources.primitiveCount', { count: asset.fitData.elements.length }) : t('clientUIAnimationEditor.ui.primitives.notFitted'), value: usage[asset.id] || 0 }) }}</small>
        </button>
        <p v-if="!filteredAssets.length" class="empty-state">{{ assets.length ? t('clientUIAnimationEditor.ui.primitiveResources.noMatchingImages') : t('clientUIAnimationEditor.ui.primitiveResources.configureFittingHint') }}</p>
      </div>
      <template v-if="activeAsset">
        <div class="resource-preview-column">
          <label>{{ t('clientUIAnimationEditor.ui.primitiveResources.name') }}<input :key="activeAsset.id" :value="activeAsset.name" :aria-label="t('clientUIAnimationEditor.ui.primitiveResources.imageName')" @change="rename(($event.target as HTMLInputElement).value)" /></label>
          <div ref="preview" class="resource-preview"><PrimitiveImage :image-url="activeAsset.imageUrl" :preview-mode="activeAsset.previewMode" :fit-data="activeAsset.fitData" :width="previewSize.width" :height="previewSize.height" /></div>
          <p>{{ activeAsset.fitData ? `${activeAsset.fitData.width} × ${activeAsset.fitData.height}` : t('clientUIAnimationEditor.ui.primitives.selectParametersHint') }}</p>
          <div class="resource-actions"><button v-if="selectable" class="primary" :disabled="batchBusy || (!activeAsset.imageUrl && !activeAsset.fitData)" @click="emit('select', activeAsset.id)">{{ t('clientUIAnimationEditor.ui.primitiveResources.useForCurrent') }}</button><button :disabled="batchBusy || !!usage[activeAsset.id]" :title="usage[activeAsset.id] ? t('clientUIAnimationEditor.ui.primitives.resourceInUse') : t('clientUIAnimationEditor.ui.primitiveResources.removeFromFileHint')" @click="emit('remove', activeAsset.id)">{{ t('clientUIAnimationEditor.ui.primitiveResources.remove') }}</button></div>
          <small>{{ t('clientUIAnimationEditor.ui.primitiveResources.parameterCoordinatesHint') }}</small>
        </div>
        <div class="resource-settings"><p v-if="batchBusy" class="library-note">{{ t('clientUIAnimationEditor.ui.primitiveResources.batchRunningHint') }}</p><PrimitiveImageSettings v-else :key="activeAsset.id" :model-value="activeAsset" :name="activeAsset.name" @busy="singleBusy = $event" @update:model-value="updateActive" /></div>
      </template>
      <div v-else class="empty-selection">{{ t('clientUIAnimationEditor.ui.primitiveResources.selectionHint') }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PrimitiveImage from "./PrimitiveImage.vue";
import PrimitiveImageSettings from "./PrimitiveImageSettings.vue";
import { primitiveImageSource } from "./primitiveControl";
import type { PrimitiveProperties } from "./primitiveData";
import type { PrimitiveImageResource } from "./primitiveResources";
import { fitMissingPrimitiveResources } from "./primitiveBatch";

const props = defineProps<{ assets: PrimitiveImageResource[]; selectedId: string | null; selectable: boolean; usage: Record<string, number> }>();
const emit = defineEmits<{ (event: "close"): void; (event: "save", asset: PrimitiveImageResource): void; (event: "remove", id: string): void; (event: "select", id: string): void }>();
const search = ref(""), error = ref<string>(''), reading = ref(false), activeId = ref(props.selectedId ?? props.assets[0]?.id ?? "");
const panel = ref<HTMLElement | null>(null), preview = ref<HTMLElement | null>(null), fileInput = ref<HTMLInputElement | null>(null);
const previewSize = ref({width: 280, height: 220});
const filteredAssets = computed(() => props.assets.filter(a => a.name.toLowerCase().includes(search.value.trim().toLowerCase())));
const activeAsset = computed(() => props.assets.find(a => a.id === activeId.value) ?? null);
const missingCount = computed(() => props.assets.filter(asset => asset.imageUrl && !asset.fitData).length);
const singleBusy = ref(false), batchBusy = ref(false), batchCancelling = ref(false), batchStatus = ref<string>('');
const batchProgress = ref(0), batchTotal = ref(1);
const batchFailures = ref<{ name: string; message: string }[]>([]);
let batchController: AbortController | null = null;
function cancelBatch() { if (batchController) { batchCancelling.value = true; batchController.abort(); } }
async function generateMissing() {
  if (batchBusy.value || singleBusy.value || reading.value || !missingCount.value) return;
  const job = new AbortController(); batchController = job;
  batchBusy.value = true; batchCancelling.value = false; batchFailures.value = [];
  batchProgress.value = 0; batchTotal.value = missingCount.value; batchStatus.value = t('clientUIAnimationEditor.ui.primitiveResources.batchPreparing');
  try {
    const { fitPrimitiveImage } = await import("./primitiveFitter");
    const result = await fitMissingPrimitiveResources(() => props.assets, fitPrimitiveImage, async asset => {
      if (disposed || job.signal.aborted) return;
      emit("save", asset); await nextTick();
    }, job.signal, ({ index, total, name, progress }) => {
      batchTotal.value = total;
      batchProgress.value = index - 1 + (progress?.phase === "fit" ? progress.done / Math.max(1, progress.total) : 0);
      const phase = !progress || progress.phase === "image" ? t('clientUIAnimationEditor.ui.primitiveResources.readImage') : progress.phase === "engine" ? t('clientUIAnimationEditor.ui.primitiveResources.loadEngine') : t('clientUIAnimationEditor.ui.primitiveFit.primitiveProgress', { done: progress.done, total: progress.total });
      batchStatus.value = t('clientUIAnimationEditor.ui.primitiveResources.batchImageProgress', { index: index, total: total, name: name, phase: phase });
    });
    if (disposed) return;
    batchFailures.value = result.failures;
    batchStatus.value = t('clientUIAnimationEditor.ui.primitives.batchResult', { value: result.cancelled ? t('clientUIAnimationEditor.ui.primitives.cancelled') : t('clientUIAnimationEditor.ui.primitiveResources.batchGenerationComplete'), generated: result.generated, count: result.failures.length, skipped: result.skipped ? t('clientUIAnimationEditor.ui.primitiveResources.skippedImagesSuffix', { skipped: result.skipped }) : '' });
  } catch (reason) {
    if (!disposed) batchStatus.value = job.signal.aborted ? t('clientUIAnimationEditor.ui.primitives.batchCancelled') : t('clientUIAnimationEditor.ui.primitives.batchFailed', { error: reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.primitives.engineLoadFailedSummary') });
  } finally {
    batchController = null; batchBusy.value = false; batchCancelling.value = false;
  }
}
let observer: ResizeObserver | null = null, disposed = false, reader: FileReader | null = null;
onMounted(() => { panel.value?.focus(); });
onBeforeUnmount(() => { disposed = true; batchController?.abort(); reader?.abort(); observer?.disconnect(); });
watch(preview, el => { observer?.disconnect(); if (!el) return; observer = new ResizeObserver(() => { previewSize.value = { width: el.clientWidth, height: el.clientHeight }; }); observer.observe(el); }, { flush: "post" });
watch(() => props.assets.map(a => a.id), ids => { if (!ids.includes(activeId.value)) activeId.value = ids[0] ?? ""; });
function updateActive(value: PrimitiveProperties) { if (activeAsset.value) emit("save", { ...value, id: activeAsset.value.id, name: activeAsset.value.name }); }
function rename(name: string) { if (activeAsset.value && name.trim()) emit("save", { ...activeAsset.value, name: name.trim() }); }
function addEmpty() {
  const asset: PrimitiveImageResource = { id: crypto.randomUUID(), name: t('clientUIAnimationEditor.ui.primitives.defaultImageName', { count: props.assets.length + 1 }), imageUrl: "", previewMode: "image", fitData: null };
  emit("save", asset); activeId.value = asset.id; search.value = "";
}
async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = "";
  if (!files.length) return;
  reading.value = true; error.value = "";
  try {
    for (const file of files) {
      if (file.size > 32 * 1024 * 1024) throw new Error(t('clientUIAnimationEditor.ui.primitives.imageTooLarge', { name: file.name }));
      const source = await new Promise<string>((resolve, reject) => {
        reader = new FileReader(); reader.onload = () => resolve(primitiveImageSource(reader?.result)); reader.onerror = () => reject(new Error(t('clientUIAnimationEditor.ui.primitiveResources.imageReadFailed', { name: file.name }))); reader.onabort = () => reject(new Error(t('clientUIAnimationEditor.ui.primitiveImport.cancelled'))); reader.readAsDataURL(file);
      });
      if (disposed) return;
      if (!source) throw new Error(t('clientUIAnimationEditor.ui.primitiveResources.unsupportedImageFormat', { name: file.name }));
      const existing = props.assets.find(a => a.imageUrl === source);
      if (existing) activeId.value = existing.id;
      else {
        const asset: PrimitiveImageResource = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ""), imageUrl: source, previewMode: "image", fitData: null };
        emit("save", asset); activeId.value = asset.id; await nextTick();
      }
    }
    search.value = "";
  } catch (reason) { if (!disposed) error.value = reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.primitiveResources.imageImportFailed'); }
  finally { reader = null; if (!disposed) reading.value = false; }
}
</script>

<style scoped>
.primitive-resource-library { position: absolute; inset: auto 0 0; z-index: 130; height: min(640px, 76%); min-height: 350px; display: flex; flex-direction: column; color: #e4e7ef; background: #292e39; border-top: 1px solid #58647b; box-shadow: 0 -8px 28px #0005; outline: none; font-size: 12px; }
header { display: flex; align-items: center; gap: 9px; padding: 12px 16px 4px; } header strong { white-space: nowrap; } header small { color: #a7b2c8; } header input { margin-left: auto; width: 180px; }
button, input { border: 1px solid #50596b; border-radius: 5px; background: #343b49; color: inherit; font: inherit; padding: 6px 10px; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible { outline: 2px solid #b994e6; } .file-input { display: none; }
.library-note { margin: 7px 16px 10px; color: #a6b2c7; font-size: 11px; line-height: 1.6; }.library-body { display: grid; grid-template-columns: 180px minmax(180px, 1fr) 320px; flex: 1; min-height: 0; }
.batch-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 0 16px 10px; }.batch-actions span { color: #bfcde2; overflow-wrap: anywhere; }.batch-progress { margin: 0 16px 8px; width: calc(100% - 32px); height: 6px; flex-shrink: 0; }.batch-failures { margin: 0 16px 8px; color: #ffacae; max-height: 90px; overflow: auto; flex-shrink: 0; }
.resource-list { overflow: auto; padding: 6px 12px 16px; }.resource-card { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; margin-bottom: 10px; padding: 10px; }.resource-card.selected { border-color: #c09de8; background: #473b57; }.resource-card img, .empty-thumbnail { width: 110px; height: 70px; object-fit: contain; background: #212631; }.resource-card b { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.resource-card small { color: #bac5d7; font-size: 10px; }
.resource-preview-column { display: flex; flex-direction: column; min-width: 0; overflow: auto; padding: 8px 18px 18px; border-left: 1px solid #454f60; }.resource-preview-column label { display: flex; align-items: center; gap: 8px; }.resource-preview-column input { flex: 1; min-width: 0; }.resource-preview { position: relative; flex: 1; min-height: 140px; margin-top: 12px; overflow: hidden; background: repeating-conic-gradient(#333a46 0% 25%, #242b36 0% 50%) 50% / 20px 20px; }.resource-preview-column small { color: #aab8cd; line-height: 1.7; margin-top: 10px; }.resource-actions { display: flex; gap: 8px; flex-wrap: wrap; }.primary { background: #675084; }
.resource-settings { overflow: auto; border-left: 1px solid #454f60; padding: 8px 14px 20px; }.empty-state, .empty-selection { color: #aab8cd; line-height: 1.8; padding: 20px 8px; }.empty-selection { grid-column: 2 / -1; display: grid; place-items: center; }.error { color: #ffacae; margin: 4px 16px; }
@media(max-width: 850px) { .library-body { grid-template-columns: 130px minmax(150px, 1fr) 275px; }.resource-list { padding: 5px; }.resource-preview-column { padding: 8px; } header { flex-wrap: wrap; } header input { width: 130px; } }
</style>
