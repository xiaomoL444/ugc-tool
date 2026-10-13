import { ref, shallowRef } from "vue";
import { useLocaleResource } from "../i18n/useLocaleResource";
import { loadAssetFeatures } from "./assetFeatures";
import type { AssetFeatureCollection, AssetFeatureIdentity, AssetFeatureProject } from "./assetFeatures";

/** Keep optional descriptions aligned with the active page and selected language. */
export function useAssetFeatures(project: AssetFeatureProject, identities: () => readonly AssetFeatureIdentity[]) {
  const assetFeatures = shallowRef<AssetFeatureCollection | null>(null);
  const featuresLoading = ref(true);
  const loadFeatures = useLocaleResource(
    (locale, refresh) => loadAssetFeatures(project, identities(), { locale, force: refresh }),
    (features) => { assetFeatures.value = features; featuresLoading.value = false; },
    () => { featuresLoading.value = true; assetFeatures.value = null; },
  );
  return { assetFeatures, featuresLoading, loadFeatures };
}
