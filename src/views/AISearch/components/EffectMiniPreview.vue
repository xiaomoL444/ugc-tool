<template>
  <div ref="previewRef" class="effect-mini-preview">
    <EffectMedia :item="item" :title="title" variant="card" :suspended="suspended" />
  </div>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import EffectMedia from "@/views/EffectPlayer/EffectMedia.vue";
import type { EffectItem } from "@/views/EffectPlayer/types/EffectData";
import { claimPreviewPlayback, registerPreviewStop } from "../previewPlayback";

const props = defineProps<{ item: EffectItem; title: string }>();
const previewRef = ref<HTMLElement | null>(null);
const suspended = ref(false);
let cardElement: HTMLElement | null = null;
let unregister: (() => void) | undefined;

function stopPreview() {
  if (!props.item.hasAudio || !props.item.audioPath) return;
  suspended.value = true;
  // Stop audio in the current event before Vue applies the suspension prop.
  previewRef.value?.querySelectorAll<HTMLAudioElement>("audio").forEach((audio) => {
    audio.muted = true;
    audio.pause();
  });
}

function activatePreview() {
  if (props.item.hasAudio && props.item.audioPath) claimPreviewPlayback(stopPreview);
  suspended.value = false;
}

onMounted(() => {
  unregister = registerPreviewStop(stopPreview);
  // EffectMedia listens on the card too, so hovering its title and metadata
  // must claim the same audio slot as hovering the video itself.
  cardElement = previewRef.value?.closest<HTMLElement>("[data-effect-card]") ?? previewRef.value;
  cardElement?.addEventListener("mouseenter", activatePreview);
  cardElement?.addEventListener("pointerdown", activatePreview);
  if (cardElement?.matches(":hover")) activatePreview();
});

onActivated(() => {
  if (cardElement?.matches(":hover")) activatePreview();
});
onDeactivated(stopPreview);

onBeforeUnmount(() => {
  unregister?.();
  cardElement?.removeEventListener("mouseenter", activatePreview);
  cardElement?.removeEventListener("pointerdown", activatePreview);
});
</script>

<style scoped>
.effect-mini-preview { overflow: hidden; border: 1px solid #e5e7ed; border-radius: 10px; }
.effect-mini-preview :deep(.effect-media.is-card) { height: 150px; }
</style>
