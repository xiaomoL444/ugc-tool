import { t, locale } from "../../i18n";
import type { PsdImportResult } from "./psdImportData";

export async function importPsdFile(file: File, progress: (done: number, total: number) => void): Promise<PsdImportResult> {
  if (file.size > 128 * 1024 * 1024) throw new Error(t("clientUIAnimationEditor.ui.psdImport.fileTooLarge"));
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") throw new Error(t("clientUIAnimationEditor.ui.psdImport.backgroundDecodeUnsupported"));
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("./psdImport.worker.ts", import.meta.url));
  try {
    return await new Promise<PsdImportResult>((resolve, reject) => {
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error(t("clientUIAnimationEditor.ui.psdImport.parseTimeout"))); }, 120000);
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") { progress(data.done, data.total); return; }
        clearTimeout(timeout);
        if (data.type === "result") resolve(data.result);
        else reject(new Error(data.message || t("clientUIAnimationEditor.ui.psdImport.failed")));
      };
      worker.onerror = event => { event.preventDefault(); clearTimeout(timeout); reject(new Error(t("clientUIAnimationEditor.ui.psdImport.decodeFailed"))); };
      try { worker.postMessage({ buffer, name: file.name.replace(/\.psd$/i, ""), locale: locale.value }, [buffer]); }
      catch (error) { clearTimeout(timeout); reject(error); }
    });
  } finally { worker.terminate(); }
}
