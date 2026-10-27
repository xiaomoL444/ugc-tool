<template>
  <div class="vfx-control-settings">
    <div class="vfx-resource-card">
      <button ref="chooseButton" class="vfx-choose" :aria-label="t(scope === 'ui' ? 'clientUIAnimationEditor.ui.vfx.selectUI' : 'clientUIAnimationEditor.ui.vfx.selectScreen')" aria-haspopup="dialog" :aria-expanded="open" @click.stop="open = true"><UIVfxIcon :src="asset?.icon" :label="asset ? uiVfxLabel(asset) : ''" /><span><strong>{{ asset ? uiVfxLabel(asset) : animationId ? `#${animationId}` : t('clientUIAnimationEditor.ui.vfx.choose') }}</strong><small v-if="animationId">{{ t('clientUIAnimationEditor.ui.vfx.index', { id: animationId }) }}</small></span></button>
      <button v-if="asset" class="vfx-card-action" :aria-label="t('clientUIAnimationEditor.ui.vfx.replay')" :title="t('clientUIAnimationEditor.ui.vfx.replay')" @click.stop="emit('replay')">▶</button>
      <button v-if="animationId !== null" class="vfx-card-action" :aria-label="t('clientUIAnimationEditor.ui.vfx.remove')" :title="t('clientUIAnimationEditor.ui.vfx.remove')" @click.stop="emit('select', null)">×</button>
    </div>
    <div class="vfx-resource-meta"><span v-if="asset">{{ t(asset.isLoop ? 'clientUIAnimationEditor.ui.vfx.loop' : 'clientUIAnimationEditor.ui.vfx.once') }}</span><button v-if="asset && scope === 'ui'" @click.stop="emit('resetScale')">{{ t('clientUIAnimationEditor.ui.vfx.resetScale') }}</button></div>
    <UIVfxLibrary v-if="open" :scope="scope" :selected-id="animationId" :anchor-element="chooseButton" @close="close" @select="select" @preview="emit('preview', $event)" />
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { t } from "../../i18n";
import { loadUIVfxCatalog, uiVfxById, uiVfxLabel, useUIVfxTranslations } from "./uiVfxAssets";
import type { UIVfxAsset, UIVfxScope } from "./uiVfxAssets";
import UIVfxIcon from "./UIVfxIcon.vue";
import UIVfxLibrary from "./UIVfxLibrary.vue";
const props = defineProps<{ scope: UIVfxScope; animationId: number | null }>();
const emit = defineEmits<{ (e: "select", asset: UIVfxAsset | null): void; (e: "preview", asset: UIVfxAsset | null): void; (e: "replay"): void; (e: "resetScale"): void }>();
const open = ref(false);
const chooseButton = ref<HTMLElement | null>(null);
const asset = computed(() => { const value = uiVfxById.value.get(props.animationId ?? -1); return value?.scope === props.scope ? value : null; });
const translations = useUIVfxTranslations();
function close() { emit('preview', null); open.value = false; }
function select(asset: UIVfxAsset) { emit('select', asset); close(); }
onMounted(() => { void loadUIVfxCatalog(); void translations(); });
onBeforeUnmount(() => emit('preview', null));
</script>
<style scoped>
.vfx-resource-card { display: flex; align-items: center; gap: 5px; padding: 7px; border: 1px solid #454b58; border-radius: 7px; background: #252a34; }
.vfx-choose { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: #e2e7f1; text-align: left; cursor: pointer; }
.vfx-choose > span { display: grid; min-width: 0; gap: 3px; } strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; } small { color: #a7b2c8; font-size: 10px; }
.vfx-card-action { flex: none; width: 25px; height: 30px; padding: 0; background: transparent; border: 0; color: #cad3e5; cursor: pointer; font-size: 16px; }
button:hover { color: #a8c3ff; } button:focus-visible { outline: 2px solid #9bbcff; outline-offset: 2px; border-radius: 4px; }
.vfx-resource-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; color: #9ca9c2; font-size: 10px; }
.vfx-resource-meta button { border: 0; padding: 3px 0; background: transparent; color: #a9c0f3; cursor: pointer; font: inherit; }
</style>
