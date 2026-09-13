<template>
  <section ref="panel" class="primitive-resource-library" role="dialog" aria-label="文件图片资源" tabindex="-1" @pointerdown.stop @keydown.esc.stop.prevent="emit('close')">
    <header><strong>图片资源 <small>{{ assets.length }}</small></strong><input v-model="search" type="search" aria-label="搜索图片资源" placeholder="搜索本文件图片" /><button :disabled="reading" @click="fileInput?.click()">{{ reading ? '正在导入…' : '导入图片' }}</button><button @click="addEmpty">添加图片网址</button><button aria-label="关闭图片资源面板" @click="emit('close')">×</button></header>
    <p class="library-note">当前文件的原图与拟合结果统一保存在这里。多个图元控件可共用同一资源。切换资源或关闭面板会取消正在进行的生成。</p>
    <input ref="fileInput" class="file-input" type="file" accept="image/*" multiple @change="importFiles" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="library-body">
      <div class="resource-list">
        <button v-for="asset in filteredAssets" :key="asset.id" class="resource-card" :class="{ selected: asset.id === activeId }" :aria-label="`设置图片资源 ${asset.name}`" @click="activeId = asset.id">
          <img v-if="primitiveImageSource(asset.imageUrl)" :src="primitiveImageSource(asset.imageUrl)" alt="" /><span v-else class="empty-thumbnail">▧</span>
          <b>{{ asset.name }}</b><small>{{ asset.fitData ? `${asset.fitData.elements.length} 个图元` : '尚未拟合' }} · {{ usage[asset.id] || 0 }} 处引用</small>
        </button>
        <p v-if="!filteredAssets.length" class="empty-state">{{ assets.length ? '没有匹配的图片。' : '导入图片后，在这里设置拟合参数并生成图元。' }}</p>
      </div>
      <template v-if="activeAsset">
        <div class="resource-preview-column">
          <label>资源名称<input :key="activeAsset.id" :value="activeAsset.name" aria-label="图片资源名称" @change="rename(($event.target as HTMLInputElement).value)" /></label>
          <div ref="preview" class="resource-preview"><PrimitiveImage :image-url="activeAsset.imageUrl" :preview-mode="activeAsset.previewMode" :fit-data="activeAsset.fitData" :width="previewSize.width" :height="previewSize.height" /></div>
          <p>{{ activeAsset.fitData ? `${activeAsset.fitData.width} × ${activeAsset.fitData.height}` : '选择右侧参数并生成图元' }}</p>
          <div class="resource-actions"><button v-if="selectable" class="primary" :disabled="!activeAsset.imageUrl" @click="emit('select', activeAsset.id)">用于当前图元控件</button><button :disabled="!!usage[activeAsset.id]" :title="usage[activeAsset.id] ? '先解除控件引用再移除资源' : '从当前文件移除，可撤销'" @click="emit('remove', activeAsset.id)">移除资源</button></div>
          <small>参数 JSON 使用资源原始尺寸，坐标相对图片中心；图元控件按自身尺寸等比显示。</small>
        </div>
        <div class="resource-settings"><PrimitiveImageSettings :key="activeAsset.id" :model-value="activeAsset" :name="activeAsset.name" @update:model-value="updateActive" /></div>
      </template>
      <div v-else class="empty-selection">选择一张图片，预览原图、设置拟合并导出图元参数。</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PrimitiveImage from "./PrimitiveImage.vue";
import PrimitiveImageSettings from "./PrimitiveImageSettings.vue";
import { primitiveImageSource } from "./primitiveControl";
import type { PrimitiveProperties } from "./primitiveData";
import type { PrimitiveImageResource } from "./primitiveResources";

const props = defineProps<{ assets: PrimitiveImageResource[]; selectedId: string | null; selectable: boolean; usage: Record<string, number> }>();
const emit = defineEmits<{ (event: "close"): void; (event: "save", asset: PrimitiveImageResource): void; (event: "remove", id: string): void; (event: "select", id: string): void }>();
const search = ref(""), error = ref(""), reading = ref(false), activeId = ref(props.selectedId ?? props.assets[0]?.id ?? "");
const panel = ref<HTMLElement | null>(null), preview = ref<HTMLElement | null>(null), fileInput = ref<HTMLInputElement | null>(null);
const previewSize = ref({width: 280, height: 220});
const filteredAssets = computed(() => props.assets.filter(a => a.name.toLowerCase().includes(search.value.trim().toLowerCase())));
const activeAsset = computed(() => props.assets.find(a => a.id === activeId.value) ?? null);
let observer: ResizeObserver | null = null, disposed = false, reader: FileReader | null = null;
onMounted(() => { panel.value?.focus(); });
onBeforeUnmount(() => { disposed = true; reader?.abort(); observer?.disconnect(); });
watch(preview, el => { observer?.disconnect(); if (!el) return; observer = new ResizeObserver(() => { previewSize.value = { width: el.clientWidth, height: el.clientHeight }; }); observer.observe(el); }, { flush: "post" });
watch(() => props.assets.map(a => a.id), ids => { if (!ids.includes(activeId.value)) activeId.value = ids[0] ?? ""; });
function updateActive(value: PrimitiveProperties) { if (activeAsset.value) emit("save", { ...value, id: activeAsset.value.id, name: activeAsset.value.name }); }
function rename(name: string) { if (activeAsset.value && name.trim()) emit("save", { ...activeAsset.value, name: name.trim() }); }
function addEmpty() {
  const asset: PrimitiveImageResource = { id: crypto.randomUUID(), name: `图片 ${props.assets.length + 1}`, imageUrl: "", previewMode: "image", fitData: null };
  emit("save", asset); activeId.value = asset.id; search.value = "";
}
async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = "";
  if (!files.length) return;
  reading.value = true; error.value = "";
  try {
    for (const file of files) {
      if (file.size > 32 * 1024 * 1024) throw new Error(`${file.name} 超过 32 MiB，请先缩小图片。`);
      const source = await new Promise<string>((resolve, reject) => {
        reader = new FileReader(); reader.onload = () => resolve(primitiveImageSource(reader?.result)); reader.onerror = () => reject(new Error(`${file.name} 读取失败`)); reader.onabort = () => reject(new Error("已取消导入")); reader.readAsDataURL(file);
      });
      if (disposed) return;
      if (!source) throw new Error(`${file.name} 不是支持的图片格式。`);
      const existing = props.assets.find(a => a.imageUrl === source);
      if (existing) activeId.value = existing.id;
      else {
        const asset: PrimitiveImageResource = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ""), imageUrl: source, previewMode: "image", fitData: null };
        emit("save", asset); activeId.value = asset.id; await nextTick();
      }
    }
    search.value = "";
  } catch (reason) { if (!disposed) error.value = reason instanceof Error ? reason.message : "图片导入失败。"; }
  finally { reader = null; if (!disposed) reading.value = false; }
}
</script>

<style scoped>
.primitive-resource-library { position: absolute; inset: auto 0 0; z-index: 130; height: min(640px, 76%); min-height: 350px; display: flex; flex-direction: column; color: #e4e7ef; background: #292e39; border-top: 1px solid #58647b; box-shadow: 0 -8px 28px #0005; outline: none; font-size: 12px; }
header { display: flex; align-items: center; gap: 9px; padding: 12px 16px 4px; } header strong { white-space: nowrap; } header small { color: #a7b2c8; } header input { margin-left: auto; width: 180px; }
button, input { border: 1px solid #50596b; border-radius: 5px; background: #343b49; color: inherit; font: inherit; padding: 6px 10px; } button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible { outline: 2px solid #b994e6; } .file-input { display: none; }
.library-note { margin: 7px 16px 10px; color: #a6b2c7; font-size: 11px; line-height: 1.6; }.library-body { display: grid; grid-template-columns: 180px minmax(180px, 1fr) 320px; flex: 1; min-height: 0; }
.resource-list { overflow: auto; padding: 6px 12px 16px; }.resource-card { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; margin-bottom: 10px; padding: 10px; }.resource-card.selected { border-color: #c09de8; background: #473b57; }.resource-card img, .empty-thumbnail { width: 110px; height: 70px; object-fit: contain; background: #212631; }.resource-card b { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.resource-card small { color: #bac5d7; font-size: 10px; }
.resource-preview-column { display: flex; flex-direction: column; min-width: 0; overflow: auto; padding: 8px 18px 18px; border-left: 1px solid #454f60; }.resource-preview-column label { display: flex; align-items: center; gap: 8px; }.resource-preview-column input { flex: 1; min-width: 0; }.resource-preview { position: relative; flex: 1; min-height: 140px; margin-top: 12px; overflow: hidden; background: repeating-conic-gradient(#333a46 0% 25%, #242b36 0% 50%) 50% / 20px 20px; }.resource-preview-column small { color: #aab8cd; line-height: 1.7; margin-top: 10px; }.resource-actions { display: flex; gap: 8px; flex-wrap: wrap; }.primary { background: #675084; }
.resource-settings { overflow: auto; border-left: 1px solid #454f60; padding: 8px 14px 20px; }.empty-state, .empty-selection { color: #aab8cd; line-height: 1.8; padding: 20px 8px; }.empty-selection { grid-column: 2 / -1; display: grid; place-items: center; }.error { color: #ffacae; margin: 4px 16px; }
@media(max-width: 850px) { .library-body { grid-template-columns: 130px minmax(150px, 1fr) 275px; }.resource-list { padding: 5px; }.resource-preview-column { padding: 8px; } header { flex-wrap: wrap; } header input { width: 130px; } }
</style>
