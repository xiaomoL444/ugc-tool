export type AnimationType = "single" | "combo";
export type AnimationPartType = "single" | "continuous";

export interface AnimationPart {
  /** Relative to the AnimationViewer OSS directory. */
  path: string;
  type: AnimationPartType;
  nameI18nKey?: string;
  /** Actual duration of this skill part in seconds, independent of the preview video. */
  duration?: number;
}

/** A skill is a group of parts and has no resource ID of its own. */
export interface AnimationSkill {
  type: AnimationType;
  category: number;
  nameI18nKey: string;
  order?: number;
  giVersion?: string;
  parts: AnimationPart[];
}

export interface AnimationCategory {
  id: number;
  nameI18nKey: string;
}

export interface AnimationDataFile {
  data: AnimationSkill[];
  category: AnimationCategory[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(location: string, message: string): never {
  throw new Error(`Invalid AnimationViewer ${location}: ${message}`);
}

function translationKey(value: unknown, location: string): string {
  if (typeof value !== "string" || !/^animationViewer(?:\.[\p{L}\p{N}_-]+)+$/u.test(value)
      || value.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    return fail(location, "expected an animationViewer translation key");
  }
  return value;
}

function mediaPath(value: unknown, location: string): string {
  // OSS encodes each segment. Reject paths whose meaning could change before that
  // step (URLs, encoded traversal, query strings, or Windows path separators).
  if (typeof value !== "string" || !value || /[\\:%?#\p{C}]/u.test(value)
      || value.split("/").some((part) => !part || part.trim() !== part || part === "." || part === "..")) {
    return fail(location, "expected a relative media path without traversal or URL syntax");
  }
  return value;
}

/** Validate the resource index without inventing IDs, names, paths, or missing parts. */
export function normalizeAnimationData(input: unknown): AnimationDataFile {
  if (!isRecord(input) || !Array.isArray(input.data) || !Array.isArray(input.category)) {
    return fail("index", "expected data and category arrays");
  }

  const categoryIds = new Set<number>();
  const category = input.category.map((row, index): AnimationCategory => {
    const location = `category[${index}]`;
    if (!isRecord(row) || typeof row.id !== "number" || !Number.isSafeInteger(row.id)) {
      return fail(location, "expected an integer category ID");
    }
    if (categoryIds.has(row.id)) return fail(location, "duplicate category ID");
    categoryIds.add(row.id);
    return { id: row.id, nameI18nKey: translationKey(row.nameI18nKey, `${location}.nameI18nKey`) };
  });

  const data = input.data.map((row, index): AnimationSkill => {
    const location = `data[${index}]`;
    if (!isRecord(row) || typeof row.type !== "string" || !["single", "combo"].includes(row.type)) {
      return fail(location, "expected single or combo type");
    }
    const type = row.type as AnimationType;
    if (typeof row.category !== "number" || !categoryIds.has(row.category)) {
      return fail(`${location}.category`, "category ID does not exist");
    }
    if (!Array.isArray(row.parts) || !row.parts.length || (type === "single" && row.parts.length !== 1)) {
      return fail(`${location}.parts`, type === "single" ? "single skills require exactly one part" : "expected at least one part");
    }
    if (row.order !== undefined && (typeof row.order !== "number" || !Number.isFinite(row.order))) {
      return fail(`${location}.order`, "expected a finite number");
    }
    if (row.giVersion !== undefined && typeof row.giVersion !== "string") {
      return fail(`${location}.giVersion`, "expected a version string");
    }
    if ("duration" in row) return fail(`${location}.duration`, "duration belongs on each part, not the skill");

    const parts = row.parts.map((part, partIndex): AnimationPart => {
      const partLocation = `${location}.parts[${partIndex}]`;
      if (!isRecord(part)) return fail(partLocation, "expected an animation part");
      if ("phase" in part) return fail(`${partLocation}.phase`, "use part.type and nameI18nKey instead of phase");
      if (typeof part.type !== "string" || !["single", "continuous"].includes(part.type)) {
        return fail(`${partLocation}.type`, "expected single or continuous part type");
      }
      const partType = part.type as AnimationPartType;
      if (part.duration !== undefined && (typeof part.duration !== "number" || !Number.isFinite(part.duration) || part.duration <= 0)) {
        return fail(`${partLocation}.duration`, "expected a positive number of seconds");
      }
      const nameI18nKey = part.nameI18nKey !== undefined || type === "combo"
        ? translationKey(part.nameI18nKey, `${partLocation}.nameI18nKey`)
        : undefined;
      return {
        path: mediaPath(part.path, `${partLocation}.path`),
        type: partType,
        ...(nameI18nKey !== undefined ? { nameI18nKey } : {}),
        ...(typeof part.duration === "number" ? { duration: part.duration } : {}),
      };
    });

    return {
      type,
      category: row.category,
      nameI18nKey: translationKey(row.nameI18nKey, `${location}.nameI18nKey`),
      ...(typeof row.order === "number" ? { order: row.order } : {}),
      ...(typeof row.giVersion === "string" && row.giVersion.trim()
        ? { giVersion: row.giVersion.trim() } : {}),
      parts,
    };
  });

  return { data, category };
}
