/// src/utils/download.ts
export function downloadJsonFile(data: any, fileName: string) {
  if (!data || !fileName) return;

  // 转成格式化 JSON 字符串
  const jsonString = JSON.stringify(data, null, 2);

  // 生成 Blob
  const blob = new Blob([jsonString], { type: "application/json" });

  // 创建临时链接
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".json") ? fileName : `${fileName}.json`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 释放资源
  URL.revokeObjectURL(url);
}