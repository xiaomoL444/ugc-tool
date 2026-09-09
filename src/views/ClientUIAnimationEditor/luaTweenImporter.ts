import { parseLuaData } from "./luaDataParser";
import { getTweenableField, getTweenTrackConflict, getTweenGroupNodes, isRelativeTweenField, isTweenEaseType, GROUP_ALPHA_FIELD_KEY, GROUP_ALPHA_MAX } from "./tweenRegistry";
import { orderTweenClips, tweenClipsOverlap } from "./timelineClipLayout";
import type { UITweenTrack, UITweenValue, UINode } from "./types";

export type TimelineDataImportMode = "append" | "replace";
export interface TimelineDataImportOptions {
  source: string;
  rootNodeId: string;
  nodes: UINode[];
  existingTracks: UITweenTrack[];
  mode: TimelineDataImportMode;
  sequenceDuration: number;
}
export interface TimelineDataImportResult {
  tracks: UITweenTrack[];
  importedTracks: UITweenTrack[];
  duration: number;
  replacedCount: number;
  schema: string | null;
  errors: string[];
  warnings: string[];
}

const DEFAULT_COLUMNS = ["path", "field", "start", "duration", "ease", "from", "to", "relative"];
const REQUIRED_COLUMNS = DEFAULT_COLUMNS.slice(0, 7);
const MIN_CLIP_DURATION = 0.01;
const MAX_IMPORT_CLIPS = 10000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function decodeValue(value: unknown, kind: "number" | "color"): UITweenValue {
  if (kind === "number") {
    if (!isNumber(value)) throw new Error("必须是有效数值，不能省略初始值或结束值。");
    return value;
  }
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => isNumber(item) && Number.isInteger(item) && item >= 0 && item <= 255)) {
    throw new Error("颜色必须是四个 0–255 整数组成的 RGBA 数据表。");
  }
  return { r: value[0], g: value[1], b: value[2], a: value[3] / 255 };
}

/** Parse and validate first. A failed import returns the existing timeline intact. */
export function prepareTweenTimelineImport(options: TimelineDataImportOptions): TimelineDataImportResult {
  const { nodes, existingTracks, rootNodeId, mode, source } = options;
  const errors: string[] = [];
  const warnings: string[] = [];
  let schema: string | null = null;
  const failure = (): TimelineDataImportResult => ({
    tracks: existingTracks, importedTracks: [], duration: options.sequenceDuration,
    replacedCount: 0, schema, errors, warnings,
  });
  let data: unknown;
  try { data = parseLuaData(source); }
  catch (error) {
    errors.push(error instanceof Error ? error.message : "无法解析 Timeline Data。");
    return failure();
  }
  if (!isRecord(data)) { errors.push("Data 必须是包含 schema、duration 和 tracks 的数据表。"); return failure(); }
  if (typeof data.schema !== "string" || !/^ClientUIAnimationEditor\.TweenTimeline@[3-7]$/.test(data.schema)) {
    errors.push("仅支持 TweenTimeline Data @3–@7；请选择 Data 文件，而不是 TweenTimelineLib 运行库。");
    return failure();
  }
  schema = data.schema;
  if (!isNumber(data.duration) || data.duration < 0) {
    errors.push("Data.duration 必须是大于或等于 0 的有效秒数。");
    return failure();
  }
  const dataDuration = data.duration;
  if (!Array.isArray(data.tracks) || !data.tracks.length || data.tracks.length > MAX_IMPORT_CLIPS) {
    errors.push("Data.tracks 必须包含 1–10000 条 Clip；空表不会清空现有时间轴。");
    return failure();
  }
  const columns = data.columns === undefined ? DEFAULT_COLUMNS : data.columns;
  if (!Array.isArray(columns) || !columns.every((key) => typeof key === "string" && DEFAULT_COLUMNS.includes(key))
    || new Set(columns).size !== columns.length || !REQUIRED_COLUMNS.every((key) => columns.includes(key))) {
    errors.push("columns 必须包含不重复的 path、field、start、duration、ease、from、to，可选 relative。");
    return failure();
  }
  const indices = new Map<string, number>(columns.map((key, index) => [key as string, index]));
  const read = (row: unknown[], key: string): unknown => {
    const index = indices.get(key);
    return index === undefined ? undefined : row[index];
  };
  const root = nodes.find((node) => node.id === rootNodeId);
  if (!root) { errors.push("请选择当前文件中的导入根控件。"); return failure(); }
  if (mode !== "append" && mode !== "replace") { errors.push("未知导入方式。"); return failure(); }
  const scope = new Set(getTweenGroupNodes(root.id, nodes).map((node) => node.id));
  const retained = mode === "replace" ? existingTracks.filter((track) => !scope.has(track.nodeId)) : existingTracks;
  const children = new Map<string, UINode[]>();
  for (const node of nodes) {
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const resolvePath = (path: string): UINode => {
    let node = root;
    if (!path) return node;
    for (const name of path.split("/")) {
      if (!name.trim()) throw new Error("控件路径含空层级，请使用相对根控件的完整路径。");
      const matches = (children.get(node.id) ?? []).filter((child) => child.name === name);
      if (matches.length === 0) throw new Error("找不到路径「" + path + "」，请确认导入根控件和控件名称。");
      if (matches.length > 1) throw new Error("路径「" + path + "」存在同名子控件，无法唯一匹配。");
      node = matches[0];
    }
    return node;
  };
  const usedIds = new Set(existingTracks.map((track) => track.id));
  const prefix = "tween_import_" + Date.now().toString(36) + "_";
  let idCounter = 0;
  const nextId = () => {
    let id: string;
    do { id = prefix + (++idCounter).toString(36); } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const imported: UITweenTrack[] = [];
  const accepted = [...retained];
  const lanes = new Map<string, UITweenTrack[]>();
  for (const track of retained) {
    const key = track.nodeId + "\0" + track.fieldKey;
    const lane = lanes.get(key) ?? [];
    lane.push(track);
    lanes.set(key, lane);
  }
  for (let index = 0; index < data.tracks.length; index++) {
    if (errors.length >= 100) { errors.push("错误过多，请先修正以上问题后重新检查。"); break; }
    try {
      const row: unknown = data.tracks[index];
      if (!Array.isArray(row) || row.length > columns.length) throw new Error("Clip 必须是与 columns 对应的数据行。");
      const path = read(row, "path");
      const fieldKey = read(row, "field");
      if (typeof path !== "string" || typeof fieldKey !== "string") throw new Error("path 和 field 必须是字符串。");
      const node = resolvePath(path);
      const field = getTweenableField(node.type, fieldKey);
      if (!field) throw new Error("控件「" + node.name + "」不支持 Tweenable 字段 " + fieldKey + "。");
      const startTime = read(row, "start");
      const duration = read(row, "duration");
      if (!isNumber(startTime) || startTime < 0 || !isNumber(duration) || duration < MIN_CLIP_DURATION
        || !Number.isFinite(startTime + duration)) throw new Error("开始时间须非负，持续时间至少为 0.01 秒，且总时长须有效。");
      const easeType = read(row, "ease");
      if (typeof easeType !== "string" || !isTweenEaseType(easeType)) throw new Error("未知缓动类型：" + String(easeType));
      const relative = read(row, "relative");
      if (relative !== undefined && relative !== null && typeof relative !== "boolean") throw new Error("relative 只能是 true 或 false。");
      if (relative === true && !isRelativeTweenField(fieldKey)) throw new Error("字段 " + fieldKey + " 不支持增量模式。");
      let initialValue: UITweenValue;
      let endValue: UITweenValue;
      try { initialValue = decodeValue(read(row, "from"), field.valueKind); }
      catch (error) { throw new Error("初始值：" + (error as Error).message); }
      try { endValue = decodeValue(read(row, "to"), field.valueKind); }
      catch (error) { throw new Error("结束值：" + (error as Error).message); }
      if (fieldKey === GROUP_ALPHA_FIELD_KEY && [initialValue, endValue].some((value) => typeof value !== "number" || value < 0 || value > GROUP_ALPHA_MAX)) {
        throw new Error("groupAlpha 必须在 0–255 之间。");
      }
      const track: UITweenTrack = {
        id: nextId(), nodeId: node.id, fieldKey, startTime, duration, easeType, initialValue, endValue,
        ...(relative === true ? { relative: true } : {}),
      };
      const laneKey = node.id + "\0" + fieldKey;
      const lane = lanes.get(laneKey) ?? [];
      if (lane.some((other) => tweenClipsOverlap(track, other))) {
        throw new Error("「" + node.name + " / " + fieldKey + "」与同轨道 Clip 重叠；可调整时间或选择替换。");
      }
      const conflict = getTweenTrackConflict(node.id, fieldKey, nodes, accepted);
      if (conflict) throw new Error(conflict);
      imported.push(track);
      accepted.push(track);
      lane.push(track);
      lanes.set(laneKey, lane);
    } catch (error) {
      errors.push("第 " + (index + 1) + " 条 Clip：" + (error instanceof Error ? error.message : String(error)));
    }
  }
  if (errors.length) return failure();
  const tracks = [...retained, ...orderTweenClips(imported)];
  const importedEnd = imported.reduce((end, track) => Math.max(end, track.startTime + track.duration), 0);
  if (importedEnd > dataDuration + 0.000001) warnings.push("部分 Clip 超出 Data.duration，序列时长会扩展以完整保留动画。");
  const duration = tracks.reduce((end, track) => Math.max(end, track.startTime + track.duration),
    Math.max(0.5, dataDuration, mode === "append" ? options.sequenceDuration : 0));
  if (mode === "replace" && retained.some((track) => track.startTime + track.duration > dataDuration)) {
    warnings.push("所选范围之外仍有动画，序列时长会保留到这些 Clip 的结束时间。");
  }
  return {
    tracks, importedTracks: orderTweenClips(imported), duration,
    replacedCount: existingTracks.length - retained.length, schema, errors, warnings,
  };
}
