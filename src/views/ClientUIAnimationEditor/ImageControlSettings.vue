<template>
  <div class="image-settings">
    <label class="image-field"><span>{{ t('clientUIAnimationEditor.ui.imageControls.source') }}</span><select :aria-label="t('clientUIAnimationEditor.ui.imageControls.source')" disabled><option>{{ t('clientUIAnimationEditor.ui.controls.staticReference') }}</option></select></label>
    <span class="field-label">{{ t('clientUIAnimationEditor.ui.imageControls.referenceAsset') }}</span>
    <div class="asset-card">
      <button class="asset-picker" :aria-label="t('clientUIAnimationEditor.ui.images.selectAsset')" @click="$emit('open-library')"><span class="asset-thumbnail"><img v-if="asset?.src && !asset.missing" :src="asset.src" alt="" @error="asset.missing = true" /></span><span><b>{{ assetName }}</b><small>{{ modelValue.imageId ?? t('clientUIAnimationEditor.ui.imageLibrary.noImage') }}</small></span></button>
      <button class="clear-asset" :aria-label="t('clientUIAnimationEditor.ui.images.clearSelection')" :title="t('clientUIAnimationEditor.ui.images.clearSelection')" @click="$emit('select', null)"><EditorIcon name="trash" :size="17" /></button>
    </div>
    <label class="image-field"><span>{{ t('clientUIAnimationEditor.ui.imageControls.imageId') }}</span><ScrubbableNumberInput :model-value="modelValue.imageId ?? ''" :allow-empty="true" :min="0" :step="1" :aria-label="t('clientUIAnimationEditor.ui.imageControls.imageId')" :placeholder="t('clientUIAnimationEditor.ui.properties.unset')" @update:model-value="$emit('select', $event)" /></label>
    <ColorRGBAField :label="t('clientUIAnimationEditor.ui.imageControls.fillColor')" :model-value="modelValue.imageColor ?? white" :animated="animated" @update:model-value="$emit('update:modelValue', { ...modelValue, imageColor: $event })" />
    <label class="image-field"><span>{{ t('clientUIAnimationEditor.ui.imageControls.imageType') }}</span><div class="image-type"><select :aria-label="t('clientUIAnimationEditor.ui.imageControls.imageType')" :value="modelValue.imageType ?? 'basic'" @change="$emit('update:modelValue', { ...modelValue, imageType: ($event.target as HTMLSelectElement).value })"><option value="basic">{{ t('clientUIAnimationEditor.ui.properties.basicTab') }}</option><option value="stretch">{{ t('clientUIAnimationEditor.ui.controls.stretch') }}</option></select><button :title="t('clientUIAnimationEditor.ui.imageControls.restoreSize')" :aria-label="t('clientUIAnimationEditor.ui.imageControls.restoreSize')" :disabled="!asset?.src || asset.missing" @click="$emit('reset-size')">1:1</button></div></label>
  </div>
</template>
<script setup lang="ts">
import { t } from '../../i18n';
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ColorRGBAField from "./ColorRGBAField.vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import EditorIcon from "./EditorIcon.vue";
import { imageCategoryLabel, type UIImageAsset } from "./imageAssets";
import type { ClientUIImageControlProperties } from "./types";
const props = defineProps<{ modelValue: ClientUIImageControlProperties; asset: UIImageAsset | null; animated: boolean }>();
defineEmits<{ (event: "update:modelValue", value: Record<string, unknown>): void; (event: "select", id: number | null): void; (event: "open-library"): void; (event: "reset-size"): void }>();
const { locale } = useI18n();
const white = { r: 255, g: 255, b: 255, a: 1 };
const assetName = computed(() => props.asset?.categories.length ? imageCategoryLabel(props.asset.categories[0], locale.value) : props.modelValue.imageId === null ? t('clientUIAnimationEditor.ui.imageControls.selectImage') : t('clientUIAnimationEditor.ui.primitiveResources.title'));
</script>
<style scoped>
.image-field { display: block; margin-top: 10px; } .image-field > span, .field-label { display: block; margin: 8px 0 6px; color: #c9ced8; font-size: 11px; }
select { box-sizing: border-box; width: 100%; height: 31px; border: 1px solid #555d6c; border-radius: 6px; padding: 4px 8px; background: #262b35; color: #e4e7ef; font: inherit; font-size: 12px; }
select:disabled { opacity: 1; cursor: default; }
button { border: 0; background: transparent; color: #d8dce5; cursor: pointer; font: inherit; }
button:focus-visible { outline: 2px solid #89a7ff; outline-offset: -2px; }
.asset-card { display: flex; border: 2px solid #414653; border-radius: 7px; background: #262b35; min-height: 64px; }
.asset-card:hover { border-color: #6c80b6; } .asset-picker { display: flex; align-items: center; flex: 1; gap: 10px; padding: 8px; min-width: 0; text-align: left; }
.asset-thumbnail { flex: 0 0 42px; height: 42px; } .asset-thumbnail img { width: 100%; height: 100%; object-fit: contain; }
.asset-picker b { font-size: 12px; } .asset-picker small { display: block; margin-top: 3px; font-size: 12px; } .clear-asset { flex: 0 0 30px; padding: 4px; }
.image-type { display: flex; gap: 5px; } .image-type button { border: 1px solid #555d6c; border-radius: 5px; font-size: 11px; flex: 0 0 32px; padding: 0; } .image-type button:disabled { opacity: .4; cursor: default; }
</style>
