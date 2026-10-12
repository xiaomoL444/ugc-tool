<template>
  <div class="search-progress" :data-progress-phase="progress.phase">
    <div class="search-progress-heading" role="status" aria-live="polite">
      <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>{{ t(`aiSearch.progress.${progress.phase === 'waiting' || progress.phase === 'generating' ? 'thinking' : progress.phase}`) }}</span>
    </div>
    <div class="search-progress-meta" aria-live="off">
      <span>{{ t('aiSearch.progress.elapsed', { seconds: n(Math.floor(Math.max(0, progress.elapsedMs || 0) / 1000)) }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SearchProgress } from '../types'

defineProps<{ progress: SearchProgress }>()
const { t, n } = useI18n({ useScope: 'global' })
</script>
