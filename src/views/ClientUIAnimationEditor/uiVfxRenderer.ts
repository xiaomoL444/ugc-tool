/**
 * OSS player.js describes packed C/T video: result = C + background * T.
 * Its opaque WebGL canvas accepts only a solid background. For a live DOM
 * backdrop, draw T with CSS multiply and then C with plus-lighter. Keep both
 * canvases in the backdrop's stacking context (no transformed wrapper).
 * Splitting with drawImage retains the browser's native video color conversion.
 */
export function attachUIVfxRenderer(video: HTMLVideoElement, transmission: HTMLCanvasElement, emission: HTMLCanvasElement,
  options: { onFrame: () => void; onError: () => void }) {
  const t = transmission.getContext("2d", { alpha: false });
  const c = emission.getContext("2d", { alpha: false });
  if (!t || !c) throw new Error("Canvas 2D is unavailable");
  let frame = 0, videoFrame = 0, destroyed = false, lastTime = -1;
  const listeners: Array<() => void> = [];
  function cancel() {
    cancelAnimationFrame(frame); frame = 0;
    if (videoFrame && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoFrame);
    videoFrame = 0;
  }
  function draw() {
    if (destroyed || video.readyState < 2) return;
    if (!video.videoWidth || video.videoWidth % 2 || !video.videoHeight) throw new Error("Invalid C/T video dimensions");
    if (lastTime === video.currentTime) return;
    const width = video.videoWidth / 2, height = video.videoHeight;
    for (const canvas of [transmission, emission]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    t!.drawImage(video, width, 0, width, height, 0, 0, width, height);
    c!.drawImage(video, 0, 0, width, height, 0, 0, width, height);
    lastTime = video.currentTime;
    options.onFrame();
  }
  function tick() {
    cancel();
    if (destroyed) return;
    try { draw(); } catch { options.onError(); return; }
    if (video.paused || video.ended) return;
    if (video.requestVideoFrameCallback) videoFrame = video.requestVideoFrameCallback(tick);
    else frame = requestAnimationFrame(tick);
  }
  for (const name of ["loadeddata", "play", "seeked", "pause", "ended"]) {
    video.addEventListener(name, tick); listeners.push(() => video.removeEventListener(name, tick));
  }
  const reset = () => { cancel(); lastTime = -1; };
  video.addEventListener("emptied", reset); listeners.push(() => video.removeEventListener("emptied", reset));
  return { draw: tick, destroy() { destroyed = true; cancel(); listeners.forEach(remove => remove()); } };
}
