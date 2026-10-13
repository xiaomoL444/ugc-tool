<template>
  <div class="primitive-image-settings">
    <input v-model="url" :aria-label="t('clientUIAnimationEditor.ui.primitiveFit.imageUrl')" :placeholder="embedded ? t('clientUIAnimationEditor.ui.primitiveImport.embeddedImageHint') : t('clientUIAnimationEditor.ui.primitives.imageUrlPlaceholder')" @change="applyUrl" @keydown.enter.prevent="applyUrl" />
    <div class="image-actions"><button type="button" :disabled="loading" @click="fileInput?.click()">{{ loading ? t('clientUIAnimationEditor.ui.primitiveImport.readingFile') : t('clientUIAnimationEditor.ui.primitiveImport.selectLocalImage') }}</button><button type="button" :disabled="!modelValue.imageUrl && !url" @click="clearImage">{{ t('clientUIAnimationEditor.ui.primitiveFit.clearImage') }}</button></div>
    <input ref="fileInput" class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon" @change="readFile" />
    <small>{{ embedded ? t('clientUIAnimationEditor.ui.primitiveFit.embeddedImageHint') : t('clientUIAnimationEditor.ui.primitives.localImageSavedHint') }}</small>
    <div class="svg-actions">
      <div class="image-actions"><button type="button" :disabled="!modelValue.fitData || fitting || fitReading" @click="exportSvg">{{ t('clientUIAnimationEditor.ui.primitiveExport.fittedSvg') }}</button><button type="button" :disabled="!modelValue.fitData || fitting || fitReading" @click="exportCss">{{ t('clientUIAnimationEditor.ui.primitiveFit.exportCss') }}</button><button type="button" :disabled="fitting || loading || fitReading" @click="svgInput?.click()">{{ t('clientUIAnimationEditor.ui.primitiveImport.replaceWithSvg') }}</button><button type="button" :disabled="fitting || loading || fitReading" @click="cssInput?.click()">{{ t('clientUIAnimationEditor.ui.primitiveFit.importCss') }}</button></div>
      <small v-if="fitReading" role="status">{{ t('clientUIAnimationEditor.ui.primitiveImport.readingFitData') }}</small>
      <small>{{ t('clientUIAnimationEditor.ui.primitiveExport.cssUsageHint') }}</small>
      <input ref="svgInput" class="file-input" type="file" accept=".svg,image/svg+xml" @change="readFitFile($event, 'SVG')" />
      <input ref="cssInput" class="file-input" type="file" accept=".css,text/css" @change="readFitFile($event, 'CSS')" />
      <small>{{ t('clientUIAnimationEditor.ui.primitiveImport.cssFormatHint') }}</small>
      <small>{{ t('clientUIAnimationEditor.ui.primitiveImport.supportedShapesHint') }}</small>
    </div>
    <fieldset :disabled="fitting || fitReading" class="fit-options">
      <legend>{{ t('clientUIAnimationEditor.ui.primitives.convertImage') }}</legend>
      <button type="button" @click="patch({ fitOptions: normalizePrimitiveOptions(undefined) })">{{ t('clientUIAnimationEditor.ui.primitives.restoreDefaultParameters') }}</button>
      <label>{{ t('clientUIAnimationEditor.ui.primitiveFit.primitiveCount') }}<input :aria-label="t('clientUIAnimationEditor.ui.primitiveFit.primitiveCount')" type="number" min="1" max="1000" :value="options.count" @input="updateOption('count', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>{{ t('clientUIAnimationEditor.ui.primitiveFit.precision') }}<select :aria-label="t('clientUIAnimationEditor.ui.primitiveFit.precision')" :value="options.resolution" @change="updateOption('resolution', Number(($event.target as HTMLSelectElement).value))"><option :value="64">{{ t('clientUIAnimationEditor.ui.primitiveFit.precisionFast') }}</option><option :value="128">{{ t('clientUIAnimationEditor.ui.primitives.standardResolution') }}</option><option :value="256">{{ t('clientUIAnimationEditor.ui.primitiveFit.finePrecision') }}</option><option :value="512">{{ t('clientUIAnimationEditor.ui.primitiveFit.highPrecision') }}</option></select></label>
      <label>{{ t('clientUIAnimationEditor.ui.primitives.parallelWorkers') }}<select :aria-label="t('clientUIAnimationEditor.ui.primitives.fitParallelWorkers')" :value="Math.min(options.workers, workerLimit)" @change="updateOption('workers', Number(($event.target as HTMLSelectElement).value))"><option v-for="count in workerLimit" :key="count" :value="count">{{ count }}{{ count === 1 ? t('clientUIAnimationEditor.ui.primitiveFit.lowMemorySuffix') : count === workerLimit ? t('clientUIAnimationEditor.ui.primitives.defaultWorkersHint') : '' }}</option></select></label>
      <small>{{ t('clientUIAnimationEditor.ui.primitiveFit.workerLimitHint', { workerLimit: workerLimit }) }}</small>
      <div class="shape-options"><label v-for="shape in shapeChoices" :key="shape.value"><input type="checkbox" :checked="options.shapes.includes(shape.value)" :disabled="options.shapes.length === 1 && options.shapes.includes(shape.value)" @change="toggleShape(shape.value)" />{{ t(shape.label) }}</label></div>
      <label class="alpha-option"><input type="checkbox" :checked="options.transparent" @change="updateOption('transparent', ($event.target as HTMLInputElement).checked)" />{{ t('clientUIAnimationEditor.ui.primitiveFit.preserveTransparency') }}</label>
    </fieldset>
    <div class="image-actions"><button class="generate" type="button" :disabled="!modelValue.imageUrl || loading || fitting || fitReading" @click="generate">{{ modelValue.fitData ? t('clientUIAnimationEditor.ui.primitives.regenerate') : t('clientUIAnimationEditor.ui.primitiveFit.generate') }}</button><button v-if="fitting" type="button" @click="cancelFit">{{ t('clientUIAnimationEditor.ui.actions.cancel') }}</button></div>
    <div v-if="fitting" class="fit-progress" role="status"><progress :value="completed" :max="options.count"></progress><span>{{ status }}</span></div>
    <p v-else-if="status" class="fit-status" role="status">{{ status }}</p>
    <small>{{ t('clientUIAnimationEditor.ui.primitives.fitQualityHint') }}</small>
    <div v-if="modelValue.fitData" class="fit-result">
      <div class="preview-switch" role="group" :aria-label="t('clientUIAnimationEditor.ui.primitiveFit.previewMode')"><button type="button" :aria-pressed="modelValue.previewMode !== 'primitives'" @click="patch({ previewMode: 'image' })">{{ t('clientUIAnimationEditor.ui.imageControls.originalImage') }}</button><button type="button" :aria-pressed="modelValue.previewMode === 'primitives'" @click="patch({ previewMode: 'primitives' })">{{ t('clientUIAnimationEditor.ui.imageControls.gamePrimitives') }}</button></div>
      <p>{{ t('clientUIAnimationEditor.ui.primitiveFit.assetCombinationSummary', { count: modelValue.fitData.elements.length }) }}</p>
      <button type="button" @click="exportParameters">{{ t('clientUIAnimationEditor.ui.primitiveFit.exportParameters') }}</button>
      <small>{{ t('clientUIAnimationEditor.ui.primitiveExport.coordinateHint') }}</small>
      <p v-if="missingAssets" class="error">{{ imageCatalogLoading ? t('clientUIAnimationEditor.ui.primitivePreview.loadingAssets') : t('clientUIAnimationEditor.ui.primitives.assetsPartiallyLoaded') }}<button v-if="!imageCatalogLoading" type="button" @click="retryAssets">{{ t('clientUIAnimationEditor.ui.primitivePreview.retryAssets') }}</button></p>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import { t } from '../../i18n';
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { primitiveImageSource } from "./primitiveControl";
import { buildPrimitiveResourceParameters, normalizePrimitiveOptions, primitiveWorkerLimit, type PrimitiveFitOptions, type PrimitiveProperties, type PrimitiveShape } from "./primitiveData";
import { imageAssetById, imageCatalogLoading, loadImageCatalog } from "./imageAssets";
import { exportPrimitiveSvg, importPrimitiveSvg, MAX_PRIMITIVE_SVG_BYTES } from "./primitiveSvg";
import { exportPrimitiveCss, importPrimitiveCss, MAX_PRIMITIVE_CSS_BYTES } from "./primitiveCss";
const props = defineProps<{ modelValue: PrimitiveProperties; name: string }>();
const emit = defineEmits<{ (event: "update:modelValue", value: PrimitiveProperties): void; (event: "busy", value: boolean): void }>();
const embedded = computed(() => props.modelValue.imageUrl.startsWith("data:image/"));
const options = computed(() => normalizePrimitiveOptions(props.modelValue.fitOptions));
const workerLimit = primitiveWorkerLimit(navigator.hardwareConcurrency);
const shapeChoices: { value: PrimitiveShape; label: string }[] = [{ value: 'ellipse', label: 'clientUIAnimationEditor.ui.primitiveFit.ellipse' }, { value: 'rectangle', label: 'clientUIAnimationEditor.ui.primitiveFit.rectangle' }, { value: 'triangle', label: 'clientUIAnimationEditor.ui.primitiveFit.shapes.triangle' }];
const fitting = ref(false), completed = ref(0), status = ref<string>('');
let controller: AbortController | null = null;
const missingAssets = computed(() => props.modelValue.fitData?.elements.some(e => { const asset = imageAssetById.get(e.imageId); return !asset?.src || asset.missing; }));
const url = ref(""), error = ref<string>(''), loading = ref(false), fileInput = ref<HTMLInputElement | null>(null);
const svgInput = ref<HTMLInputElement | null>(null), cssInput = ref<HTMLInputElement | null>(null), fitReading = ref(false);
let fitRevision = 0, disposed = false;
watch(() => [props.modelValue.imageUrl, props.modelValue.fitData], () => { fitRevision++; }, { flush: "sync" });
watch(() => fitting.value || loading.value || fitReading.value, value => emit("busy", value), { immediate: true, flush: "sync" });
let reader: FileReader | null = null;
watch(() => props.modelValue.imageUrl, value => { cancelFit(); url.value = value.startsWith("data:image/") ? "" : value; error.value = ""; status.value = ""; }, { immediate: true });
function patch(value: Partial<PrimitiveProperties>) { emit("update:modelValue", { ...props.modelValue, ...value }); }
function setImage(imageUrl: string) { fitRevision++; cancelFit(); patch({ imageUrl, fitData: null, previewMode: "image" }); }
function updateOption(key: keyof PrimitiveFitOptions, value: unknown) { patch({ fitOptions: normalizePrimitiveOptions({ ...options.value, [key]: value }) }); }
function toggleShape(shape: PrimitiveShape) { const shapes = options.value.shapes.includes(shape) ? options.value.shapes.filter(s => s !== shape) : [...options.value.shapes, shape]; updateOption("shapes", shapes); }
function cancelFit() { if (controller) { controller.abort(); controller = null; fitting.value = false; status.value = t('clientUIAnimationEditor.ui.primitiveFit.cancelledWithResultRetained'); } }
async function generate() {
  cancelFit(); const job = new AbortController(); controller = job;
  fitting.value = true; completed.value = 0; error.value = ""; status.value = t('clientUIAnimationEditor.ui.primitiveImport.readingImage');
  const source = props.modelValue.imageUrl, settings = { ...options.value, workers: Math.min(options.value.workers, workerLimit) };
  try {
    const { fitPrimitiveImage } = await import("./primitiveFitter");
    const fitData = await fitPrimitiveImage(source, settings, job.signal, progress => {
      if (job.signal.aborted) return;
      completed.value = progress.done;
      status.value = progress.phase === "image" ? t('clientUIAnimationEditor.ui.primitiveImport.readingImage') : progress.phase === "engine" ? t('clientUIAnimationEditor.ui.primitiveFit.loadingEngine') : t('clientUIAnimationEditor.ui.primitiveFit.generationProgress', { done: progress.done, total: progress.total });
    });
    if (job.signal.aborted || props.modelValue.imageUrl !== source) return;
    patch({ fitData, fitOptions: settings, previewMode: "primitives" });
    status.value = t('clientUIAnimationEditor.ui.primitiveFit.generatedNotice', { count: fitData.elements.length });
    void loadImageCatalog();
  } catch (reason) {
    if (!job.signal.aborted) { error.value = reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.primitiveFit.generationFailedRetry'); status.value = ""; }
  } finally { if (controller === job) { controller = null; fitting.value = false; } }
}
function exportParameters() {
  if (!props.modelValue.fitData) return;
  try {
    const data = buildPrimitiveResourceParameters(props.modelValue.fitData, props.name);
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = href; link.download = `${props.name.replace(/[<>:"/\\|?*]/g, "_") || 'primitive'}.primitives.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.primitiveExport.parametersFailed'); }
}
function retryAssets() { props.modelValue.fitData?.elements.forEach(e => { const asset = imageAssetById.get(e.imageId); if (asset) asset.missing = false; }); void loadImageCatalog(); }
function exportSvg() {
  if (!props.modelValue.fitData) return;
  try {
    const svg = exportPrimitiveSvg(props.modelValue.fitData, props.name);
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a"); link.href = href;
    link.download = `${props.name.replace(/[<>:"/\\|?*]/g, "_") || 'primitive'}.svg`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    error.value = "";
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.svgExport.failed'); }
}
function exportCss() {
  if (!props.modelValue.fitData) return;
  try {
    const css = exportPrimitiveCss(props.modelValue.fitData);
    const href = URL.createObjectURL(new Blob([css], { type: "text/css;charset=utf-8" }));
    const link = document.createElement("a"); link.href = href;
    link.download = `${props.name.replace(/[<>:"/\\|?*]/g, "_") || 'primitive'}.css`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    error.value = "";
  } catch (reason) { error.value = reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.primitiveFit.cssExportFailed'); }
}
async function readFitFile(event: Event, format: "SVG" | "CSS") {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file || fitting.value || loading.value || fitReading.value) return;
  const limit = format === "SVG" ? MAX_PRIMITIVE_SVG_BYTES : MAX_PRIMITIVE_CSS_BYTES;
  if (file.size > limit) { error.value = t('clientUIAnimationEditor.ui.primitiveImport.fileTooLarge', { format: format }); return; }
  const revision = ++fitRevision, target = props.modelValue.fitData;
  fitReading.value = true; error.value = ""; status.value = "";
  try {
    const source = await file.text();
    if (disposed || revision !== fitRevision) return;
    const fitData = (format === "SVG" ? importPrimitiveSvg : importPrimitiveCss)(source, target ?? undefined);
    patch({ fitData, previewMode: "primitives" });
    status.value = t('clientUIAnimationEditor.ui.primitiveImport.fitReplaced', { count: fitData.elements.length, format: format });
    void loadImageCatalog();
  } catch (reason) {
    if (!disposed && revision === fitRevision) error.value = t('clientUIAnimationEditor.ui.primitiveFit.previousResultRetained', { error: reason instanceof Error ? reason.message : t('clientUIAnimationEditor.ui.primitiveImport.readFailed', { format: format }) });
  } finally { if (!disposed) fitReading.value = false; }
}
function cancelRead() { if (reader) { reader.onload = reader.onerror = null; reader.abort(); reader = null; } loading.value = false; }
onBeforeUnmount(() => { disposed = true; fitRevision++; cancelRead(); cancelFit(); emit("busy", false); });
function applyUrl() {
  cancelRead(); const source = url.value.trim();
  if (source && !primitiveImageSource(source)) { error.value = t('clientUIAnimationEditor.ui.primitiveImport.imageSourceHint'); return; }
  error.value = ""; setImage(source);
}
function clearImage() { cancelRead(); url.value = ""; error.value = ""; setImage(""); }
function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file) return;
  if (file.size > 32 * 1024 * 1024) { error.value = t('clientUIAnimationEditor.ui.primitiveImport.imageFileTooLarge'); return; }
  cancelRead(); error.value = ""; loading.value = true;
  reader = new FileReader();
  reader.onload = () => {
    const source = primitiveImageSource(reader?.result); reader = null; loading.value = false;
    if (!source) { error.value = t('clientUIAnimationEditor.ui.primitiveImport.unsupportedImageFormat'); return; }
    setImage(source);
  };
  reader.onerror = () => { reader = null; loading.value = false; error.value = t('clientUIAnimationEditor.ui.primitiveImport.imageReadFailed'); };
  reader.readAsDataURL(file);
}
</script>
<style scoped>
.primitive-image-settings > input { box-sizing: border-box; width: 100%; padding: 7px; border: 1px solid #505b70; border-radius: 5px; background: #262b35; color: #e4e7ef; font-size: 11px; }
.image-actions { display: flex; flex-wrap: wrap; gap: 7px; margin: 8px 0; }
.svg-actions { margin-top: 10px; padding-top: 4px; border-top: 1px solid #505b70; }
button { padding: 5px 8px; border: 1px solid #596780; border-radius: 5px; background: #343e51; color: #dce6f9; font-size: 11px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; } .file-input { display: none; }
small { color: #a9b4c9; font-size: 10px; line-height: 1.7; } .error { color: #ffacae; font-size: 11px; }
.fit-options { margin: 12px 0 6px; padding: 9px; border: 1px solid #505b70; border-radius: 6px; }
.fit-options legend { color: #c7b3ec; font-size: 11px; }
.fit-options > label { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 7px 0; font-size: 11px; }
.fit-options input[type=number], .fit-options select { box-sizing: border-box; width: 150px; max-width: 65%; padding: 4px; background: #262b35; border: 1px solid #505b70; border-radius: 4px; color: #e4e7ef; }
.shape-options { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; }.shape-options label, .fit-options .alpha-option { display: flex; align-items: center; justify-content: flex-start; }
.shape-options label, .fit-options .alpha-option { gap: 4px; white-space: nowrap; }
.fit-options input[type=checkbox] { width: 13px; height: 13px; flex: 0 0 13px; padding: 0; margin: 0; }
.generate { background: #675084; border-color: #9373ba; }.fit-progress { display: grid; gap: 5px; font-size: 11px; }.fit-progress progress { width: 100%; accent-color: #af87df; }
.fit-status, .fit-result p { font-size: 11px; color: #becce0; line-height: 1.6; }.fit-result { margin-top: 12px; border-top: 1px solid #505b70; padding-top: 10px; }.fit-result small { display: block; margin-top: 6px; }
.preview-switch { display: flex; gap: 5px; }.preview-switch button { flex: 1; }.preview-switch button[aria-pressed=true] { background: #675084; border-color: #b590dd; }
</style>
