<template>
  <div ref="root" class="language-picker" @focusout="onFocusOut" @keydown.esc.stop.prevent="close(true)">
    <button ref="trigger" type="button" class="language-trigger" :class="{ 'is-open': open }"
      :aria-label="`${t('app.language')}: ${currentLabel}`" aria-haspopup="menu"
      :aria-expanded="open" aria-controls="app-language-menu" :aria-describedby="open ? 'language-coverage-note' : undefined" @click="toggle"
      @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <svg class="language-globe" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" />
      </svg>
      <span :lang="locale">{{ currentLabel }}</span>
      <svg class="language-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Transition name="language-menu">
      <div v-if="open" class="language-menu">
        <div id="app-language-menu" ref="menu" role="menu"
          :aria-label="t('app.language')" @keydown="onMenuKeydown">
          <button v-for="language in supportedLocales" :key="language.value" type="button"
            class="language-option" :class="{ 'is-selected': locale === language.value }"
            role="menuitemradio" :aria-checked="locale === language.value" :lang="language.value"
            tabindex="-1" @click="select(language.value)">
            <span>{{ language.label }}</span>
            <svg v-if="locale === language.value" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
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
  'zh-CN': '除简体中文外，其他语言尚未全面适配。目前仅查询类工具「音效播放器」和「特效播放器」支持多语言。',
  'zh-TW': '除簡體中文外，其他語言尚未全面適配。目前僅查詢類工具「音效播放器」和「特效播放器」支援多語言。',
  'en-US': 'Languages other than Simplified Chinese are not fully supported. Multilingual support is currently limited to the Sound Effect Player and Effect Player lookup tools.',
  'ja-JP': '簡体字中国語以外の言語には、まだ完全には対応していません。現在、多言語に対応しているのは検索ツールの「効果音プレイヤー」と「エフェクトプレイヤー」のみです。',
  'ru-RU': 'Полная локализация доступна только на упрощённом китайском. Другие языки пока поддерживаются лишь в инструментах поиска «Проигрыватель звуковых эффектов» и «Проигрыватель эффектов».',
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
.language-trigger {
  display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px;
  border: 1px solid rgba(106, 90, 205, 0.25); border-radius: 10px;
  background: rgba(255, 255, 255, 0.75); color: #35476b;
  font: inherit; font-size: 0.9rem; white-space: nowrap; cursor: pointer;
  transition: background 150ms, border-color 150ms;
}
.language-trigger:hover, .language-trigger.is-open { background: #fff; border-color: #887bd7; }
.language-trigger:focus-visible { outline: 2px solid #887bd7; outline-offset: 3px; }
.language-picker svg { flex-shrink: 0; width: 19px; height: 19px; stroke: currentColor; stroke-width: 1.5; }
.language-picker .language-chevron { width: 14px; height: 14px; transition: transform 150ms; }
.is-open .language-chevron { transform: rotate(180deg); }
.language-menu {
  position: absolute; top: calc(100% + 12px); right: 0; width: 260px;
  max-width: calc(100vw - 20px); padding: 8px; box-sizing: border-box;
  border: 1px solid #e9e5f7; border-radius: 16px; background: #fff;
  box-shadow: 0 12px 36px rgba(53, 39, 108, 0.16); transform-origin: top right;
}
.language-menu::before {
  content: ''; position: absolute; top: -6px; right: 22px; width: 10px; height: 10px;
  background: #fff; border-top: 1px solid #e9e5f7; border-left: 1px solid #e9e5f7; transform: rotate(45deg);
}
.language-option {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  width: 100%; min-height: 46px; padding: 10px 14px; border: 0; border-radius: 9px;
  background: transparent; color: #555b70; font: inherit; font-size: 0.95rem; text-align: left; cursor: pointer;
}
.language-option:hover, .language-option:focus-visible { background: #f0edff; outline: none; }
.language-option.is-selected { color: #6a5acd; }
.language-option svg { stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.language-coverage-note {
  margin: 8px 6px 4px; padding: 12px 8px 4px; border-top: 1px solid #e9e5f7;
  color: #73758b; font-size: 0.75rem; line-height: 1.65; text-align: left; overflow-wrap: anywhere;
}
.language-menu-enter-active, .language-menu-leave-active { transition: opacity 150ms, transform 150ms; }
.language-menu-enter-from, .language-menu-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }
@media (max-width: 480px) {
  .language-trigger { gap: 4px; padding: 0 6px; font-size: 0.8rem; }
}
@media (max-height: 600px) {
  .language-menu { max-height: calc(100dvh - 90px); overflow-y: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .language-trigger, .language-chevron, .language-coverage-note {
  margin: 8px 6px 4px; padding: 12px 8px 4px; border-top: 1px solid #e9e5f7;
  color: #73758b; font-size: 0.75rem; line-height: 1.65; text-align: left; overflow-wrap: anywhere;
}
.language-menu-enter-active, .language-menu-leave-active { transition: none; }
}
</style>
