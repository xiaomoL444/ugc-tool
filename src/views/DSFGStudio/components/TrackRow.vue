<script setup lang="ts">
import { consola } from "consola";
import { Track } from "../types/track";
import ClipItem from "./ClipItem.vue";

const props = defineProps<{
  track: Track;
  viewStart: number;
  pxPerSecond: number;
}>();

const emit = defineEmits(["createClip"]);

function onRightClick(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

  const x = e.clientX - rect.left;

  emit("createClip", {
    x,
  });
}
</script>

<template>
  <div class="track">
    <div class="label">
      {{ track.name }}
    </div>

    <div class="body" @contextmenu.prevent="onRightClick">
      <ClipItem
        v-for="clip in track.clips"
        :key="clip.id"
        :clip="clip"
        :track="track"
        :viewStart="viewStart"
        :pxPerSecond="pxPerSecond"
      />
    </div>
  </div>
</template>

<style scoped>
.track {
  display: flex;
  height: 50px;
  border-bottom: 1px solid #333;
}

.label {
  width: 120px;
  display: flex;
  align-items: center;
  padding-left: 10px;
  background: #1a1a1a;
}

.body {
  flex: 1;
  position: relative;
  background: #2a2a2a;
}
</style>
