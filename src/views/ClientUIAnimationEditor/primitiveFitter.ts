import { t } from "../../i18n";
import { convertPrimitiveFit, normalizePrimitiveOptions, primitiveWorkerLimit, type PrimitiveFitData, type PrimitiveFitOptions } from "./primitiveData";
import { primitiveImageSource } from "./primitiveControl";
import { preparePrimitivePixels } from "./primitivePixels";

export interface FitProgress { done: number; total: number; phase: "image" | "engine" | "fit" }
type WorkerReply = { type: string; jobId?: number; json?: string; error?: string; message?: string; rgba?: Uint8Array; score?: number };
const aborted = () => Object.assign(new Error(t("clientUIAnimationEditor.ui.primitiveFit.generationCancelled")), { name: "AbortError" });
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw aborted(); }

class FitWorker {
  readonly ready: Promise<void>;
  private worker: Worker;
  private rejectReady!: (reason: Error) => void;
  private bootTimer: ReturnType<typeof setTimeout>;
  private pending = new Map<number, { resolve: (value: WorkerReply) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private disposed = false;
  constructor() {
    this.worker = new Worker(`${process.env.BASE_URL}primitive-wasm/fit_worker.js?v=alpha-edge-1`);
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.type === "ready") { clearTimeout(this.bootTimer); resolve(); return; }
        if (data.type === "boot_error") { this.dispose(new Error(data.message || t("clientUIAnimationEditor.ui.primitiveFit.engineLoadFailed"))); return; }
        const request = this.pending.get(data.jobId ?? -1);
        if (!request) return;
        this.pending.delete(data.jobId!); clearTimeout(request.timer);
        if (data.error) request.reject(new Error(data.error)); else request.resolve(data);
      };
      this.worker.onerror = event => { event.preventDefault(); this.dispose(new Error(t("clientUIAnimationEditor.ui.primitiveFit.engineExecutionFailed"))); };
    });
    void this.ready.catch(() => { /* Also handled when a later worker fails during construction. */ });
    this.bootTimer = setTimeout(() => this.dispose(new Error(t("clientUIAnimationEditor.ui.primitiveFit.engineLoadTimeout"))), 45000);
  }
  call(type: string, payload: Record<string, unknown> = {}): Promise<WorkerReply> {
    if (this.disposed) return Promise.reject(aborted());
    const jobId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(new Error(t("clientUIAnimationEditor.ui.primitiveFit.stepTimeout"))), 120000);
      this.pending.set(jobId, { resolve, reject, timer });
      try { this.worker.postMessage({ ...payload, type, jobId }); }
      catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  dispose(reason: Error = aborted()) {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.bootTimer); this.worker.terminate(); this.rejectReady(reason);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    this.pending.clear();
  }
}

function parseReply(reply: WorkerReply): Record<string, any> {
  const value = JSON.parse(reply.json || "null");
  if (!value || typeof value !== "object" || value.error) throw new Error(value?.error || t("clientUIAnimationEditor.ui.primitiveFit.invalidEngineResult"));
  return value;
}

async function prepareImage(source: string, options: PrimitiveFitOptions, signal: AbortSignal) {
  checkAbort(signal);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const clean = () => { image.onload = image.onerror = null; signal.removeEventListener("abort", cancel); };
    const cancel = () => { clean(); image.src = ""; reject(aborted()); };
    image.onload = () => { clean(); resolve(); };
    image.onerror = () => { clean(); reject(new Error(t("clientUIAnimationEditor.ui.primitiveFit.imageReadCorsHint"))); };
    signal.addEventListener("abort", cancel, { once: true });
    if (/^https?:/i.test(source)) image.crossOrigin = "anonymous";
    image.src = source;
  });
  checkAbort(signal);
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 16000000 || width > 32768 || height > 32768) throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.invalidImageDimensions"));
  const ratio = Math.min(1, options.resolution / Math.max(width, height));
  const workWidth = Math.max(1, Math.round(width * ratio)), workHeight = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement("canvas"); canvas.width = workWidth; canvas.height = workHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.imageCanvasUnavailable"));
  context.drawImage(image, 0, 0, workWidth, workHeight);
  let pixels: Uint8ClampedArray;
  try { pixels = context.getImageData(0, 0, workWidth, workHeight).data; }
  catch { throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.imageCrossOriginDenied")); }
  const { rgba, alpha, hasAlpha, visible } = preparePrimitivePixels(pixels, options.transparent);
  canvas.width = canvas.height = 1;
  if (!visible) throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.fullyTransparentImage"));
  return { width, height, workWidth, workHeight, rgba, alpha, transparent: options.transparent && hasAlpha };
}

/** No upstream HTTP API: only static engine assets are downloaded. */
export async function fitPrimitiveImage(source: string, settings: PrimitiveFitOptions, signal: AbortSignal, progress: (value: FitProgress) => void): Promise<PrimitiveFitData> {
  const safeSource = primitiveImageSource(source);
  if (!safeSource) throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.selectImageFirst"));
  const options = normalizePrimitiveOptions(settings);
  progress({ phase: "image", done: 0, total: options.count });
  const image = await prepareImage(safeSource, options, signal);
  checkAbort(signal);
  progress({ phase: "engine", done: 0, total: options.count });
  const workers: FitWorker[] = [];
  const cancel = () => workers.forEach(worker => worker.dispose());
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const count = Math.min(options.workers, primitiveWorkerLimit(navigator.hardwareConcurrency));
    for (let i = 0; i < count; i++) workers.push(new FitWorker());
    await Promise.all(workers.map(worker => worker.ready)); checkAbort(signal);
    const config = { full_w: image.width, full_h: image.height, work_w: image.workWidth, work_h: image.workHeight,
      num_primitives: options.count, allowed_shapes: options.shapes.map(s => s === "ellipse" ? "circle" : s === "rectangle" ? "rect" : "triangle"), transparent: image.transparent, mask_threshold: 127 };
    const init = await Promise.all(workers.map(worker => worker.call("init", { config, rgba: image.rgba, alpha: image.alpha }).then(parseReply)));
    const steps: number[] = init[0].steps;
    if (!init.every(item => item.ok) || !Array.isArray(steps) || steps.length !== options.count) throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.initializationFailed"));
    let state = await workers[0].call("state");
    progress({ phase: "fit", done: 0, total: steps.length });
    for (let i = 0; i < steps.length; i++) {
      checkAbort(signal);
      const candidates = await Promise.all(workers.map((worker, index) => worker.call("search", {
        rgba: index ? state.rgba : null, score: state.score, mode: steps[i], wm: Math.ceil(16 / workers.length), nonce: index * 131 + i,
      }).then(parseReply)));
      if (!candidates.every(item => typeof item.energy === "number" && Number.isFinite(item.energy))) throw new Error(t("clientUIAnimationEditor.ui.primitiveFit.invalidCandidate"));
      const best = candidates.reduce((a, b) => a.energy <= b.energy ? a : b);
      state = await workers[0].call("apply", { candidate: JSON.stringify(best) });
      progress({ phase: "fit", done: i + 1, total: steps.length });
    }
    const result = parseReply(await workers[0].call("finish")); checkAbort(signal);
    return convertPrimitiveFit(result, image.width, image.height, !image.transparent);
  } finally { signal.removeEventListener("abort", cancel); cancel(); }
}
