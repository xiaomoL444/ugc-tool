import { normalizeAssetFeatureLocale } from '../../utils/assetFeatures';

const labels = {
  'zh-cn': { description: '资产描述', audio: '音效', standVisual: '主特效', tailVisual: '尾迹特效', keywords: '关键词', suggestedUses: '用途建议', expand: '查看完整资产描述' },
  'zh-tw': { description: '資產描述', audio: '音效', standVisual: '主特效', tailVisual: '尾跡特效', keywords: '關鍵詞', suggestedUses: '用途建議', expand: '查看完整資產描述' },
  'en-us': { description: 'Asset description', audio: 'Sound', standVisual: 'Main effect', tailVisual: 'Trail effect', keywords: 'Keywords', suggestedUses: 'Suggested uses', expand: 'Show the full asset description' },
  'ja-jp': { description: 'アセットの説明', audio: '効果音', standVisual: 'メインエフェクト', tailVisual: '軌跡エフェクト', keywords: 'キーワード', suggestedUses: '用途の提案', expand: 'アセットの説明を詳しく見る' },
  'ru-ru': { description: 'Описание ресурса', audio: 'Звук', standVisual: 'Основной эффект', tailVisual: 'След эффекта', keywords: 'Ключевые слова', suggestedUses: 'Возможное применение', expand: 'Показать полное описание ресурса' },
};

export function assetFeatureLabels(locale: string) {
  return labels[normalizeAssetFeatureLocale(locale) as keyof typeof labels] || labels['en-us'];
}
