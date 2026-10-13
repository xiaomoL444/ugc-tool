<template>
  <div class="gia-export-backdrop" @pointerdown.self.stop="emit('close')">
    <section ref="dialog" class="gia-export-dialog" role="dialog" aria-modal="true" :aria-label="t('clientUIAnimationEditor.ui.exportGia.title')" tabindex="-1" @pointerdown.stop @keydown.esc.stop.prevent="emit('close')">
      <header><h2>{{ t('clientUIAnimationEditor.ui.exportGia.title') }}</h2><button type="button" :aria-label="t('clientUIAnimationEditor.ui.exportGia.closeLabel')" @click="emit('close')">×</button></header>
      <p>{{ t('clientUIAnimationEditor.ui.exportGia.controlCountHint', { count: count }) }}</p>
      <p>{{ t('clientUIAnimationEditor.ui.exportGia.templateReferenceHint') }}</p>
      <p>{{ t('clientUIAnimationEditor.ui.giaExport.controlIdReindexHint') }}</p>
      <p>{{ t('clientUIAnimationEditor.ui.exportGia.primitiveContainerHint') }}</p>
      <form @submit.prevent="emit('export', { name: name.trim(), uiIndex: Number(index), assetKind })">
        <label>{{ t('clientUIAnimationEditor.ui.giaExport.exportType') }}<select v-model="assetKind" :aria-label="t('clientUIAnimationEditor.ui.exportGia.assetType')" :disabled="busy"><option value="containerUI">{{ t('clientUIAnimationEditor.ui.giaImport.containerUiAsset') }}</option><option value="controlTemplate">{{ t('clientUIAnimationEditor.ui.exportGia.controlTemplateKind') }}</option></select></label>
        <p>{{ assetKind === 'containerUI' ? t('clientUIAnimationEditor.ui.exportGia.rootContainerHint') : t('clientUIAnimationEditor.ui.exportGia.controlTemplateHint') }}</p>
        <label>{{ t('clientUIAnimationEditor.ui.properties.name') }}<input v-model="name" :aria-label="t('clientUIAnimationEditor.ui.exportGia.name')" required /></label>
        <label>{{ assetKind === 'containerUI' ? t('clientUIAnimationEditor.ui.exportGia.uiIndex') : t('clientUIAnimationEditor.ui.exportGia.templateIndex') }}<input v-model="index" :aria-label="assetKind === 'containerUI' ? t('clientUIAnimationEditor.ui.exportGia.uiIndex') : t('clientUIAnimationEditor.ui.exportGia.templateIndex')" type="number" min="0" max="2147483647" step="1" required /></label>
        <p>{{ hasSource ? t('clientUIAnimationEditor.ui.giaExport.preserveNativeDataHint') : t('clientUIAnimationEditor.ui.exportGia.originalDataHint') }}</p>
        <button type="button" :disabled="busy" @click="fileInput?.click()">{{ hasSource ? t('clientUIAnimationEditor.ui.exportGia.replaceOriginal') : t('clientUIAnimationEditor.ui.exportGia.attachOriginal') }}</button>
        <input ref="fileInput" class="hidden-input" type="file" accept=".gia" @change="loadSource" />
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer><button type="button" @click="emit('close')">{{ t('clientUIAnimationEditor.ui.actions.cancel') }}</button><button class="primary" :disabled="busy || !name.trim()" type="submit">{{ busy ? t('clientUIAnimationEditor.ui.common.processing') : t('clientUIAnimationEditor.ui.exportGia.validateExport') }}</button></footer>
      </form>
    </section>
  </div>
</template>
<script setup lang="ts">
import { t } from '../../i18n';
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { GiaAssetKind } from "./giaImporter";
const props = defineProps<{ projectName: string; initialIndex: number; initialKind?: GiaAssetKind; count: number; hasSource: boolean; busy: boolean; error: string; notice: string }>();
const emit = defineEmits<{ (event: "close"): void; (event: "export", options: { name: string; uiIndex: number; assetKind: GiaAssetKind }): void; (event: "source", file: File): void }>();
const assetKind = ref<GiaAssetKind>(props.initialKind ?? "containerUI");
const name = ref(props.projectName), index = ref<number | string>(props.initialIndex), fileInput = ref<HTMLInputElement | null>(null), dialog = ref<HTMLElement | null>(null);
watch(() => props.initialIndex, value => { index.value = value; });
let previousFocus: HTMLElement | null = null;
onMounted(() => { previousFocus = document.activeElement as HTMLElement | null; dialog.value?.focus(); });
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
function loadSource(event: Event) { const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ""; if (file) emit("source", file); }
</script>
<style scoped>
.gia-export-backdrop { position: absolute; inset: 0; z-index: 240; background: #10141cb0; display: flex; align-items: center; justify-content: center; }
.gia-export-dialog { width: min(500px, calc(100% - 40px)); max-height: 85%; overflow: auto; padding: 22px; border: 1px solid #56627a; border-radius: 10px; background: #292f3c; color: #e4eaf5; box-shadow: 0 16px 50px #0006; outline: none; font-size: 12px; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; } h2 { margin: 0; font-size: 17px; }
p { color: #aebad0; line-height: 1.7; margin: 12px 0; } label { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 14px 0; }
input, select { min-width: 0; width: 65%; box-sizing: border-box; } input, select, button { border: 1px solid #505e78; border-radius: 5px; background: #333e51; color: inherit; padding: 7px 10px; font: inherit; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:hover { background: #465776; } .primary { background: #426bc5; } footer { justify-content: flex-end; margin-top: 20px; }
.hidden-input { display: none; } .error { color: #ffadaf; white-space: pre-wrap; } .notice { color: #a4d5b5; }
</style>
