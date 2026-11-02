import { computed } from "vue";
import { locale } from "../../i18n";
import { clientUIAnimationGuide } from "../../configs/clientUIAnimationGuide";

export function useEditorGuideLinks() {
  const videoUrl = computed(() => clientUIAnimationGuide.videoUrls[locale.value.startsWith("zh-") ? "zh" : "en"]);
  // A new version bypasses CDN copies of the previous handbook at the same path.
  const handbookDownloadUrl = `${clientUIAnimationGuide.manual.url}?v=${encodeURIComponent(clientUIAnimationGuide.manual.version)}`;
  return { videoUrl, handbookDownloadUrl };
}
