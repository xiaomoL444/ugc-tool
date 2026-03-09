<script setup>
import BaseButton from "@/components/UI/BaseButton.vue";

const emit = defineEmits(["update:selected"]);

function onClick() {
  emit("update:selected");
}

// 判断是否选中
</script>

<template>
  <BaseButton
    class="button"
    :activeEffect="false"
    bgGradient="#FFAFAF"
    @click="onClick"
  >
    <div style="font-size: 1rem;">-</div>
  </BaseButton>
</template>

<style scoped>
.button {
  width: 100%;
}

.icon {
  /* filter: invert(1) sepia(1) saturate(5) hue-rotate(180deg); */
}
</style>
