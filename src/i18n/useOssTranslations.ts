import { loadOssTranslations } from "./index";
import { useLocaleResource } from "./useLocaleResource";
import type { AppLocale } from "./preferences";
import type { RemoteTranslationResult } from "./remote";

/** Enable after the page's index loads, and stop loading when its scope is disposed. */
export function useOssTranslations(project: string, namespace: string, directory = "i18n",
  onLoaded?: (results: RemoteTranslationResult[], locale: AppLocale) => void,
  options: { keyPrefix?: string } = {}) {
  const load = useLocaleResource((locale, refresh) => loadOssTranslations(project, namespace, directory, {
    ...options, locale, refresh,
  }), onLoaded);
  return async (refresh = false): Promise<RemoteTranslationResult[]> => (await load(refresh)) ?? [];
}
