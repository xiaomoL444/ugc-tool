<template>
  <div class="comparison">
    <figure v-for="frame in frames" :key="frame.kind">
      <figcaption>
        <strong>{{ t(`customImageViewer.ui.${frame.kind}`) }}</strong>
        <span v-if="frame.kind === 'original' && frame.source">{{ frame.width }} × {{ frame.height }} px</span>
        <span v-else-if="frame.kind !== 'original'">×2</span>
      </figcaption>
      <div class="stage">
        <canvas v-if="frame.source" v-paint="{ source: frame.source, regions: frame.regions }" :width="frame.width" :height="frame.height"
          role="img" :aria-label="t(`customImageViewer.ui.${frame.kind}`)" />
        <span v-else-if="frame.kind === 'original' || border" role="status">{{ t(failed ? 'customImageViewer.ui.unavailable' : 'customImageViewer.ui.loading') }}</span>
      </div>
    </figure>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, type FunctionDirective } from 'vue';
import { t } from '@/i18n';
import { loadSpriteMetadata, type UIImageAsset } from './imageAssets';
import { spriteRegions, type SpriteMetadata } from './spriteGeometry';

const props = defineProps<{ asset: UIImageAsset; thumbnail?: HTMLImageElement }>();
const border = ref<SpriteMetadata>();
const pixels = shallowRef<HTMLImageElement>();
const failed = ref(false);

watch(() => props.asset, (asset, _, onCleanup) => {
  border.value = asset.metadata;
  if (asset.metadata || !asset.borderPath || !asset.src) return;
  let current = true;
  onCleanup(() => { current = false; });
  void loadSpriteMetadata(asset).then(metadata => { if (current) border.value = metadata; });
}, { immediate: true });

watch([() => props.asset.src, () => props.thumbnail], ([src, thumbnail], _, onCleanup) => {
  pixels.value = undefined;
  failed.value = !src;
  if (!src) return;

  // Thumbnails display the full source PNG. Keep its pixels even after the
  // virtual list scrolls it out of view while the border JSON loads.
  const image = thumbnail?.dataset.src === src ? thumbnail : new Image();
  const loaded = () => { pixels.value = image; failed.value = false; };
  const unavailable = () => { failed.value = true; };
  image.addEventListener('load', loaded);
  image.addEventListener('error', unavailable);
  onCleanup(() => {
    image.removeEventListener('load', loaded);
    image.removeEventListener('error', unavailable);
    if (image !== thumbnail && !image.complete) image.removeAttribute('src');
  });
  if (!image.complete || !image.naturalWidth) image.loading = 'eager';
  if (image.getAttribute('src') !== src) image.src = src;
  if (image.complete) {
    if (image.naturalWidth) loaded();
    else unavailable();
  }
}, { immediate: true });

const stretchSource = computed(() => {
  const image = pixels.value;
  const size = border.value;
  if (!image || !size) return;
  if (image.naturalWidth === size.width && image.naturalHeight === size.height) return image;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const rect = size.trimmedRect ?? { x: 0, y: 0, width: size.width, height: size.height };
  canvas.getContext('2d')!.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  return canvas;
});
const frames = computed(() => (['original', 'horizontal', 'vertical'] as const).map(kind => {
  if (kind === 'original') {
    const png = pixels.value;
    return { kind, source: png, width: png?.naturalWidth ?? 0, height: png?.naturalHeight ?? 0 };
  }
  const metadata = border.value;
  const width = (metadata?.width ?? 0) * (kind === 'horizontal' ? 2 : 1);
  const height = (metadata?.height ?? 0) * (kind === 'vertical' ? 2 : 1);
  return { kind, source: stretchSource.value, width, height, regions: metadata && spriteRegions(metadata, width, height, true) };
}));

// Paint adjacent regions into one bitmap before fitting it into the frame.
// Rounding shared boundaries prevents hairline seams at fractional display scales.
const vPaint: FunctionDirective<HTMLCanvasElement, { source: CanvasImageSource; regions?: ReturnType<typeof spriteRegions> }> =
  (canvas, { value }) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!value.regions) {
      ctx.drawImage(value.source, 0, 0);
      return;
    }
    for (const region of value.regions) {
      const x = Math.round(region.x), y = Math.round(region.y);
      ctx.drawImage(value.source, region.sourceX, region.sourceY, region.sourceWidth, region.sourceHeight,
        x, y, Math.round(region.x + region.width) - x, Math.round(region.y + region.height) - y);
    }
  };
</script>

<style scoped>
.comparison { flex: 1; min-height: 180px; display: grid; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 12px; }
figure { margin: 0; min-height: 0; display: flex; flex-direction: column; }
figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; padding: 0 1px 5px; text-align: left; }
figcaption strong { font-size: 14px; }
figcaption span { color: #526079; font: 12px/1.3 ui-monospace, Consolas, monospace; }
.stage { flex: 1; min-height: 0; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; padding: 10px; border-radius: 8px; overflow: hidden; color: white;
  background: repeating-conic-gradient(#687584 0 25%, #717e8e 0 50%) 0 0 / 20px 20px; }
.stage > canvas { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; }
</style>
