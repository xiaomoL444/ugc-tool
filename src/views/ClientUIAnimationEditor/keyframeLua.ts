import { parseLuaData } from "./luaDataParser";
import { prepareTweenTimelineImport } from "./luaTweenImporter";
import { KEYFRAME_TIME_EPSILON, migrateTweenClipsToKeyframes, normalizeKeyframeTracks } from "./keyframeTimeline";
import { getGroupAlphaColorFields, getTweenableField, getTweenGroupNodes, getTweenTrackConflict, GROUP_ALPHA_FIELD_KEY, GROUP_ALPHA_MAX, isRelativeTweenField, isTweenEaseType } from "./tweenRegistry";
import type { ColorRGBA, UIKeyframe, UIKeyframeTrack, UITweenTrack, UITweenValue, UINode } from "./types";
import type { TimelineDataImportMode } from "./luaTweenImporter";
import type { TweenSequenceLuaExportResult } from "./luaTweenExporter";
import { TWEEN_TIMELINE_LIB_VERSION } from "./luaTweenExporter";
import { normalizeTimelineEvents } from "./timelineEvents";
import type { UITimelineEvent } from "./types";

export const KEYFRAME_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@8";
export interface KeyframeTimelineLuaExportOptions {
  events?: UITimelineEvent[];
  projectName: string;
  rootNodeId: string;
  nodes: UINode[];
  tracks: UIKeyframeTrack[];
  sequenceDuration?: number;
}
export interface KeyframeTimelineImportOptions {
  existingEvents?: UITimelineEvent[];
  source: string;
  rootNodeId: string;
  nodes: UINode[];
  existingTracks: UIKeyframeTrack[];
  mode: TimelineDataImportMode;
  sequenceDuration: number;
}
export interface KeyframeTimelineImportResult {
  events: UITimelineEvent[];
  importedEvents: UITimelineEvent[];
  tracks: UIKeyframeTrack[];
  importedTracks: UIKeyframeTrack[];
  duration: number;
  replacedCount: number;
  schema: string | null;
  errors: string[];
  warnings: string[];
}

const MAX_TRACKS = 10000;
const MAX_KEYS = 50000;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const laneKey = (track: Pick<UIKeyframeTrack, "nodeId" | "fieldKey">) => track.nodeId + "\0" + track.fieldKey;
const luaNumber = (value: number) => Object.is(value, -0) ? "0" : String(value);
const luaString = (value: string) => '"' + value.replace(/[\\"\u0000-\u001f\u007f]/g, (character) => {
  if (character === "\\") return "\\\\";
  if (character === '"') return '\\"';
  return "\\" + character.charCodeAt(0).toString().padStart(3, "0");
}) + '"';
const filePart = (value: string) => value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, "_") || "Timeline";
const comment = (value: string) => value.replace(/[\r\n\u0000-\u001f]+/g, " ");

function hierarchy(nodes: UINode[], rootNodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get(rootNodeId);
  if (!root) throw new Error("请选择当前文件中的根控件。");
  const children = new Map<string, UINode[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const list = children.get(node.parentId) ?? [];
      list.push(node);
      children.set(node.parentId, list);
    }
  }
  function resolve(path: string): UINode {
    let current = root!;
    if (!path) return current;
    for (const name of path.split("/")) {
      if (!name.trim()) throw new Error("控件路径包含空层级。");
      const matches = (children.get(current.id) ?? []).filter((node) => node.name === name);
      if (matches.length === 0) throw new Error(`找不到路径「${path}」，请确认导入根控件和名称。`);
      if (matches.length !== 1) throw new Error(`路径「${path}」存在同名子控件，无法唯一匹配。`);
      current = matches[0];
    }
    return current;
  }
  function relativePath(node: UINode): string | null {
    const names: string[] = [];
    const visited = new Set<string>();
    let current: UINode | undefined = node;
    while (current && current.id !== root!.id) {
      if (visited.has(current.id)) return null;
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (!current) return null;
    if (names.some((name) => !name.trim() || name.includes("/"))) throw new Error(`控件「${node.name}」的名称不能组成可靠的 FindChild 路径。`);
    const path = names.join("/");
    if (resolve(path).id !== node.id) throw new Error(`路径「${path}」无法唯一匹配控件。`);
    return path;
  }
  return { root, byId, resolve, relativePath };
}

function decode(value: unknown, kind: "number" | "color" | "boolean"): UITweenValue {
  if (kind === "boolean") {
    if (typeof value !== "boolean") throw new Error("显隐关键帧必须是布尔值。");
    return value;
  }
  if (kind === "number") {
    if (!finite(value)) throw new Error("关键帧值必须是有限数值。");
    return value;
  }
  if (!Array.isArray(value) || value.length !== 4 || !value.every((channel) => finite(channel) && Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new Error("颜色必须由四个 0–255 的 RGBA 整数组成。");
  }
  return { r: value[0], g: value[1], b: value[2], a: value[3] / 255 };
}

function encode(value: UITweenValue): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return luaNumber(value);
  if (value && typeof value === "object") {
    const color = value as ColorRGBA;
    return `{ ${[color.r, color.g, color.b, color.a * 255].map((channel) => Math.round(channel)).join(", ")} }`;
  }
  throw new Error("关键帧缺少有效值。");
}

function checkColorConflicts(tracks: UIKeyframeTrack[], nodes: UINode[]) {
  const accepted: UITweenTrack[] = [];
  for (const track of tracks) {
    const conflict = getTweenTrackConflict(track.nodeId, track.fieldKey, nodes, accepted);
    if (conflict) throw new Error(conflict);
    accepted.push({ id: track.id, nodeId: track.nodeId, fieldKey: track.fieldKey, startTime: 0, duration: 1, initialValue: 0, endValue: 0, easeType: "Linear" });
  }
}

/** @8 保留关键帧本身，不将编辑数据扁平化为不可逆的 Tween Clip。 */
export function buildKeyframeTimelineDataLua(options: KeyframeTimelineLuaExportOptions): TweenSequenceLuaExportResult {
  const tree = hierarchy(options.nodes, options.rootNodeId);
  const scoped: Array<{ track: UIKeyframeTrack; path: string }> = [];
  for (const track of options.tracks) {
    const node = tree.byId.get(track.nodeId);
    if (!node) throw new Error(`找不到关键帧轨道对应的控件：${track.nodeId}`);
    const path = tree.relativePath(node);
    if (path !== null) scoped.push({ track, path });
  }
  const tracks = normalizeKeyframeTracks(scoped.map((item) => item.track), options.nodes);
  for (const track of tracks) if (!track.keyframes.length) throw new Error(`「${tree.byId.get(track.nodeId)?.name ?? track.nodeId} / ${track.fieldKey}」尚未设置关键帧。`);
  checkColorConflicts(tracks, options.nodes);
  const warnings: string[] = [];
  const targets = new Set<string>();
  let tweenCount = 0;
  let duration = typeof options.sequenceDuration === "number" && Number.isFinite(options.sequenceDuration) ? Math.max(0, options.sequenceDuration) : 0;
  const lines = [
    `-- ${comment(options.projectName || "Client UI Animation")}`,
    `-- 导出根控件：${comment(tree.root.name)}`,
    "-- tracks: { 相对路径, 字段, {关键帧...} }。空路径代表根控件本身。",
    "-- 关键帧: { 时间, 值, 增量, 缓动, 插值, 左极限值(可选), 左极限增量(可选) }。",
    "-- 插值 tween/step 作用于此帧到下一帧；增量基于上一帧实际右值，首帧基于 Create 前属性。",
    "-- ColorRGBA 通道均为 0–255；需要 TweenTimelineLib v8 或更高版本。",
    ...(tracks.some(track => track.fieldKey === "visible") ? ["-- 显隐需要 TweenTimelineLib v8.2+；visible=true/false 在关键帧时间通过 InsertCallback + SetVisible 切换。"] : []),
    "", "local TweenTimelineData = {", `    schema = ${luaString(KEYFRAME_TIMELINE_SCHEMA)},`,
    `    libVersion = ${luaString(TWEEN_TIMELINE_LIB_VERSION)},`,
  ];
  const rows: string[] = [];
  for (const track of tracks) {
    const node = tree.byId.get(track.nodeId)!;
    const path = tree.relativePath(node)!;
    const segments = track.keyframes.slice(0, -1).filter((frame) => frame.interpolation === "tween").length;
    if (track.fieldKey === GROUP_ALPHA_FIELD_KEY) {
      let count = 0;
      for (const target of getTweenGroupNodes(node.id, options.nodes)) {
        const fields = getGroupAlphaColorFields(target.type);
        if (fields.length) targets.add(target.id);
        count += fields.length;
      }
      tweenCount += segments * count;
      if (!count) warnings.push(`控件「${node.name}」及子级当前没有颜色；已保留组透明度轨道，运行时会重新扫描。`);
    } else {
      targets.add(node.id);
      tweenCount += segments;
    }
    rows.push(`        { ${luaString(path)}, ${luaString(track.fieldKey)}, {`);
    for (const frame of track.keyframes) {
      duration = Math.max(duration, frame.time);
      const columns = [luaNumber(frame.time), encode(frame.value), frame.relative ? "true" : "false", luaString(frame.easeType), luaString(frame.interpolation)];
      if (frame.incomingValue !== undefined) columns.push(encode(frame.incomingValue), frame.incomingRelative ? "true" : "false");
      rows.push(`            { ${columns.join(", ")} },`);
    }
    rows.push("        } },");
  }
  const eventRows: string[] = [];
  for (const event of normalizeTimelineEvents(options.events, options.nodes)) {
    const path = event.nodeId === null ? "" : tree.relativePath(tree.byId.get(event.nodeId)!);
    if (path === null) continue;
    duration = Math.max(duration, event.time);
    eventRows.push(`        { time = ${luaNumber(event.time)}, name = ${luaString(event.name)}, target = ${luaString(path)}, params = ${luaString(event.params)} },`);
  }
  lines.push(`    duration = ${luaNumber(duration)},`, "    tracks = {", ...rows, "    },", ...(eventRows.length ? ["    -- 事件在相同时间按列表顺序触发；使用 Create(root, Data, { onEvent = function(event, target) ... end }) 接收。", "    events = {", ...eventRows, "    },"] : []), "}", "", "return TweenTimelineData", "");
  return { code: lines.join("\n"), fileName: [options.projectName, tree.root.name, "TweenTimelineData"].filter(Boolean).map(filePart).join("-") + ".lua", warnings, trackCount: tracks.length, eventCount: eventRows.length, tweenCount, targetCount: targets.size };
}

/** 验证成功后才返回可提交快照；任何错误保留现有时间轴，不执行 Lua。 */
export function prepareKeyframeTimelineImport(options: KeyframeTimelineImportOptions): KeyframeTimelineImportResult {
  const { existingTracks, nodes, mode } = options;
  const errors: string[] = [];
  const warnings: string[] = [];
  let schema: string | null = null;
  const failure = (): KeyframeTimelineImportResult => ({ tracks: existingTracks, importedTracks: [], events: options.existingEvents ?? [], importedEvents: [], duration: options.sequenceDuration, replacedCount: 0, schema, errors, warnings });
  try {
    const data: unknown = parseLuaData(options.source);
    if (!record(data) || typeof data.schema !== "string" || !/^ClientUIAnimationEditor\.TweenTimeline@[3-8]$/.test(data.schema)) throw new Error("仅支持 TweenTimeline Data @3–@8；请选择 Data，而不是运行库。");
    schema = data.schema;
    if (!finite(data.duration) || data.duration < 0) throw new Error("Data.duration 必须是非负的有限秒数。");
    const dataDuration = data.duration;
    const tree = hierarchy(nodes, options.rootNodeId);
    if (mode !== "append" && mode !== "replace") throw new Error("未知导入方式。");
    let imported: UIKeyframeTrack[];
    const usedIds = new Set(existingTracks.flatMap((track) => [track.id, ...track.keyframes.map((frame) => frame.id)]));
    const prefix = "key_import_" + Date.now().toString(36) + "_";
    let counter = 0;
    const id = () => {
      let result: string;
      do { result = prefix + (++counter).toString(36); } while (usedIds.has(result));
      usedIds.add(result);
      return result;
    };
    for (const event of options.existingEvents ?? []) usedIds.add(event.id);
    if (data.events !== undefined && (!Array.isArray(data.events) || data.events.length > 10000)) throw new Error("Data.events 必须为事件列表（最多 10000 个）");
    const importedEvents = normalizeTimelineEvents((data.events as unknown[] ?? []).map(value => {
      if (!record(value) || typeof value.target !== "string") throw new Error("事件必须包含 time、name、target、params");
      const nodeId = value.target === "" ? tree.root.id : tree.resolve(value.target).id;
      return { id: id(), time: value.time, name: value.name, nodeId, params: value.params };
    }), nodes);
    if (schema !== KEYFRAME_TIMELINE_SCHEMA) {
      const legacy = prepareTweenTimelineImport({ ...options, existingTracks: [], mode: "append" });
      if (legacy.errors.length) { errors.push(...legacy.errors); return failure(); }
      warnings.push(...legacy.warnings, "旧版 Clip 已无损转换为关键帧；空档使用保持插值，相接处不同首尾值保留为边界跳变。");
      imported = migrateTweenClipsToKeyframes(legacy.importedTracks).map((track) => ({ ...track, id: id(), keyframes: track.keyframes.map((frame) => ({ ...frame, id: id() })) }));
    } else {
      if (!Array.isArray(data.tracks) || !data.tracks.length && !importedEvents.length || data.tracks.length > MAX_TRACKS) throw new Error("Data 必须包含关键帧轨道或事件；空表不会清空现有动画。");
      let keyCount = 0;
      imported = [];
      for (let trackIndex = 0; trackIndex < data.tracks.length; trackIndex++) {
        try {
          const row = data.tracks[trackIndex];
          if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== "string" || typeof row[1] !== "string" || !Array.isArray(row[2]) || !row[2].length) throw new Error("轨道须为 {路径, 字段, 非空关键帧列表}。");
          const node = tree.resolve(row[0]);
          const fieldKey = row[1];
          const field = getTweenableField(node.type, fieldKey);
          if (!field) throw new Error(`控件「${node.name}」不支持 Tweenable 字段 ${fieldKey}。`);
          keyCount += row[2].length;
          if (keyCount > MAX_KEYS) throw new Error("关键帧数量超过 50000。");
          const frames: UIKeyframe[] = [];
          for (let frameIndex = 0; frameIndex < row[2].length; frameIndex++) {
            const entry = row[2][frameIndex];
            try {
              if (!Array.isArray(entry) || entry.length < 5 || entry.length > 7) throw new Error("关键帧须按时间、值、增量、缓动、插值及可选左极限填写。");
              if (!finite(entry[0]) || entry[0] < 0) throw new Error("时间必须是非负的有限秒数。");
              for (const index of [2, 6]) {
                if (entry[index] !== undefined && entry[index] !== null && typeof entry[index] !== "boolean") throw new Error("增量只能为 true 或 false。");
                if (entry[index] === true && !isRelativeTweenField(fieldKey)) throw new Error(`字段 ${fieldKey} 不支持增量。`);
              }
              if (!isTweenEaseType(entry[3])) throw new Error("未知缓动类型：" + String(entry[3]));
              if (entry[4] !== "tween" && entry[4] !== "step") throw new Error("插值只能是 tween 或 step。");
              const value = decode(entry[1], field.valueKind);
              const incomingValue = entry[5] === undefined || entry[5] === null ? undefined : decode(entry[5], field.valueKind);
              if (incomingValue === undefined && entry[6] === true) throw new Error("缺少左极限值，不能启用左极限增量。");
              if (fieldKey === GROUP_ALPHA_FIELD_KEY && [value, ...(incomingValue === undefined ? [] : [incomingValue])].some((item) => typeof item !== "number" || item < 0 || item > GROUP_ALPHA_MAX)) throw new Error("组透明度必须在 0–255 之间。");
              frames.push({ id: id(), time: entry[0], value, relative: entry[2] === true, easeType: entry[3], interpolation: entry[4], ...(incomingValue === undefined ? {} : { incomingValue, incomingRelative: entry[6] === true }) });
            } catch (error) { throw new Error(`第 ${frameIndex + 1} 帧：${error instanceof Error ? error.message : String(error)}`); }
          }
          imported.push({ id: id(), nodeId: node.id, fieldKey, keyframes: frames });
        } catch (error) {
          errors.push(`第 ${trackIndex + 1} 条轨道：${error instanceof Error ? error.message : String(error)}`);
          if (errors.length >= 100) break;
        }
      }
      if (errors.length) return failure();
    }
    const scope = new Set(getTweenGroupNodes(tree.root.id, nodes).map((node) => node.id));
    const retained = mode === "replace" ? existingTracks.filter((track) => !scope.has(track.nodeId)) : existingTracks;
    const events = [...(options.existingEvents ?? []).filter(e => mode !== "replace" || (e.nodeId === null ? tree.root.parentId !== null : !scope.has(e.nodeId))), ...importedEvents];
    // 同字段不同时刻追加进同一轨道；同一时刻无法同时保留两个值，因此原子拒绝。
    const merged = new Map<string, UIKeyframeTrack>();
    const merge = (track: UIKeyframeTrack) => {
      const key = laneKey(track);
      const previous = merged.get(key);
      const frames = [...(previous?.keyframes ?? []), ...track.keyframes].sort((a, b) => a.time - b.time);
      for (let index = 1; index < frames.length; index++) {
        if (Math.abs(frames[index].time - frames[index - 1].time) <= KEYFRAME_TIME_EPSILON) throw new Error(`「${tree.byId.get(track.nodeId)?.name ?? track.nodeId} / ${track.fieldKey}」在 ${luaNumber(frames[index].time)} 秒已有关键帧；请调整时间或选择替换。`);
      }
      merged.set(key, { ...track, id: previous?.id ?? track.id, keyframes: frames });
    };
    retained.forEach(merge);
    imported.forEach(merge);
    const tracks = normalizeKeyframeTracks([...merged.values()], nodes);
    checkColorConflicts(tracks, nodes);
    const importedByLane = new Map<string, UIKeyframeTrack>();
    for (const track of imported) {
      const key = laneKey(track);
      const previous = importedByLane.get(key);
      importedByLane.set(key, { ...track, id: merged.get(key)!.id, keyframes: [...(previous?.keyframes ?? []), ...track.keyframes].sort((a, b) => a.time - b.time) });
    }
    imported = [...importedByLane.values()];
    const endTime = tracks.reduce((end, track) => track.keyframes.reduce((maximum, frame) => Math.max(maximum, frame.time), end), 0);
    if (endTime > dataDuration + KEYFRAME_TIME_EPSILON) warnings.push("动画超出 Data.duration，序列时长已扩展以完整保留关键帧。");
    const duration = Math.max(0.5, dataDuration, endTime, ...events.map(e => e.time), mode === "append" ? options.sequenceDuration : 0);
    return { tracks, importedTracks: imported, events, importedEvents, duration, replacedCount: existingTracks.length - retained.length, schema, errors, warnings };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return failure();
  }
}
