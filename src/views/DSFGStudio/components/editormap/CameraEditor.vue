<script setup lang="ts">
import FormItemRow from "@/components/Layout/form-item-row.vue";
import { CameraClipValue, Clip } from "../../types/clip";

const props = defineProps<{
  clip: Clip<CameraClipValue>;
}>();
</script>

<template>
  <FormItemRow title="起点预设点"
    ><input type="number" v-model="clip.value.pointA"
  /></FormItemRow>
  <FormItemRow title="终点预设点"
    ><input v-model="clip.value.pointB"
  /></FormItemRow>
  <FormItemRow title="距离"
    ><input v-model="clip.value.distance"
  /></FormItemRow>
  <FormItemRow title="是否跟随旋转"
    ><input v-model="clip.value.isFollowRot"
  /></FormItemRow>
</template>
