<template>
  <div
    ref="wrapRef"
    class="effect-media"
    :class="[`is-${variant}`, { 'has-gif': ready }]"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  attachEffectMedia,
  hasGif,
  mediaState,
  parkEffectMedia,
} from "./mediaCache";
import { EffectItem } from "./types/EffectData";

const props = withDefaults(
  defineProps<{
    item: EffectItem;
    variant?: "card" | "modal";
  }>(),
  { variant: "card" },
);

const wrapRef = ref<HTMLElement | null>(null);
const ready = computed(() => hasGif(props.item.id) || mediaState.gifReady[props.item.id]);

function sync() {
  if (wrapRef.value) {
    attachEffectMedia(wrapRef.value, props.item);
  }
}

onMounted(sync);

watch(
  () => props.item.id,
  (id, prevId) => {
    if (prevId && prevId !== id) {
      parkEffectMedia(prevId, wrapRef.value);
    }
    sync();
  },
);

watch(
  () => mediaState.gifReady[props.item.id],
  () => sync(),
);

onBeforeUnmount(() => {
  parkEffectMedia(props.item.id, wrapRef.value);
});
</script>

<style scoped>
.effect-media {
  position: relative;
  overflow: hidden;
  background: #111218;
}

.effect-media.is-card {
  height: 160px;
}

.effect-media.is-modal {
  display: flex;
  align-items: center;
  justify-content: center;
}

.effect-media :deep(.effect-image) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.effect-media.is-modal :deep(.effect-image) {
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 68vh;
}

.effect-media :deep(.effect-gif) {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.effect-media.is-modal.has-gif :deep(.effect-gif) {
  position: relative;
  inset: auto;
}

.effect-media.has-gif :deep(.effect-icon) {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  width: 48px;
  height: 48px;
  padding: 4px;
  background: rgba(17, 18, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}

.effect-media.is-modal.has-gif :deep(.effect-icon) {
  right: 12px;
  bottom: 12px;
  width: 96px;
  height: 96px;
  padding: 6px;
  border-color: rgba(159, 231, 255, 0.35);
  border-radius: 12px;
}
</style>
