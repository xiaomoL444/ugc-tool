import type { EffectItem } from "./types/EffectData";

export interface EffectTagGroup {
  id: string;
  name: string;
  tags: { id: number; name: string }[];
}

type TaggedEffect = Pick<EffectItem, "tagList">;

export function buildEffectTagGroups(
  tagData: Record<string, string>,
  category?: Record<string, number[]>,
): EffectTagGroup[] {
  const tagNames = new Map<number, string>();
  for (const [rawId, name] of Object.entries(tagData)) {
    const id = Number(rawId);
    if (rawId.trim() && Number.isInteger(id) && !tagNames.has(id)) {
      tagNames.set(id, name);
    }
  }

  const groups: EffectTagGroup[] = [];
  const groupedIds = new Set<number>();
  for (const [name, ids] of Object.entries(category ?? {})) {
    if (!Array.isArray(ids)) continue;
    const tags: EffectTagGroup["tags"] = [];
    for (const id of ids) {
      if (!Number.isInteger(id) || groupedIds.has(id)) continue;
      groupedIds.add(id);
      tags.push({ id, name: tagNames.get(id) ?? `标签 ${id}` });
    }
    if (tags.length) groups.push({ id: `category:${name}`, name, tags });
  }

  const remainingTags = Array.from(tagNames, ([id, name]) => ({ id, name }))
    .filter(({ id }) => !groupedIds.has(id));
  if (remainingTags.length) {
    groups.push({
      id: "uncategorized",
      name: "无分类",
      tags: remainingTags,
    });
  }
  return groups;
}

/** A selected group accepts any selected tag; all selected groups must match. */
export function matchesEffectTagGroups(
  item: TaggedEffect,
  selectedTagIds: readonly number[],
  groups: readonly EffectTagGroup[],
): boolean {
  if (!selectedTagIds.length) return true;

  const itemTags = new Set(item.tagList);
  const pendingTags = new Set(selectedTagIds);
  for (const group of groups) {
    const selectedInGroup = group.tags.filter(({ id }) => pendingTags.has(id));
    if (!selectedInGroup.length) continue;
    if (!selectedInGroup.some(({ id }) => itemTags.has(id))) return false;
    for (const { id } of selectedInGroup) pendingTags.delete(id);
  }

  // Keep selections for tags not yet assigned to a category effective.
  return Array.from(pendingTags).every((id) => itemTags.has(id));
}

export function countEffectTags(
  items: readonly TaggedEffect[],
  groups: readonly EffectTagGroup[],
): { tagCounts: Map<number, number>; groupCounts: Map<string, number> } {
  const tagCounts = new Map<number, number>();
  const groupCounts = new Map<string, number>();
  const groupsByTag = new Map<number, Set<string>>();
  for (const group of groups) {
    groupCounts.set(group.id, 0);
    for (const { id } of group.tags) {
      tagCounts.set(id, 0);
      const containingGroups = groupsByTag.get(id) ?? new Set<string>();
      containingGroups.add(group.id);
      groupsByTag.set(id, containingGroups);
    }
  }

  for (const item of items) {
    const matchedGroups = new Set<string>();
    for (const id of new Set(item.tagList)) {
      tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
      for (const groupId of groupsByTag.get(id) ?? []) {
        matchedGroups.add(groupId);
      }
    }
    for (const groupId of matchedGroups) {
      groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
    }
  }
  return { tagCounts, groupCounts };
}
