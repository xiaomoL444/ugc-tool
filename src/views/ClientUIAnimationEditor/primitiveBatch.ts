import { normalizePrimitiveOptions } from "./primitiveData";
import type { fitPrimitiveImage, FitProgress } from "./primitiveFitter";
import type { PrimitiveImageResource } from "./primitiveResources";

export interface PrimitiveBatchProgress {
  index: number;
  total: number;
  name: string;
  progress?: FitProgress;
}

/** Run one fit at a time; each fit owns its own parallel worker pool. */
export async function fitMissingPrimitiveResources(
  getAssets: () => PrimitiveImageResource[],
  fit: typeof fitPrimitiveImage,
  save: (asset: PrimitiveImageResource) => Promise<void>,
  signal: AbortSignal,
  report: (value: PrimitiveBatchProgress) => void,
) {
  const ids = getAssets().filter(asset => asset.imageUrl && !asset.fitData).map(asset => asset.id);
  const result = { generated: 0, skipped: 0, failures: [] as { name: string; message: string }[], cancelled: false };
  for (const [index, id] of ids.entries()) {
    if (signal.aborted) break;
    const asset = getAssets().find(item => item.id === id);
    if (!asset?.imageUrl || asset.fitData) { result.skipped++; continue; }
    const source = asset.imageUrl, options = normalizePrimitiveOptions(asset.fitOptions);
    report({ index: index + 1, total: ids.length, name: asset.name });
    try {
      const fitData = await fit(source, options, signal, progress => {
        if (!signal.aborted) report({ index: index + 1, total: ids.length, name: asset.name, progress });
      });
      if (signal.aborted) break;
      const current = getAssets().find(item => item.id === id);
      // A document edit during fitting must never be overwritten by a stale result.
      if (!current || current.imageUrl !== source || current.fitData
        || JSON.stringify(normalizePrimitiveOptions(current.fitOptions)) !== JSON.stringify(options)) {
        result.skipped++; continue;
      }
      await save({ ...current, fitData, fitOptions: options, previewMode: "primitives" });
      result.generated++;
    } catch (error) {
      if (signal.aborted) break;
      result.failures.push({ name: asset.name, message: error instanceof Error ? error.message : "生成失败" });
    }
  }
  result.cancelled = signal.aborted;
  return result;
}
