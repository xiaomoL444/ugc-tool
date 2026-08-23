/// src/utils/download.ts
export function downloadJsonFile(data: any, fileName: string) {
  if (!data || !fileName) return;

  // 转成格式化 JSON 字符串
  const jsonString = JSON.stringify(data, null, 2);

  downloadTextFile(
    jsonString,
    fileName.endsWith(".json") ? fileName : `${fileName}.json`,
    "application/json",
  );
}

export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType = "text/plain;charset=utf-8",
) {
  if (!content || !fileName) return;

  // 生成 Blob
  const blob = new Blob([content], { type: mimeType });

  // 创建临时链接
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 释放资源
  URL.revokeObjectURL(url);
}