import { initializeCanvas, readPsd } from "ag-psd";
import { convertPsdDocument, validatePsdHeader } from "./psdImportData";

initializeCanvas(() => { throw new Error("PSD 解码不应创建主线程画布。"); }, (width, height) => new ImageData(width, height));
self.onmessage = async ({ data }: MessageEvent<{ buffer: ArrayBuffer; name: string }>) => {
  try {
    validatePsdHeader(data.buffer);
    const psd = readPsd(data.buffer, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: 256 * 1024 * 1024 });
    const result = await convertPsdDocument(psd, data.name, async (pixels, width, height) => {
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建图层画布。");
      const image = context.createImageData(width, height); image.data.set(pixels); context.putImageData(image, 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      canvas.width = canvas.height = 1;
      let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `data:image/png;base64,${btoa(binary)}`;
    }, (done, total) => self.postMessage({ type: "progress", done, total }));
    self.postMessage({ type: "result", result });
  } catch (error) { self.postMessage({ type: "error", message: error instanceof Error ? error.message : "PSD 解析失败。" }); }
};
