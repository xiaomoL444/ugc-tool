import { onScopeDispose, watch } from "vue";
import { i18n } from "./index";
import type { AppLocale } from "./preferences";

/** Shared lifecycle for resources that follow the selected language. */
export function useLocaleResource<T>(
  loader: (locale: AppLocale, refresh: boolean) => Promise<T>,
  onLoaded?: (result: T, locale: AppLocale) => void,
  onLoading?: (locale: AppLocale) => void,
) {
  let enabled = false;
  let disposed = false;
  let revision = 0;
  async function load(refresh = false): Promise<T | undefined> {
    if (disposed) return undefined;
    enabled = true;
    const locale = i18n.global.locale.value as AppLocale;
    const request = ++revision;
    onLoading?.(locale);
    const result = await loader(locale, refresh);
    if (!disposed && request === revision && locale === i18n.global.locale.value) onLoaded?.(result, locale);
    return result;
  }
  watch(i18n.global.locale, () => { if (enabled) void load().catch(() => undefined); });
  onScopeDispose(() => { disposed = true; revision++; });
  return load;
}
