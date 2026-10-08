import type { ResourceCard } from './types'

export const MAX_SEARCH_RESULTS = 50
export const DEFAULT_SEARCH_RESULTS = 10
export const SEARCH_RESULT_LIMITS = [5, 10, 20, 50] as const

export function normalizeResultLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SEARCH_RESULTS ? value : DEFAULT_SEARCH_RESULTS
}

export function searchOutputTokens(resultLimit: number): number {
  const limit = normalizeResultLimit(resultLimit)
  return limit <= 5 ? 800 : limit <= 10 ? 1400 : limit <= 20 ? 2400 : 2400 + (limit - 20) * 100
}

export function boundedHistoryContent(content: string, cards: readonly ResourceCard[], heading: string): string {
  const items: { resourceId: string; title?: string; duration?: number; audioMatch?: boolean }[] = cards.slice(0, MAX_SEARCH_RESULTS)
    .map(card => ({ resourceId: card.resourceId, title: card.title.slice(0, 20), duration: card.duration, ...(card.audioMatch ? { audioMatch: true } : {}) }))
  if (JSON.stringify(items).length > 1500) items.forEach(item => { delete item.title })
  if (JSON.stringify(items).length > 1500) items.forEach(item => { delete item.duration })
  // At larger result counts, tuples retain every ID and its audio evidence flag
  // without spending the history budget on repeated field names.
  const compact = JSON.stringify(items).length > 1500
    ? items.map(item => item.audioMatch ? [item.resourceId, true] : item.resourceId) : items
  const suffix = items.length ? `\n${heading}: ${JSON.stringify(compact)}` : ''
  return content.slice(0, Math.max(0, Math.min(1100, 1900 - suffix.length))) + suffix
}
