<template>
  <svg class="sprite-image" :style="imageFeatherPreview(maskProperties, width, height)" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" aria-hidden="true">
    <defs><filter :id="filterId" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" :values="tintMatrix" /></filter></defs>
    <g v-if="asset?.src && !asset.missing" :filter="`url(#${filterId})`">
      <svg v-for="(slice, index) in slices" :key="index" v-bind="slice" preserveAspectRatio="none" overflow="hidden">
        <image :href="asset.src" :width="metadata.width" :height="metadata.height" preserveAspectRatio="none" @error="asset.missing = true" />
      </svg>
    </g>
  </svg>
</template>
<script setup lang="ts">
import { computed, getCurrentInstance, watch } from "vue";
import { loadSpriteMetadata, type UIImageAsset } from "./imageAssets";
import { spriteSlices } from "./spriteGeometry";
import type { ColorRGBA, UIImageType, ClientUIImageControlProperties } from "./types";
import { imageFeatherPreview } from './imageFeatherPreview';
const props = defineProps<{ asset: UIImageAsset | null; width: number; height: number; imageType: UIImageType | null; color: ColorRGBA; maskProperties?: ClientUIImageControlProperties }>();
const filterId = `sprite-tint-${getCurrentInstance()!.uid}`;
const metadata = computed(() => props.asset?.metadata ?? { width: 1, height: 1, left: 0, bottom: 0, right: 0, top: 0, pixelsPerUnit: 1 });
const slices = computed(() => spriteSlices(metadata.value, props.width, props.height, props.imageType === "stretch"));
const tintMatrix = computed(() => `${props.color.r / 255} 0 0 0 0 0 ${props.color.g / 255} 0 0 0 0 0 ${props.color.b / 255} 0 0 0 0 0 ${props.color.a} 0`);
watch(() => props.asset, asset => { if (asset) void loadSpriteMetadata(asset); }, { immediate: true });
</script>
<style scoped>
.sprite-image { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
