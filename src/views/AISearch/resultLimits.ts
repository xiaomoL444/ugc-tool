import type { ResourceCard, AnswerSection } from './types'

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

export function boundedHistoryContent(content: string, cards: readonly ResourceCard[], heading: string, sections?: readonly AnswerSection[]): string {
  const items: { resourceId: string; title?: string; duration?: number; audioMatch?: boolean }[] = cards.slice(0, MAX_SEARCH_RESULTS)
    .map(card => ({ resourceId: card.resourceId, title: card.title.slice(0, 20), duration: card.duration, ...(card.audioMatch ? { audioMatch: true } : {}) }))
  if (JSON.stringify(items).length > 1500) items.forEach(item => { delete item.title })
  if (JSON.stringify(items).length > 1500) items.forEach(item => { delete item.duration })
  // At larger result counts, tuples retain every ID and its audio evidence flag
  // without spending the history budget on repeated field names.
  const compact = sections?.length || JSON.stringify(items).length > 1500
    ? items.map(item => item.audioMatch ? [item.resourceId, true] : item.resourceId) : items
  let suffix = items.length ? `\n${heading}: ${JSON.stringify(compact)}` : ''
  if (sections?.length) {
    const groups = sections.map(section => ({ answer: section.answer.slice(0, 60),
      positions: section.resourceIds.map(id => cards.findIndex(card => card.resourceId === id) + 1).filter(position => position > 0) }))
    if (suffix.length + JSON.stringify(groups).length > 1800) groups.forEach(group => { group.answer = group.answer.slice(0, 20) })
    suffix += `\nAnswer sections (1-based resource positions): ${JSON.stringify(groups)}`
  }
  return content.slice(0, Math.max(0, Math.min(1100, 1900 - suffix.length))) + suffix
}
