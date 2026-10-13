import { t, normalizeAppLocale } from '../../i18n';

const fields = ['description', 'audio', 'standVisual', 'tailVisual', 'keywords', 'suggestedUses', 'expand'] as const;

export function assetFeatureLabels(locale: string) {
  const language = normalizeAppLocale(locale);
  return Object.fromEntries(fields.map(field => {
    const key = `assetFeatures.ui.${field}`;
    return [field, language ? t(key, {}, { locale: language }) : key];
  })) as Record<typeof fields[number], string>;
}
