<script setup lang="ts">
import { computed } from 'vue';
import type { AssetFeatureDescription } from '../../utils/assetFeatures';
import { assetFeatureLabels } from './labels';

const props = defineProps<{ parts: AssetFeatureDescription[]; locale: string }>();
const labels = computed(() => assetFeatureLabels(props.locale));
</script>

<template>
  <section v-if="parts.length" class="asset-feature-panel" :aria-label="labels.description">
    <div v-for="part in parts" :key="part.part" class="asset-feature-part" :data-feature-part="part.part">
      <h4>{{ labels[part.part] }}</h4>
      <p class="asset-feature-detail">{{ part.detail || part.short }}</p>
      <div v-if="part.keywords.length" class="asset-feature-keywords" :aria-label="labels.keywords">
        <span v-for="keyword in part.keywords" :key="keyword">{{ keyword }}</span>
      </div>
      <div v-if="part.suggestedUses.length" class="asset-feature-uses">
        <h5>{{ labels.suggestedUses }}</h5>
        <p>{{ part.suggestedUses.join(' · ') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.asset-feature-panel { color: #526887; font-size: 13px; line-height: 1.65; text-align: start; overflow-wrap: anywhere; }
.asset-feature-part + .asset-feature-part { margin-top: 14px; padding-top: 12px; border-top: 1px solid #e3e9f5; }
.asset-feature-part h4 { margin: 0 0 6px; color: #197fd0; font-size: 13px; font-weight: 700; }
.asset-feature-detail { margin: 0; white-space: pre-line; }
.asset-feature-keywords { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.asset-feature-keywords span { padding: 1px 7px; border: 1px solid #dce8f7; border-radius: 5px; background: #f2f7ff; color: #55779b; font-size: 11px; }
.asset-feature-uses { margin-top: 10px; }
.asset-feature-uses h5 { margin: 0 0 3px; color: #798aaa; font-size: 12px; font-weight: 600; }
.asset-feature-uses p { margin: 0; color: #7788a3; }
</style>
