import ruRUStructViewer from "./locales/structViewer/ru-ru.json";
import zhCNCommon from "./locales/common/zh-cn.json";
import zhCNStructViewer from "./locales/structViewer/zh-cn.json";
import zhCNEffectPlayer from "./locales/effectPlayer/zh-cn.json";
import zhCNSoundEffectPlayer from "./locales/soundEffectPlayer/zh-cn.json";
import zhCNHomePage from "./locales/homePage/zh-cn.json";
import zhCNBgmPlayer from "./locales/bgmPlayer/zh-cn.json";
import zhCNAiSearch from "./locales/aiSearch/zh-cn.json";
import zhCNClientUIAnimationEditor from "./locales/clientUIAnimationEditor/zh-cn.json";
import jaJPStructViewer from "./locales/structViewer/ja-jp.json";
import enUSStructViewer from "./locales/structViewer/en-us.json";
import zhTWStructViewer from "./locales/structViewer/zh-tw.json";
import ruRUBgmPlayer from "./locales/bgmPlayer/ru-ru.json";
import zhTWAiSearch from "./locales/aiSearch/zh-tw.json";
import enUSAiSearch from "./locales/aiSearch/en-us.json";
import jaJPAiSearch from "./locales/aiSearch/ja-jp.json";
import ruRUAiSearch from "./locales/aiSearch/ru-ru.json";
import jaJPBgmPlayer from "./locales/bgmPlayer/ja-jp.json";
import enUSBgmPlayer from "./locales/bgmPlayer/en-us.json";
import zhTWBgmPlayer from "./locales/bgmPlayer/zh-tw.json";
import { createI18n } from "vue-i18n";
import enUSCommon from "./locales/common/en-us.json";
import enUSEffectPlayer from "./locales/effectPlayer/en-us.json";
import enUSSoundEffectPlayer from "./locales/soundEffectPlayer/en-us.json";
import zhTWSoundEffectPlayer from "./locales/soundEffectPlayer/zh-tw.json";
import jaJPSoundEffectPlayer from "./locales/soundEffectPlayer/ja-jp.json";
import ruRUSoundEffectPlayer from "./locales/soundEffectPlayer/ru-ru.json";
import enUSHomePage from "./locales/homePage/en-us.json";
import zhTWHomePage from "./locales/homePage/zh-tw.json";
import jaJPHomePage from "./locales/homePage/ja-jp.json";
import ruRUHomePage from "./locales/homePage/ru-ru.json";
import { defaultLocale, isAppLocale, localeStorageKey, resolveInitialLocale, supportedLocales } from "./preferences";
import type { AppLocale } from "./preferences";
import { createOss, OSS_BASE_URL } from "../utils/oss";
import { RemoteI18nLoader } from "./remote";
import type { MessageTree } from "./remote";
import type { RemoteTranslationLoadOptions } from "./remote";
import zhTWClientUIAnimationEditor from "./locales/clientUIAnimationEditor/zh-tw.json";
import enUSClientUIAnimationEditor from "./locales/clientUIAnimationEditor/en-us.json";
import jaJPClientUIAnimationEditor from "./locales/clientUIAnimationEditor/ja-jp.json";
import ruRUClientUIAnimationEditor from "./locales/clientUIAnimationEditor/ru-ru.json";

import zhTWCommon from "./locales/common/zh-tw.json";
import zhTWEffectPlayer from "./locales/effectPlayer/zh-tw.json";
import jaJPCommon from "./locales/common/ja-jp.json";
import jaJPEffectPlayer from "./locales/effectPlayer/ja-jp.json";
import ruRUCommon from "./locales/common/ru-ru.json";
import ruRUEffectPlayer from "./locales/effectPlayer/ru-ru.json";

export { supportedLocales, isAppLocale, normalizeAppLocale } from "./preferences";
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
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      "zh-CN": { ...zhCNCommon, ...zhCNStructViewer, ...zhCNEffectPlayer, ...zhCNSoundEffectPlayer, ...zhCNHomePage, ...zhCNBgmPlayer, ...zhCNAiSearch, ...zhCNClientUIAnimationEditor },
      "en-US": { ...enUSCommon, ...enUSStructViewer, ...enUSEffectPlayer, ...enUSSoundEffectPlayer, ...enUSHomePage, ...enUSBgmPlayer, ...enUSAiSearch, ...enUSClientUIAnimationEditor },
      "zh-TW": { ...zhTWCommon, ...zhTWStructViewer, ...zhTWEffectPlayer, ...zhTWSoundEffectPlayer, ...zhTWHomePage, ...zhTWBgmPlayer, ...zhTWAiSearch, ...zhTWClientUIAnimationEditor },
      "ja-JP": { ...jaJPCommon, ...jaJPStructViewer, ...jaJPEffectPlayer, ...jaJPSoundEffectPlayer, ...jaJPHomePage, ...jaJPBgmPlayer, ...jaJPAiSearch, ...jaJPClientUIAnimationEditor },
      "ru-RU": { ...ruRUCommon, ...ruRUStructViewer, ...ruRUEffectPlayer, ...ruRUSoundEffectPlayer, ...ruRUHomePage, ...ruRUBgmPlayer, ...ruRUAiSearch, ...ruRUClientUIAnimationEditor },
    },
  });
}

export const i18n = createAppI18n();

/** Translate immediately; saved messages are ordinary strings in their original language. */
export const t = i18n.global.t;
export const locale = i18n.global.locale;

export const remoteI18n = new RemoteI18nLoader({
  getLocaleMessage: (locale) => i18n.global.getLocaleMessage(locale) as MessageTree,
  setLocaleMessage: (locale, messages) => i18n.global.setLocaleMessage<MessageTree>(locale, messages),
});

export interface OssTranslationLoadOptions extends RemoteTranslationLoadOptions {
  locale?: AppLocale;
  keyPrefix?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

// Injected data sources have isolated stores; production consumers share remoteI18n.
const injectedLoaders = new WeakMap<typeof fetch, Map<string, RemoteI18nLoader>>();
function ossLoader(options: OssTranslationLoadOptions) {
  if (!options.fetcher && (!options.baseUrl || options.baseUrl === OSS_BASE_URL)) return remoteI18n;
  const fetcher = options.fetcher ?? fetch;
  let contexts = injectedLoaders.get(fetcher);
  if (!contexts) { contexts = new Map(); injectedLoaders.set(fetcher, contexts); }
  const base = (options.baseUrl ?? OSS_BASE_URL).replace(/\/+$/, "");
  let loader = contexts.get(base);
  if (!loader) {
    const messages = new Map<string, MessageTree>();
    loader = new RemoteI18nLoader({
      getLocaleMessage: locale => messages.get(locale) ?? {},
      setLocaleMessage: (locale, value) => { messages.set(locale, value); },
    }, { fetch: fetcher });
    contexts.set(base, loader);
  }
  return loader;
}

function ossSource(project: string, namespace: string, directory: string, options: OssTranslationLoadOptions) {
  const locale = options.locale ?? i18n.global.locale.value as AppLocale;
  return { namespace, locale, keyPrefix: options.keyPrefix,
    url: createOss(project, options.baseUrl).path(directory, `${locale.toLowerCase()}.json`) };
}

function ossLoadOptions(project: string, options: OssTranslationLoadOptions): OssTranslationLoadOptions {
  // Player dictionaries include asset descriptions and can be several MB. Apply
  // the same deadline to name-first consumers sharing the in-flight request.
  const assetDictionary = ["SoundEffectPlayer", "EffectPlayer", "BgmPlayer"].includes(project);
  return assetDictionary && options.timeoutMs === undefined ? { ...options, timeoutMs: 60_000 } : options;
}

/** Reuse the current language snapshot; refresh only when explicitly requested. */
export function loadOssTranslations(project: string, namespace: string, directory = "i18n",
  options: OssTranslationLoadOptions = {}) {
  return Promise.all([ossLoader(options).load(ossSource(project, namespace, directory, options), ossLoadOptions(project, options))]);
}

/** The same request/cache as display translations, with raw text for data consumers. */
export async function loadOssTranslationDictionary(project: string, namespace: string, directory = "i18n",
  options: OssTranslationLoadOptions = {}) {
  const loader = ossLoader(options);
  const source = ossSource(project, namespace, directory, options);
  const result = await loader.load(source, ossLoadOptions(project, options));
  if (options.maxBytes !== undefined && loader.getDictionaryBytes(namespace, source.locale) > options.maxBytes) {
    return { result: { status: "failed" as const, namespace, locale: source.locale,
      error: new Error("Translation file exceeds the consumer size limit") }, dictionary: undefined };
  }
  return { result, dictionary: loader.getDictionary(namespace, source.locale) };
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
