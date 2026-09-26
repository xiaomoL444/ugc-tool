/** Preserve transients across every channel, including stereo signals that cancel when mixed. */
export function samplePeaks(channels: Float32Array[], count = 128): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length || count <= 0) return [];
  const peaks = Array.from({ length: Math.min(count, length) }, () => 0);
  for (let bar = 0; bar < peaks.length; bar++) {
    const start = Math.floor(bar * length / peaks.length);
    const end = Math.floor((bar + 1) * length / peaks.length);
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        peaks[bar] = Math.max(peaks[bar], Math.abs(channel[i] || 0));
      }
    }
  }
  const maximum = Math.max(...peaks);
  return maximum ? peaks.map((peak) => peak / maximum) : peaks;
}
