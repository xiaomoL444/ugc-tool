<script setup>
import { useI18n } from "vue-i18n";
const { t } = useI18n({ useScope: "global" });
import BaseButton from "@/components/UI/BaseButton.vue";

const emit = defineEmits(["update:selected"]);

function onClick() {
  emit("update:selected");
}

// 判断是否选中
</script>

<template>
  <BaseButton
    :title="t('structViewer.ui.removeItem')"
    :aria-label="t('structViewer.ui.removeItem')"
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
