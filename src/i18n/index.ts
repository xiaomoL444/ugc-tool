import { createI18n } from "vue-i18n";
import zhCNCommon from "./locales/common/zh-cn.json";
import enUSCommon from "./locales/common/en-us.json";
import zhCNEffectPlayer from "./locales/effectPlayer/zh-cn.json";
import enUSEffectPlayer from "./locales/effectPlayer/en-us.json";
import zhCNSoundEffectPlayer from "./locales/soundEffectPlayer/zh-cn.json";
import enUSSoundEffectPlayer from "./locales/soundEffectPlayer/en-us.json";
import { defaultLocale, isAppLocale, localeStorageKey, resolveInitialLocale, supportedLocales } from "./preferences";
import type { AppLocale } from "./preferences";
import { createOss } from "../utils/oss";
import { RemoteI18nLoader } from "./remote";
import type { MessageTree } from "./remote";

export { supportedLocales, isAppLocale } from "./preferences";
export type { AppLocale } from "./preferences";

export function createAppI18n(locale: AppLocale = defaultLocale) {
  return createI18n({
    legacy: false,
    flatJson: true,
    locale,
    // Empty decision chains also disable implicit regional fallback (en-US → en).
    // fallbackLocale: false only disables explicit fallback languages.
    fallbackLocale: Object.fromEntries([
      ...supportedLocales.map(({ value }) => [value, [] as string[]]),
      ["default", [] as string[]],
    ]),
    fallbackFormat: false,
    messages: {
      "zh-CN": { ...zhCNCommon, ...zhCNEffectPlayer, ...zhCNSoundEffectPlayer },
      "en-US": { ...enUSCommon, ...enUSEffectPlayer, ...enUSSoundEffectPlayer },
    },
  });
}

export const i18n = createAppI18n();

export const remoteI18n = new RemoteI18nLoader({
  getLocaleMessage: (locale) => i18n.global.getLocaleMessage(locale) as MessageTree,
  setLocaleMessage: (locale, messages) => i18n.global.setLocaleMessage<MessageTree>(locale, messages),
});

/** Load each supported language independently, preserving multilingual search. */
export function loadOssTranslations(project: string, namespace: string, directory = "i18n") {
  const oss = createOss(project);
  return Promise.all(supportedLocales.map(({ value: locale }) => remoteI18n.load({
    namespace,
    locale,
    url: oss.path(directory, `${locale.toLowerCase()}.json`),
  })));
}

export function setLocale(locale: AppLocale) {
  if (!isAppLocale(locale)) return;
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Language switching still works when browser storage is unavailable.
  }
}

export function initializeLocale() {
  let savedLocale: string | null = null;
  try {
    savedLocale = localStorage.getItem(localeStorageKey);
  } catch {
    // Use browser preferences when storage is unavailable.
  }
  setLocale(resolveInitialLocale(savedLocale, navigator.languages?.length ? navigator.languages : [navigator.language]));
}
