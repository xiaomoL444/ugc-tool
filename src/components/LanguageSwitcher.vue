<template>
  <div ref="root" class="language-picker" @focusout="onFocusOut" @keydown.esc.stop.prevent="close(true)">
    <button ref="trigger" type="button" class="language-trigger dropdown-trigger"
      :aria-label="`${t('app.language')}: ${currentLabel}`" aria-haspopup="menu"
      :aria-expanded="open" aria-controls="app-language-menu" :aria-describedby="open ? 'language-coverage-note' : undefined" @click="toggle"
      @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <svg class="language-globe" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" />
      </svg>
      <span :lang="locale">{{ currentLabel }}</span>
      <svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Transition name="dropdown">
      <div v-if="open" class="language-menu dropdown-menu">
        <div id="app-language-menu" ref="menu" role="menu"
          :aria-label="t('app.language')" @keydown="onMenuKeydown">
          <button v-for="language in supportedLocales" :key="language.value" type="button"
            class="dropdown-option"
            role="menuitemradio" :aria-checked="locale === language.value" :lang="language.value"
            tabindex="-1" @click="select(language.value)">
            <span>{{ language.label }}</span>
            <svg v-if="locale === language.value" class="dropdown-check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          </button>
        </div>
        <p id="language-coverage-note" class="language-coverage-note" :lang="locale">{{ coverageNote }}</p>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, supportedLocales } from '../i18n'
import type { AppLocale } from '../i18n'

const { t, locale } = useI18n({ useScope: 'global' })
const currentLabel = computed(() => supportedLocales.find(item => item.value === locale.value)?.label ?? locale.value)
const coverageNotes: Record<AppLocale, string> = {
  'zh-CN': '除简体中文外，其他语言尚未覆盖全部工具。目前查询类工具「音效播放器」、「特效播放器」和「BGM播放器」，以及「客户端 UI 动画编辑器」支持五种语言。',
  'zh-TW': '除簡體中文外，其他語言尚未涵蓋全部工具。目前查詢類工具「音效播放器」、「特效播放器」和「BGM播放器」，以及「用戶端 UI 動畫編輯器」支援五種語言。',
  'en-US': 'Languages other than Simplified Chinese do not yet cover all tools. Five-language support is currently available in the Sound Effect Player, Effect Player, and BGM Player lookup tools, as well as the Client UI Animation Editor.',
  'ja-JP': '簡体字中国語以外の言語には、まだすべてのツールが対応しているわけではありません。現在、「効果音プレイヤー」、「エフェクトプレイヤー」、「BGMプレーヤー」の検索ツールと「クライアント UI アニメーションエディター」は5言語に対応しています。',
  'ru-RU': 'Полная локализация всего сайта пока доступна только на упрощённом китайском. Пять языков поддерживаются в инструментах поиска «Проигрыватель звуковых эффектов», «Проигрыватель эффектов», «BGM-плеер», а также в «Редакторе анимаций клиентского UI».',
}
const coverageNote = computed(() => coverageNotes[locale.value as AppLocale] ?? coverageNotes['zh-CN'])
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)

async function show(last = false) {
  open.value = true
  await nextTick()
  const options = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
  const selected = supportedLocales.findIndex(item => item.value === locale.value)
  options?.[last ? supportedLocales.length - 1 : Math.max(0, selected)]?.focus()
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function toggle() {
  if (open.value) close()
  else void show()
}

function select(value: AppLocale) {
  setLocale(value)
  close(true)
}

function onMenuKeydown(event: KeyboardEvent) {
  const options = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  let next: number
  switch (event.key) {
    case 'ArrowDown': next = (index + 1) % options.length; break
    case 'ArrowUp': next = (index - 1 + options.length) % options.length; break
    case 'Home': next = 0; break
    case 'End': next = options.length - 1; break
    case 'Tab':
      // Return to the trigger before the browser moves focus out of the menu.
      close(true)
      return
    default: return
  }
  event.preventDefault()
  options[next]?.focus()
}

function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close()
}

function onPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<style scoped>
.language-picker { position: relative; flex-shrink: 0; z-index: 900; }
.language-globe { flex-shrink: 0; width: 19px; height: 19px; stroke: currentColor; stroke-width: 1.5; }
.language-coverage-note {
  margin: 8px 6px 4px; padding: 12px 8px 4px; border-top: 1px solid #e9e5f7;
  color: #73758b; font-size: 0.75rem; line-height: 1.65; text-align: left; overflow-wrap: anywhere;
}
@media (max-width: 480px) {
  .language-trigger { --dropdown-gap: 4px; --dropdown-padding: 6px; --dropdown-font-size: 0.8rem; }
}
@media (max-height: 600px) {
  .language-menu { max-height: calc(100dvh - 90px); overflow-y: auto; }
}
</style>
