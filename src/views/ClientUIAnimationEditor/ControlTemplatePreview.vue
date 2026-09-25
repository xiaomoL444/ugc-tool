<template>
  <div class="template-preview" :aria-label="asset?.name || '未设置控件模板'">
    <div v-if="scene" class="template-scene" :style="sceneStyle">
      <div v-for="node in scene.nodes" :key="node.control.sourceNodeIndex" class="template-node" :data-template-node="node.control.sourceNodeIndex" :style="nodeStyle(node)">
        <SpriteImage v-if="node.control.type === 'image'" :asset="imageAssetById.get(Number(node.control.properties.imageId)) ?? null" :width="node.width" :height="node.height" :image-type="node.control.properties.imageType === 'stretch' ? 'stretch' : 'basic'" :color="color(node.control.properties.imageColor)" />
        <span v-else-if="node.control.type === 'text' || node.control.type === 'textWindow'" class="template-text" :style="textStyle(node)">{{ node.control.properties.text }}</span>
      </div>
    </div>
    <span v-else class="template-placeholder">{{ missingIndex == null ? '选择控件模板' : `未找到模板 #${missingIndex}` }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { buildTemplateScene, type ControlTemplateAsset, type TemplateSceneNode } from "./controlTemplates";
import { imageAssetById, loadImageCatalog } from "./imageAssets";
import SpriteImage from "./SpriteImage.vue";
import type { ColorRGBA } from "./types";

const props = withDefaults(defineProps<{ asset: ControlTemplateAsset | null; width: number; height: number; deviceIndex?: number; fit?: boolean; missingIndex?: number | null; alpha?: number }>(), { deviceIndex: 0, fit: false, missingIndex: null, alpha: 1 });
void loadImageCatalog();
const scene = computed(() => props.asset ? buildTemplateScene(props.asset, props.deviceIndex) : null);
const sceneStyle = computed<CSSProperties>(() => {
  if (!scene.value) return {};
  const sx = props.width / scene.value.width, sy = props.height / scene.value.height;
  const x = props.fit ? Math.min(sx, sy) : sx, y = props.fit ? Math.min(sx, sy) : sy;
  return { width: `${scene.value.width}px`, height: `${scene.value.height}px`,
    left: `${(props.width - scene.value.width * x) / 2}px`, top: `${(props.height - scene.value.height * y) / 2}px`, transform: `scale(${x}, ${y})` };
});
function nodeStyle(node: TemplateSceneNode): CSSProperties {
  const l = node.control.layout, m = node.matrix;
  return { width: `${node.width}px`, height: `${node.height}px`, left: `${node.x - node.width * l.pivotX - scene.value!.minX}px`,
    top: `${scene.value!.maxY - node.y - node.height * (1 - l.pivotY)}px`, transform: `matrix(${m.a}, ${-m.b}, ${-m.c}, ${m.d}, 0, 0)`,
    transformOrigin: `${l.pivotX * 100}% ${(1 - l.pivotY) * 100}%` };
}
function color(value: unknown, fallback: ColorRGBA = { r: 255, g: 255, b: 255, a: 1 }): ColorRGBA {
  const c = value as ColorRGBA | null;
  const base = c && [c.r, c.g, c.b, c.a].every(Number.isFinite) ? c : fallback;
  const alpha = Number.isFinite(props.alpha) ? Math.max(0, Math.min(1, props.alpha)) : 1;
  return { ...base, a: base.a * alpha };
}
function cssColor(value: unknown, fallback?: ColorRGBA): string {
  const c = color(value, fallback); return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}
function textStyle(node: TemplateSceneNode): CSSProperties {
  const p = node.control.properties;
  return { fontSize: `${Number(p.fontSize) || 24}px`, color: cssColor(p.fontColor),
    backgroundColor: cssColor(p.bgColor, { r: 0, g: 0, b: 0, a: 0 }),
    justifyContent: p.horizontalAlignment === "right" ? "flex-end" : p.horizontalAlignment === "middle" ? "center" : "flex-start",
    alignItems: p.verticalAlignment === "bottom" ? "flex-end" : p.verticalAlignment === "middle" ? "center" : "flex-start",
    textAlign: p.horizontalAlignment === "right" ? "right" : p.horizontalAlignment === "middle" ? "center" : "left" };
}
</script>

<style scoped>
.template-preview { position: relative; width: 100%; height: 100%; pointer-events: none; }
.template-scene { position: absolute; transform-origin: 0 0; }
.template-node { position: absolute; border: 0; }
.template-text { display: flex; width: 100%; height: 100%; white-space: pre-wrap; overflow: hidden; }
.template-placeholder { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 12px; color: #a9b6d0; }
</style>
