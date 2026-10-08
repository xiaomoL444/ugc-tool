import { OSS_BASE_URL, createOss } from '../../utils/oss'
import type { EffectItem } from '../EffectPlayer/types/EffectData'
import type { ResourceCard } from './types'

export type PreviewMedia =
  | { kind: 'sound'; src: string }
  | { kind: 'effect'; item: EffectItem }
  | { kind: 'bgm'; songId: number; albumId?: number; duration?: number; albumI18nKey?: string }

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}
function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? number : undefined
}
function positiveInteger(value: unknown): number | undefined {
  const number = positiveNumber(value)
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined
}
// Media paths come from the trusted asset index, never from model output or history.
// Reject URL syntax and traversal before OssClient encodes each path segment.
function mediaPath(value: unknown, extensions: string[]): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 512 || value !== value.trim()) return undefined
  if (/[\\:%?#\u0000-\u001f\u007f]/u.test(value)) return undefined
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part !== part.trim())) return undefined
  const extension = value.split('.').pop()?.toLowerCase()
  return extension && extensions.includes(extension) ? value : undefined
}

export function createPreviewMediaLoader(fetcher: typeof fetch = fetch, base = OSS_BASE_URL) {
  const catalogues = new Map<string, Promise<RecordValue>>()
  function catalogue(project: string): Promise<RecordValue> {
    const existing = catalogues.get(project)
    if (existing) return existing
    const request = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      try {
        const response = await fetcher(createOss(project, base).path('data.json'), { signal: controller.signal })
        if (!response.ok) throw new Error('Preview metadata unavailable')
        const data = record(await response.json())
        if (!data) throw new Error('Invalid preview metadata')
        return data
      } finally { clearTimeout(timer) }
    })()
    catalogues.set(project, request)
    void request.catch(() => { if (catalogues.get(project) === request) catalogues.delete(project) })
    return request
  }

  return async function loadPreviewMedia(card: Pick<ResourceCard, 'kind' | 'id' | 'resourceId'>): Promise<PreviewMedia | null> {
    const match = /^(sound|effect|bgm):(\d{1,12})$/u.exec(card.resourceId)
    if (!match || card.kind !== match[1] || String(card.id) !== match[2]) return null
    const id = match[2]
    if (card.kind === 'sound') return { kind: 'sound', src: createOss('SoundEffectPlayer', base).path('audio', `${id}.mp3`) }

    if (card.kind === 'effect') {
      const data = await catalogue('EffectPlayer')
      const row = record(record(data.effectData)?.[id])
      if (!row || String(row.id) !== id) return null
      const icon = mediaPath(row.icon, ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) || ''
      const standPath = mediaPath(row.standPath, ['mp4', 'webm'])
      const tailPath = mediaPath(row.tailPath, ['mp4', 'webm'])
      const audioPath = row.hasAudio === true ? mediaPath(row.audioPath, ['m4a', 'mp3', 'ogg', 'wav', 'aac']) : undefined
      if (!icon && !standPath && !tailPath && !audioPath) return null
      return { kind: 'effect', item: {
        id, icon, standPath, tailPath, audioPath, hasAudio: Boolean(audioPath),
        duration: positiveNumber(row.duration) || 0, isLoop: row.isLoop === true,
        tagList: Array.isArray(row.tagList) ? row.tagList.filter((tag): tag is number => typeof tag === 'number' && Number.isSafeInteger(tag)) : [],
      } }
    }

    const data = await catalogue('BgmPlayer')
    const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.musicData) ? data.musicData : []
    const row = rows.map(record).find(item => item && String(item.id) === id)
    const songId = positiveInteger(row?.song_id)
    if (!row || !songId) return null
    const minute = typeof row.minute === 'number' ? row.minute : NaN
    const second = typeof row.second === 'number' ? row.second : NaN
    const duration = Number.isFinite(minute) && minute >= 0 && Number.isFinite(second) && second >= 0 && second < 60
      ? positiveNumber(minute * 60 + second) : positiveNumber(row.duration)
    return { kind: 'bgm', songId, albumId: positiveInteger(row.album_id), duration,
      albumI18nKey: typeof row.albumI18nKey === 'string' ? row.albumI18nKey : undefined }
  }
}

export const loadPreviewMedia = createPreviewMediaLoader()
