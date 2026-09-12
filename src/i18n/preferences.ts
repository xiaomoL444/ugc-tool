export const localeStorageKey = "ugc-tools.locale";
export const defaultLocale = "zh-CN";
export const supportedLocales = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
] as const;

export type AppLocale = typeof supportedLocales[number]["value"];

export function isAppLocale(value: unknown): value is AppLocale {
  return supportedLocales.some((locale) => locale.value === value);
}

export function resolveInitialLocale(savedLocale: unknown, browserLanguages: readonly string[]): AppLocale {
  if (isAppLocale(savedLocale)) return savedLocale;
  for (const language of browserLanguages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en-US";
  }
  return defaultLocale;
}
