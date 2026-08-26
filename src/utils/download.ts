/// src/utils/download.ts
export function downloadJsonFile(data: any, fileName: string) {
  if (!data || !fileName) return;

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
  if (!fileName) return;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
