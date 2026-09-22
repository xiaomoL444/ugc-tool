/** 实际换行转换成可见的反斜杠+n；已有字面量不做转义或解释。 */
export function normalizeDialogueInput(value: string): string {
  return value.replace(/\r\n|\r|\n/g, "\\n");
}

/** 覆盖粘贴、拖入和移动端输入，保持 DOM 与保存值一致。 */
export function sanitizeDialogueInput(event: Event) {
  const input = event.target as HTMLTextAreaElement;
  const normalized = normalizeDialogueInput(input.value);
  if (normalized !== input.value) input.value = normalized;
}

export function preventDialogueLineBreak(event: InputEvent) {
  if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
    event.preventDefault();
  }
}
