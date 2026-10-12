export type RequestAbortReason = "search_timeout" | "details_timeout" | "user_cancelled";
export const CUSTOM_SEARCH_TIMEOUT_MS = 180000;
export const ASSET_DETAILS_TIMEOUT_MS = 20000;

export function requestAbortError(abortReason: RequestAbortReason, startedAt = Date.now()): DOMException {
  const message = abortReason === "user_cancelled" ? "Search cancelled by the user."
    : abortReason === "details_timeout" ? "Asset details exceeded their time limit." : "Search exceeded its time limit.";
  return Object.assign(new DOMException(message, abortReason === "user_cancelled" ? "AbortError" : "TimeoutError"), { abortReason, startedAt });
}

/** Abort also settles callers whose transport or response reader ignores the signal. */
export function awaitRequest<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation();
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      return operation();
    }).then(value => signal.aborted ? aborted() : resolve(value), reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

export function createRequestDeadline(parentSignal: AbortSignal, timeoutMs: number,
  abortReason: "search_timeout" | "details_timeout", startedAt = Date.now()) {
  const controller = new AbortController();
  const cancel = () => controller.abort(parentSignal.reason ?? new DOMException("Aborted", "AbortError"));
  if (parentSignal.aborted) cancel(); else parentSignal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(requestAbortError(abortReason, startedAt)), timeoutMs);
  return {
    signal: controller.signal,
    run<T>(operation: (signal: AbortSignal) => Promise<T>) { return awaitRequest(() => operation(controller.signal), controller.signal); },
    dispose() { clearTimeout(timer); parentSignal.removeEventListener("abort", cancel); },
  };
}
