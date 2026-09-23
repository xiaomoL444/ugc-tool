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
    :title="t('structViewer.ui.appendItem')"
    :aria-label="t('structViewer.ui.appendItem')"
    class="button"
    :activeEffect="false"
    bgGradient="#AFAFD7"
    @click="onClick"
  >
    <div style="font-size: 1rem;">+</div>
  </BaseButton>
</template>

<style scoped>
.button {
  width: min-content;
}

.icon {
  /* filter: invert(1) sepia(1) saturate(5) hue-rotate(180deg); */
}
</style>
