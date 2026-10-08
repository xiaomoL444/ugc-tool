type PreviewStop = () => void

const previewStops = new Set<PreviewStop>()

/** Register a stable callback that also cancels any pending playback request. */
export function registerPreviewStop(stop: PreviewStop): () => void {
  previewStops.add(stop)
  return () => previewStops.delete(stop)
}

/** Call before starting playback so only one result-card preview can play. */
export function claimPreviewPlayback(stop: PreviewStop): void {
  for (const otherStop of previewStops) {
    if (otherStop !== stop) otherStop()
  }
}
