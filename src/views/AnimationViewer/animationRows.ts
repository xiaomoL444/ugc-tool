import type { AnimationCategory, AnimationSkill } from './animationData';

export interface AnimationSkillEntry { key: string; skill: AnimationSkill }
export interface AnimationGroup {
  category: AnimationCategory;
  skills: AnimationSkillEntry[];
  partCount: number;
}
export interface AnimationRow {
  id: string;
  category: AnimationCategory;
  skills: AnimationSkillEntry[];
  isFirst: boolean;
  isLast: boolean;
}

/** Match the existing 12-column CSS grid without splitting a skill's parts. */
export function buildAnimationRows(groups: readonly AnimationGroup[], viewportWidth: number): AnimationRow[] {
  const rows: AnimationRow[] = [];
  const singleSpan = viewportWidth >= 1500 ? 2 : viewportWidth > 950 ? 3 : viewportWidth > 600 ? 4 : 6;
  const comboSpan = viewportWidth >= 1500 ? 4 : viewportWidth > 950 ? 6 : 12;
  for (const group of groups) {
    const categoryRows: AnimationRow[] = [];
    let pending: AnimationSkillEntry[] = [];
    let used = 0;
    function flush() {
      if (!pending.length) return;
      categoryRows.push({
        id: `${group.category.id}:${pending.map(entry => entry.key).join(',')}`,
        category: group.category,
        skills: pending,
        isFirst: categoryRows.length === 0,
        isLast: false,
      });
      pending = [];
      used = 0;
    }
    for (const entry of group.skills) {
      const span = entry.skill.parts.length > 3 ? 12 : entry.skill.type === 'single' ? singleSpan : comboSpan;
      if (used + span > 12) flush();
      pending.push(entry);
      used += span;
      if (used === 12) flush();
    }
    flush();
    if (categoryRows.length) categoryRows[categoryRows.length - 1].isLast = true;
    rows.push(...categoryRows);
  }
  return rows;
}
