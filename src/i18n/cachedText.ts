import { computed } from "vue";
import type { Composer } from "vue-i18n";

/** Cache parameterless resource labels until the language or its catalog changes. */
export function createCachedText(composer: Pick<Composer, "locale" | "messages" | "t" | "te">) {
  const snapshot = computed(() => ({
    locale: composer.locale.value,
    messages: (composer.messages.value as Record<string, unknown>)[composer.locale.value],
    cache: new Map<string, string>(),
  }));
  return (key: string): string => {
    const { cache, locale } = snapshot.value;
    if (cache.has(key)) return cache.get(key)!;
    // An absent remote translation is normal while loading or for partial catalogs.
    const text = composer.te(key, locale) ? composer.t(key) : key;
    cache.set(key, text);
    return text;
  };
}
