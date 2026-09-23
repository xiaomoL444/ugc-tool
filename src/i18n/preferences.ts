export const localeStorageKey = "ugc-tools.locale";
export const defaultLocale = "zh-CN";
export const supportedLocales = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "ru-RU", label: "Русский" },
] as const;

export type AppLocale = typeof supportedLocales[number]["value"];

export function isAppLocale(value: unknown): value is AppLocale {
  return supportedLocales.some((locale) => locale.value === value);
}

export function resolveInitialLocale(savedLocale: unknown, browserLanguages: readonly string[]): AppLocale {
  if (isAppLocale(savedLocale)) return savedLocale;
  for (const language of browserLanguages) {
    const parts = language.toLowerCase().split(/[-_]/);
    const base = parts[0];
    if (base === "zh") {
      if (parts.includes("hans")) return "zh-CN";
      if (parts.some((part) => ["hant", "tw", "hk", "mo"].includes(part))) return "zh-TW";
      return "zh-CN";
    }
    if (base === "en") return "en-US";
    if (base === "ja") return "ja-JP";
    if (base === "ru") return "ru-RU";
  }
  return defaultLocale;
}
