<template>
  <svg class="sprite-image" :width="width" :height="height" :style="reverseMask ? {} : featherStyle" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <filter :id="filterId" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" :values="tintMatrix" /></filter>
      <ImageMaskCoverageFilter v-if="reverseMask" :id="coverageFilterId" :width="width" :height="height" />
      <mask v-if="reverseMask" :id="reverseMaskId" x="0" y="0" :width="width" :height="height" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style="mask-type: luminance">
        <rect x="0" y="0" :width="width" :height="height" fill="white" />
        <g :filter="`url(#${coverageFilterId})`">
          <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" :style="featherStyle" preserveAspectRatio="none">
            <g v-if="asset?.src && !asset.missing">
              <svg v-for="(slice, index) in slices" :key="index" v-bind="slice" preserveAspectRatio="none" overflow="hidden">
                <image :href="asset.src" :width="metadata.width" :height="metadata.height" preserveAspectRatio="none" @error="asset.missing = true" />
              </svg>
            </g>
          </svg>
        </g>
      </mask>
    </defs>
    <g v-if="asset?.src && !asset.missing" :mask="reverseMask ? `url(#${reverseMaskId})` : undefined">
      <g :filter="`url(#${filterId})`">
        <svg v-for="(slice, index) in slices" :key="index" v-bind="slice" preserveAspectRatio="none" overflow="hidden">
          <image :href="asset.src" :width="metadata.width" :height="metadata.height" preserveAspectRatio="none" @error="asset.missing = true" />
        </svg>
      </g>
    </g>
  </svg>
</template>
<script setup lang="ts">
import { computed, getCurrentInstance, watch } from "vue";
import { loadSpriteMetadata, type UIImageAsset } from "./imageAssets";
import { spriteSlices } from "./spriteGeometry";
import type { ColorRGBA, UIImageType, ClientUIImageControlProperties } from "./types";
import { imageFeatherPreview } from './imageFeatherPreview';
import ImageMaskCoverageFilter from './ImageMaskCoverageFilter.vue';
const props = withDefaults(defineProps<{ asset: UIImageAsset | null; width: number; height: number; imageType: UIImageType | null; color: ColorRGBA; maskProperties?: ClientUIImageControlProperties; applyMaskReverse?: boolean }>(), { applyMaskReverse: true });
const filterId = `sprite-tint-${getCurrentInstance()!.uid}`;
const coverageFilterId = `${filterId}-coverage`;
const reverseMaskId = `${filterId}-reverse-mask`;
const reverseMask = computed(() => props.applyMaskReverse && props.maskProperties?.enableMask && props.maskProperties.reverseMaskArea);
const featherStyle = computed(() => imageFeatherPreview(props.maskProperties, props.width, props.height));
const metadata = computed(() => props.asset?.metadata ?? { width: 1, height: 1, left: 0, bottom: 0, right: 0, top: 0, pixelsPerUnit: 1 });
const slices = computed(() => spriteSlices(metadata.value, props.width, props.height, props.imageType === "stretch"));
const tintMatrix = computed(() => `${props.color.r / 255} 0 0 0 0 0 ${props.color.g / 255} 0 0 0 0 0 ${props.color.b / 255} 0 0 0 0 0 ${props.color.a} 0`);
watch(() => props.asset, asset => { if (asset) void loadSpriteMetadata(asset); }, { immediate: true });
</script>
<style scoped>
.sprite-image { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
