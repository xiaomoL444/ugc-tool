import type { EffectItem } from "./types/EffectData";
import { messageSearchText } from "../../i18n/messageText";
import { effectNameKey, effectTagKey, isEffectResourceKey } from "./resourceKeys";

type SearchableEffect = Pick<EffectItem, "id" | "title" | "name" | "sourceTitle" | "sourceName" | "tagList" | "nameI18nKey">;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function translatedText(messages: unknown, key: string): string | undefined {
  let value = messages;
  for (const segment of key.split(".")) {
    const node = record(value);
    if (!Object.hasOwn(node, segment)) return;
    value = node[segment];
  }
  return typeof value === "string" ? messageSearchText(value) : undefined;
}

/** Index source text and every loaded translation independently of the display locale. */
export function buildEffectSearchIndex(
  items: readonly SearchableEffect[],
  tagData: Readonly<Record<string, string>>,
  localeMessages: readonly unknown[],
  sourceTagData: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const translations = new Map<string, (string | undefined)[]>();
  const textsForKey = (key: string) => {
    if (!translations.has(key)) {
      translations.set(key, localeMessages.map((message) => translatedText(message, key)));
    }
    return translations.get(key)!;
  };
  return new Map(items.map((item) => {
    const text: unknown[] = [String(item.id), item.title, item.name, item.sourceTitle, item.sourceName];
    const nameKeys = new Set([effectNameKey(item), ...[item.title, item.name].filter(isEffectResourceKey)]);
    for (const key of nameKeys) {
      text.push(...textsForKey(key));
    }
    for (const tagId of item.tagList ?? []) {
      const label = tagData[String(tagId)];
      text.push(label, sourceTagData[String(tagId)]);
      const key = effectTagKey(tagId, label);
      text.push(...textsForKey(key));
    }
    return [String(item.id), text.filter((value): value is string => typeof value === "string")
      .join("\n").toLowerCase()];
  }));
}
