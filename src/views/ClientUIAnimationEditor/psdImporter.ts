import type { PsdImportResult } from "./psdImportData";

export async function importPsdFile(file: File, progress: (done: number, total: number) => void): Promise<PsdImportResult> {
  if (file.size > 128 * 1024 * 1024) throw new Error("PSD 文件不能超过 128 MB，请先精简图层。");
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") throw new Error("当前浏览器不支持 PSD 后台解码，请使用新版 Chrome、Edge 或 Firefox。");
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("./psdImport.worker.ts", import.meta.url));
  try {
    return await new Promise<PsdImportResult>((resolve, reject) => {
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error("PSD 解析超时，请缩小文件后重试。")); }, 120000);
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") { progress(data.done, data.total); return; }
        clearTimeout(timeout);
        if (data.type === "result") resolve(data.result);
        else reject(new Error(data.message || "PSD 解析失败。"));
      };
      worker.onerror = event => { event.preventDefault(); clearTimeout(timeout); reject(new Error("PSD 解码失败，请检查文件或减少图层数量。")); };
      try { worker.postMessage({ buffer, name: file.name.replace(/\.psd$/i, "") }, [buffer]); }
      catch (error) { clearTimeout(timeout); reject(error); }
    });
  } finally { worker.terminate(); }
}
