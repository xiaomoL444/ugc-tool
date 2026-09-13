<template>
  <div class="primitive-image">
    <template v-if="previewMode === 'primitives' && fitData">
      <div class="primitive-scene" :style="sceneStyle">
        <div v-for="(element, index) in fitData.elements" :key="index" class="primitive-element" :style="elementStyle(element)">
          <SpriteImage :asset="imageAssetById.get(element.imageId) ?? null" :width="element.width" :height="element.height" image-type="basic" :color="element.color" />
        </div>
      </div>
      <span v-if="missingAssets" class="asset-warning">游戏图元素材加载中或不可用</span>
    </template>
    <img v-else-if="source && !failed" :src="source" alt="" draggable="false" @error="failed = true" />
    <span v-else class="primitive-placeholder">{{ failed || imageUrl && !source ? '图片无法加载' : '图元控件 · 选择图片' }}</span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from "vue";
import { primitiveImageSource } from "./primitiveControl";
import { primitiveContentScale, type PrimitiveElement, type PrimitiveFitData } from "./primitiveData";
import { imageAssetById, loadImageCatalog } from "./imageAssets";
import SpriteImage from "./SpriteImage.vue";
const props = defineProps<{ imageUrl: string; previewMode?: string; fitData?: PrimitiveFitData | null; width: number; height: number }>();
const source = computed(() => primitiveImageSource(props.imageUrl)), failed = ref(false);
watch(source, () => { failed.value = false; });
watch(() => props.previewMode, mode => { if (mode === "primitives") void loadImageCatalog(); }, { immediate: true });
const missingAssets = computed(() => props.fitData?.elements.some(e => { const asset = imageAssetById.get(e.imageId); return !asset?.src || asset.missing; }));
const sceneStyle = computed<CSSProperties>(() => {
  if (!props.fitData) return {};
  const scale = primitiveContentScale(props.fitData, props.width, props.height);
  return { width: `${props.fitData.width}px`, height: `${props.fitData.height}px`, left: `${(props.width - props.fitData.width * scale) / 2}px`, top: `${(props.height - props.fitData.height * scale) / 2}px`, transform: `scale(${scale})` };
});
function elementStyle(e: PrimitiveElement): CSSProperties {
  return { width: `${e.width}px`, height: `${e.height}px`, left: `${props.fitData!.width / 2 + e.x - e.width / 2}px`, top: `${props.fitData!.height / 2 - e.y - e.height / 2}px`, transform: `rotate(${-e.rotation}deg)` };
}
</script>
<style scoped>
.primitive-image { position: relative; width: 100%; height: 100%; pointer-events: none; }
.primitive-scene { position: absolute; transform-origin: 0 0; }.primitive-element { position: absolute; transform-origin: center; }
.asset-warning { position: absolute; inset: 0; display: grid; place-items: center; color: #ffcda4; font-size: 11px; }
.primitive-image img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; }
.primitive-placeholder { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #c6b1ee; font-size: 12px; background: #77549b18; }
</style>
