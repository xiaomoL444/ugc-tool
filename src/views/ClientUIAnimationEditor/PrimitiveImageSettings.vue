<template>
  <div class="primitive-image-settings">
    <input v-model="url" aria-label="图元图片地址" :placeholder="embedded ? '已嵌入本地图片，可输入网址替换' : '输入图片 URL（http / https）'" @change="applyUrl" @keydown.enter.prevent="applyUrl" />
    <div class="image-actions"><button type="button" :disabled="loading" @click="fileInput?.click()">{{ loading ? '正在读取…' : '选择本地图片' }}</button><button type="button" :disabled="!modelValue.imageUrl && !url" @click="clearImage">清除图片</button></div>
    <input ref="fileInput" class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon" @change="readFile" />
    <small>{{ embedded ? '本地图片已嵌入，重新打开编辑文件后仍可显示。' : '也可选择本地图片，图片会随编辑文件保存。' }}</small>
    <fieldset :disabled="fitting" class="fit-options">
      <legend>图片转图元</legend>
      <button type="button" @click="patch({ fitOptions: normalizePrimitiveOptions(undefined) })">恢复默认参数 · 400 / 512 / 16</button>
      <label>图元数量<input aria-label="图元数量" type="number" min="1" max="1000" :value="options.count" @input="updateOption('count', Number(($event.target as HTMLInputElement).value))" /></label>
      <label>拟合精度<select aria-label="拟合精度" :value="options.resolution" @change="updateOption('resolution', Number(($event.target as HTMLSelectElement).value))"><option :value="64">快速 · 64 px</option><option :value="128">标准 · 128 px</option><option :value="256">精细 · 256 px</option><option :value="512">高精度 · 512 px（较慢）</option></select></label>
      <label>并行数<select aria-label="拟合并行数" :value="Math.min(options.workers, workerLimit)" @change="updateOption('workers', Number(($event.target as HTMLSelectElement).value))"><option v-for="count in workerLimit" :key="count" :value="count">{{ count }}{{ count === 1 ? ' · 低内存' : count === workerLimit ? ' · 默认' : '' }}</option></select></label>
      <small>本机最多 {{ workerLimit }} 个线程。更多线程会增加内存占用，提速取决于设备和图片。</small>
      <div class="shape-options"><label v-for="shape in shapeChoices" :key="shape.value"><input type="checkbox" :checked="options.shapes.includes(shape.value)" :disabled="options.shapes.length === 1 && options.shapes.includes(shape.value)" @change="toggleShape(shape.value)" />{{ shape.label }}</label></div>
      <label class="alpha-option"><input type="checkbox" :checked="options.transparent" @change="updateOption('transparent', ($event.target as HTMLInputElement).checked)" />保留透明背景</label>
    </fieldset>
    <div class="image-actions"><button class="generate" type="button" :disabled="!modelValue.imageUrl || loading || fitting" @click="generate">{{ modelValue.fitData ? '重新生成图元' : '生成图元' }}</button><button v-if="fitting" type="button" @click="cancelFit">取消</button></div>
    <div v-if="fitting" class="fit-progress" role="status"><progress :value="completed" :max="options.count"></progress><span>{{ status }}</span></div>
    <p v-else-if="status" class="fit-status" role="status">{{ status }}</p>
    <small>在本机计算，精度和数量越高耗时越长。透明模式会排除越界和无改善的图元，实际数量可能少于设定值。修改参数后需重新生成。</small>
    <div v-if="modelValue.fitData" class="fit-result">
      <div class="preview-switch" role="group" aria-label="图元预览模式"><button type="button" :aria-pressed="modelValue.previewMode !== 'primitives'" @click="patch({ previewMode: 'image' })">原图</button><button type="button" :aria-pressed="modelValue.previewMode === 'primitives'" @click="patch({ previewMode: 'primitives' })">游戏图元</button></div>
      <p>{{ modelValue.fitData.elements.length }} 个图元 · 椭圆 / 矩形 / 三角形素材组合</p>
      <button type="button" @click="exportParameters">导出图元参数 JSON</button>
      <small>以资源原始尺寸输出，坐标相对图片中心，Y 轴向上。控件预览时按自身尺寸等比适配。</small>
      <p v-if="missingAssets" class="error">{{ imageCatalogLoading ? '正在加载游戏图元素材…' : '部分游戏图元素材未加载，预览暂不完整。' }}<button v-if="!imageCatalogLoading" type="button" @click="retryAssets">重试素材</button></p>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { primitiveImageSource } from "./primitiveControl";
import { buildPrimitiveResourceParameters, normalizePrimitiveOptions, primitiveWorkerLimit, type PrimitiveFitOptions, type PrimitiveProperties, type PrimitiveShape } from "./primitiveData";
import { imageAssetById, imageCatalogLoading, loadImageCatalog } from "./imageAssets";
const props = defineProps<{ modelValue: PrimitiveProperties; name: string }>();
const emit = defineEmits<{ (event: "update:modelValue", value: PrimitiveProperties): void; (event: "busy", value: boolean): void }>();
const embedded = computed(() => props.modelValue.imageUrl.startsWith("data:image/"));
const options = computed(() => normalizePrimitiveOptions(props.modelValue.fitOptions));
const workerLimit = primitiveWorkerLimit(navigator.hardwareConcurrency);
const shapeChoices: { value: PrimitiveShape; label: string }[] = [{ value: 'ellipse', label: '椭圆' }, { value: 'rectangle', label: '矩形' }, { value: 'triangle', label: '三角形' }];
const fitting = ref(false), completed = ref(0), status = ref("");
let controller: AbortController | null = null;
const missingAssets = computed(() => props.modelValue.fitData?.elements.some(e => { const asset = imageAssetById.get(e.imageId); return !asset?.src || asset.missing; }));
const url = ref(""), error = ref(""), loading = ref(false), fileInput = ref<HTMLInputElement | null>(null);
watch(() => fitting.value || loading.value, value => emit("busy", value), { immediate: true, flush: "sync" });
let reader: FileReader | null = null;
watch(() => props.modelValue.imageUrl, value => { cancelFit(); url.value = value.startsWith("data:image/") ? "" : value; error.value = ""; status.value = ""; }, { immediate: true });
function patch(value: Partial<PrimitiveProperties>) { emit("update:modelValue", { ...props.modelValue, ...value }); }
function setImage(imageUrl: string) { cancelFit(); patch({ imageUrl, fitData: null, previewMode: "image" }); }
function updateOption(key: keyof PrimitiveFitOptions, value: unknown) { patch({ fitOptions: normalizePrimitiveOptions({ ...options.value, [key]: value }) }); }
function toggleShape(shape: PrimitiveShape) { const shapes = options.value.shapes.includes(shape) ? options.value.shapes.filter(s => s !== shape) : [...options.value.shapes, shape]; updateOption("shapes", shapes); }
function cancelFit() { if (controller) { controller.abort(); controller = null; fitting.value = false; status.value = "已取消，保留上次生成结果。"; } }
async function generate() {
  cancelFit(); const job = new AbortController(); controller = job;
  fitting.value = true; completed.value = 0; error.value = ""; status.value = "正在读取图片…";
  const source = props.modelValue.imageUrl, settings = { ...options.value, workers: Math.min(options.value.workers, workerLimit) };
  try {
    const { fitPrimitiveImage } = await import("./primitiveFitter");
    const fitData = await fitPrimitiveImage(source, settings, job.signal, progress => {
      if (job.signal.aborted) return;
      completed.value = progress.done;
      status.value = progress.phase === "image" ? "正在读取图片…" : progress.phase === "engine" ? "正在加载图元引擎…" : `正在生成 ${progress.done} / ${progress.total}`;
    });
    if (job.signal.aborted || props.modelValue.imageUrl !== source) return;
    patch({ fitData, fitOptions: settings, previewMode: "primitives" });
    status.value = `已生成 ${fitData.elements.length} 个图元，可切换原图对比。`;
    void loadImageCatalog();
  } catch (reason) {
    if (!job.signal.aborted) { error.value = reason instanceof Error ? reason.message : "图元生成失败，请重试。"; status.value = ""; }
  } finally { if (controller === job) { controller = null; fitting.value = false; } }
}
function exportParameters() {
  if (!props.modelValue.fitData) return;
  try {
    const data = buildPrimitiveResourceParameters(props.modelValue.fitData, props.name);
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = href; link.download = `${props.name.replace(/[<>:"/\\|?*]/g, "_") || 'primitive'}.primitives.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (reason) { error.value = reason instanceof Error ? reason.message : "参数导出失败。"; }
}
function retryAssets() { props.modelValue.fitData?.elements.forEach(e => { const asset = imageAssetById.get(e.imageId); if (asset) asset.missing = false; }); void loadImageCatalog(); }
function cancelRead() { if (reader) { reader.onload = reader.onerror = null; reader.abort(); reader = null; } loading.value = false; }
onBeforeUnmount(() => { cancelRead(); cancelFit(); emit("busy", false); });
function applyUrl() {
  cancelRead(); const source = url.value.trim();
  if (source && !primitiveImageSource(source)) { error.value = "请输入 http / https 图片地址，或选择本地图片。"; return; }
  error.value = ""; setImage(source);
}
function clearImage() { cancelRead(); url.value = ""; error.value = ""; setImage(""); }
function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file) return;
  if (file.size > 32 * 1024 * 1024) { error.value = "图片文件不能超过 32 MB。"; return; }
  cancelRead(); error.value = ""; loading.value = true;
  reader = new FileReader();
  reader.onload = () => {
    const source = primitiveImageSource(reader?.result); reader = null; loading.value = false;
    if (!source) { error.value = "不支持此图片格式，请选择 PNG、JPEG、WebP、GIF、SVG 等图片。"; return; }
    setImage(source);
  };
  reader.onerror = () => { reader = null; loading.value = false; error.value = "图片读取失败，请重新选择。"; };
  reader.readAsDataURL(file);
}
</script>
<style scoped>
.primitive-image-settings > input { box-sizing: border-box; width: 100%; padding: 7px; border: 1px solid #505b70; border-radius: 5px; background: #262b35; color: #e4e7ef; font-size: 11px; }
.image-actions { display: flex; gap: 7px; margin: 8px 0; }
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
