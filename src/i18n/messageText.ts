/** Preserve resource names literally when Vue I18n compiles their messages. */
export function escapeMessageText(text: string): string {
  return text.replace(/[@{}|]/g, (character) => `{'${character}'}`);
}

/** Search the visible characters of plain-text remote messages. */
export function messageSearchText(message: string): string {
  return message.replace(/\{'([@{}|])'\}/g, "$1");
}
