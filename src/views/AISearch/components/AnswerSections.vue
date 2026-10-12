<template>
  <div class="answer-sections">
    <section v-for="(block, index) in blocks" :key="index" class="answer-section" :data-answer-section="index + 1" :aria-labelledby="`${resultId}-answer-${index}`">
      <p :id="`${resultId}-answer-${index}`" class="message-text"><span>{{ block.answer }}</span></p>
      <ResourceResults v-if="block.cards.length" :cards="block.cards" :result-id="`${resultId}-section-${index}`" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AnswerSection, ResourceCard } from '../types'
import ResourceResults from './ResourceResults.vue'

const props = defineProps<{ sections: AnswerSection[]; cards: ResourceCard[]; resultId: string }>()
const blocks = computed(() => {
  const cards = new Map(props.cards.map(card => [card.resourceId, card]))
  return props.sections.map(section => ({ answer: section.answer,
    cards: section.resourceIds.flatMap(id => { const card = cards.get(id); return card ? [card] : [] }) }))
})
</script>

<style scoped>
.answer-sections { display: grid; gap: 24px; }
.answer-section { min-width: 0; }
.answer-section + .answer-section { border-top: 1px solid #d9dfed; padding-top: 20px; }
.message-text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 14px; line-height: 1.8; }
</style>
