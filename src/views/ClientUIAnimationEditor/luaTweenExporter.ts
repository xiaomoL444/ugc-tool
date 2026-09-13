import {
  getGroupAlphaColorFields,
  getTweenableField,
  getTweenGroupNodes,
  getTweenTrackConflict,
  GROUP_ALPHA_FIELD_KEY,
  GROUP_ALPHA_MAX,
  isRelativeTweenField,
  isScaleTweenField,
  tweenEaseOptions,
} from "./tweenRegistry";
import { TWEEN_CLIP_TIME_EPSILON, tweenClipsOverlap } from "./timelineClipLayout";
import { buildKeyframeRuntimeLuaLines } from "./keyframeLuaRuntime";
import type {
  ColorRGBA,
  TweenEaseType,
  UITweenTrack,
  UITweenValue,
  UINode,
} from "./types";

export interface TweenSequenceLuaExportResult {
  code: string;
  fileName: string;
  warnings: string[];
  /** Timeline 中实际写入 Lua 数据表的 Clip 数量。 */
  trackCount: number;
  /** 运行时根据轨道列表创建的 Tween 数量。 */
  tweenCount: number;
  targetCount: number;
}

interface PreparedTrack {
  node: UINode;
  nodePath: string;
  fieldKey: string;
  valueType: "number" | "color";
  startTime: number;
  duration: number;
  easeType: TweenEaseType;
  initialValue: UITweenValue;
  endValue: UITweenValue;
  relative: boolean;
}

interface ExportOptions {
  projectName: string;
  rootNodeId: string;
  nodes: UINode[];
  tracks: UITweenTrack[];
  sequenceDuration?: number;
}

const LEGACY_TWEEN_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@3";
const GROUP_ALPHA_TWEEN_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@4";
const SCALE_RELATIVE_TWEEN_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@5";
const MULTI_CLIP_TWEEN_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@6";
const LAYOUT_RELATIVE_TWEEN_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@7";
const TWEEN_TIMELINE_SCHEMA = "ClientUIAnimationEditor.TweenTimeline@8";
export const TWEEN_TIMELINE_LIB_VERSION = TWEEN_TIMELINE_SCHEMA.slice(TWEEN_TIMELINE_SCHEMA.lastIndexOf("@") + 1) + ".2";

export interface TweenTimelineLibLuaExportResult {
  code: string;
  fileName: string;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || Object.is(value, -0)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function luaString(value: string) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function sanitizeFilePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "TweenSequence";
}

function luaComment(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

function isColor(value: UITweenValue): value is ColorRGBA {
  return Boolean(
    value &&
      typeof value === "object" &&
      [value.r, value.g, value.b, value.a].every(
        (channel) => typeof channel === "number" && Number.isFinite(channel),
      ),
  );
}

function colorBytes(color: ColorRGBA) {
  const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  return {
    r: clampByte(color.r),
    g: clampByte(color.g),
    b: clampByte(color.b),
    a: Math.min(255, Math.max(0, Math.round(color.a * 255))),
  };
}

function formatTimelineValue(value: UITweenValue, valueType: "number" | "color") {
  if (valueType === "number" && typeof value === "number") return formatNumber(value);
  if (valueType === "color" && isColor(value)) {
    const color = colorBytes(value);
    return `{ ${color.r}, ${color.g}, ${color.b}, ${color.a} }`;
  }
  return "nil";
}

/** 导出一次即可复用的 Timeline Data 运行库。 */
export function buildTweenTimelineLibLua(): TweenTimelineLibLuaExportResult {
  const lines = [
    `-- ClientUIAnimationEditor Timeline 运行库 v${TWEEN_TIMELINE_LIB_VERSION}`,
    "-- 使用：TweenTimelineLib.Create(rootControl, timelineData)",
    "-- 首次扫描记录基础 Alpha；之后 Create 使用当前 RGB 与原始 Alpha，出场后仍可再次入场。",
    "-- 位置/大小/缩放 relative=true：首段加上 Create 前的属性，后续段加上同轨道上一段终值。",
    "-- 同一属性可有多个互不重叠的 Clip；空档保持上一段终值，暂停/重播复用原序列。",
    "-- 旋转按原始关键帧角度差补间，避免欧拉角读回归一化造成绕圈；保留有意设置的多圈旋转。",
    "-- visible 显隐关键帧使用 InsertCallback + SetVisible；首帧前保留 Create 时的可见性。",
    "",
    "local TweenTimelineLib = {}",
    `TweenTimelineLib.Schema = ${luaString(TWEEN_TIMELINE_SCHEMA)}`,
    "",
    "local Ease = {",
    ...tweenEaseOptions.map(
      ({ value }) => `    ${value} = Enum.EaseType.${value},`,
    ),
    "}",
    "",
    "local function Decode(value)",
    "    if type(value) == \"table\" then",
    "        return Color.FromRGBA(value[1], value[2], value[3], value[4])",
    "    end",
    "    return value",
    "end",
    "",
    "local function IsRelativeField(field)",
    '    return field == "localScaleX" or field == "localScaleY" or field == "localScaleZ"',
    '        or field == "anchoredPositionX" or field == "anchoredPositionY"',
    '        or field == "sizeDeltaX" or field == "sizeDeltaY"',
    "end",
    "",
    "local function IsRotationField(field)",
    '    return field == "localRotationX" or field == "localRotationY" or field == "localRotationZ"',
    "end",
    "",
    "local function IsNumber(value)",
    '    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge',
    "end",
    "",
    "local function IsValue(value)",
    "    if IsNumber(value) then return true end",
    '    return type(value) == "table" and IsNumber(value[1]) and IsNumber(value[2]) and IsNumber(value[3]) and IsNumber(value[4])',
    "end",
    "",
    "local function GetControl(root, path, controls)",
    "    if path == \"\" then return root end",
    "    local control = controls[path]",
    "    if control == false then return nil end",
    "    if control ~= nil then return control end",
    "    control = root:FindChild(path)",
    "    controls[path] = control or false",
    "    if control == nil then printerr(\"[TweenTimeline] 未找到控件：\" .. path) end",
    "    return control",
    "end",
    "",
    "-- groupAlpha 是组合轨道，不是控件原生字段；展开为真实颜色 Tween。",
    "local ColorFields = {",
    '    ClientUIImageControl = { "imageColor" },',
    '    ClientUITextBoxControl = { "fontColor", "bgColor", "outlineColor" },',
    '    ClientUITextWindowControl = { "fontColor", "bgColor", "outlineColor" },',
    "}",
    '-- 弱键缓存只保存字段名和 Alpha 数值，不强引用控件。',
    'local BaseAlphas = setmetatable({}, { __mode = "k" })',
    "",
    "local function CollectColors(control, targets, visited)",
    "    if control == nil or visited[control] then return end",
    "    visited[control] = true",
    "    local okType, kind = pcall(typeof, control)",
    "    local fields = okType and ColorFields[kind] or nil",
    "    for _, field in ipairs(fields or {}) do",
    "        local ok, r, g, b, a = pcall(function() return Color.ToRGBA(control[field]) end)",
    '        if ok and type(r) == "number" and type(g) == "number" and type(b) == "number" then',
    "            local alphas = BaseAlphas[control] or {}",
    "            BaseAlphas[control] = alphas",
    "            if alphas[field] == nil then alphas[field] = a or 255 end",
    "            targets[#targets + 1] = { control, field, r, g, b, alphas[field] }",
    "        end",
    "    end",
    "    local okChildren, children = pcall(function() return control:GetChildren() end)",
    "    if okChildren and children ~= nil then",
    "        for _, child in ipairs(children) do CollectColors(child, targets, visited) end",
    "    end",
    "end",
    "",
    "local function ResetBaseColors(control, visited)",
    "    if control == nil or visited[control] then return end",
    "    visited[control] = true",
    "    BaseAlphas[control] = nil",
    "    local ok, children = pcall(function() return control:GetChildren() end)",
    "    if ok and children ~= nil then",
    "        for _, child in ipairs(children) do ResetBaseColors(child, visited) end",
    "    end",
    "end",
    "",
    "-- 停止旧序列、将控件恢复到新的基础颜色后调用；不修改颜色，下次 Create 重新记录 Alpha。",
    "function TweenTimelineLib.ResetBaseColors(root)",
    "    ResetBaseColors(root, {})",
    "end",
    "",
    "local function GroupColor(target, alpha)",
    "    alpha = math.max(0, math.min(255, tonumber(alpha) or 255))",
    "    return Color.FromRGBA(target[3], target[4], target[5], math.floor(target[6] * alpha / 255 + 0.5))",
    "end",
    "",
    ...buildKeyframeRuntimeLuaLines(),
    "function TweenTimelineLib.Create(root, data)",
    '    if type(data) == "table" and data.schema == "ClientUIAnimationEditor.TweenTimeline@8" then return CreateKeyframes(root, data) end',
    "    local sequence = game.TweenSequence()",
    "    if root == nil then",
    "        printerr(\"[TweenTimeline] 根控件不能为空\")",
    "        return sequence",
    "    end",
    `    if type(data) ~= "table" or (data.schema ~= ${luaString(LAYOUT_RELATIVE_TWEEN_TIMELINE_SCHEMA)} and data.schema ~= ${luaString(MULTI_CLIP_TWEEN_TIMELINE_SCHEMA)} and data.schema ~= ${luaString(SCALE_RELATIVE_TWEEN_TIMELINE_SCHEMA)} and data.schema ~= ${luaString(GROUP_ALPHA_TWEEN_TIMELINE_SCHEMA)} and data.schema ~= ${luaString(LEGACY_TWEEN_TIMELINE_SCHEMA)}) or type(data.tracks) ~= "table" then`,
    "        printerr(\"[TweenTimeline] Data 格式不受支持\")",
    "        return sequence",
    "    end",
    "    local controls = {}",
    "    local lanes, lanesByControl = {}, {}",
    "    local claimed = {}",
    "    -- 按输入顺序排除冲突；先快照所有基础属性/颜色，再创建 Tween。",
    "    for order, track in ipairs(data.tracks) do",
    '        local valid = type(track) == "table" and type(track[1]) == "string" and type(track[2]) == "string" and track[2] ~= ""',
    "            and IsNumber(track[3]) and track[3] >= 0 and IsNumber(track[4]) and track[4] > 0 and IsNumber(track[3] + track[4])",
    "            and IsValue(track[6]) and IsValue(track[7]) and type(track[6]) == type(track[7])",
    `        local isGroup = valid and track[2] == ${luaString(GROUP_ALPHA_FIELD_KEY)}`,
    "        valid = valid and (not isGroup or IsNumber(track[6]))",
    "            and (not IsRotationField(track[2]) or IsNumber(track[6]))",
    "            and (track[8] ~= true or (IsRelativeField(track[2]) and IsNumber(track[6])))",
    "        if not valid then",
    '            printerr("[TweenTimeline] 跳过时间、首尾值或增量字段无效的 Clip：" .. order)',
    "        else",
    "            local control = GetControl(root, track[1], controls)",
    "            if control ~= nil then",
    "                local fields = lanesByControl[control] or {}",
    "                local lane = fields[track[2]]",
    "                if lane == nil then",
    "                    local targets = {}",
    "                    if isGroup then",
    "                        CollectColors(control, targets, {})",
    '                        if #targets == 0 then printerr("[TweenTimeline] 组透明度没有可控制的颜色：" .. track[1]) end',
    "                    else",
    "                        targets[1] = { control, track[2] }",
    "                    end",
    "                    local ok, baseline = false, nil",
    "                    if not isGroup then ok, baseline = pcall(function() return control[track[2]] end) end",
    "                    lane = { clips = {}, targets = targets, isGroup = isGroup, baseline = ok and baseline or nil }",
    "                end",
    "                local overlap, conflict = false, false",
    "                for _, entry in ipairs(lane.clips) do",
    "                    local other = entry[1]",
    `                    if math.min(track[3] + track[4], other[3] + other[4]) - math.max(track[3], other[3]) > ${formatNumber(TWEEN_CLIP_TIME_EPSILON)} then overlap = true end`,
    "                end",
    "                for _, target in ipairs(lane.targets) do",
    "                    local owner = claimed[target[1]] and claimed[target[1]][target[2]]",
    "                    if owner ~= nil and owner ~= lane then conflict = true end",
    "                end",
    "                if track[8] == true and not IsNumber(lane.baseline) then",
    '                    printerr("[TweenTimeline] 无法读取增量 Clip 的基础属性：" .. track[1] .. "/" .. track[2])',
    "                elseif overlap or conflict then",
    '                    printerr("[TweenTimeline] 跳过重叠 Clip 或重复颜色写入者：" .. track[1] .. "/" .. track[2])',
    "                else",
    "                    if fields[track[2]] == nil then",
    "                        fields[track[2]], lanesByControl[control] = lane, fields",
    "                        lanes[#lanes + 1] = lane",
    "                        for _, target in ipairs(lane.targets) do",
    "                            claimed[target[1]] = claimed[target[1]] or {}",
    "                            claimed[target[1]][target[2]] = lane",
    "                        end",
    "                    end",
    "                    lane.clips[#lane.clips + 1] = { track, order }",
    "                end",
    "            end",
    "        end",
    "    end",
    "    for _, lane in ipairs(lanes) do",
    "        table.sort(lane.clips, function(a, b)",
    "            if a[1][3] == b[1][3] then return a[2] < b[2] end",
    "            return a[1][3] < b[1][3]",
    "        end)",
    "        local previousEnd, initials = lane.baseline, {}",
    "        for _, entry in ipairs(lane.clips) do",
    "            local track = entry[1]",
    "            local fromValue, toValue = track[6], track[7]",
    "            local invalidRelative = false",
    "            if track[8] == true then",
    "                if IsNumber(previousEnd) then fromValue, toValue = previousEnd + fromValue, previousEnd + toValue",
    "                else invalidRelative = true end",
    "            end",
    '            if invalidRelative or (type(fromValue) == "number" and (not IsNumber(fromValue) or not IsNumber(toValue)))',
    '                or (IsRotationField(track[2]) and not IsNumber(toValue - fromValue)) then',
    '                printerr("[TweenTimeline] 跳过计算后超出有效数值范围的 Clip：" .. track[1] .. "/" .. track[2])',
    "            else",
    "                previousEnd = toValue",
    "                for index, target in ipairs(lane.targets) do",
    "                    local from = lane.isGroup and GroupColor(target, fromValue) or Decode(fromValue)",
    "                    local to = lane.isGroup and GroupColor(target, toValue) or Decode(toValue)",
    "                    if initials[index] == nil then initials[index] = from end",
    "                    -- 设置构造初值以支持立即捕获；回调同时保证延迟开始时使用该 Clip 的初值。",
    "                    target[1][target[2]] = from",
    "                    local rotation = IsRotationField(target[2])",
    "                    local tween = game.Tween(target[1], { [target[2]] = rotation and (to - from) or to }, track[4])",
    "                        :SetEase(Ease[track[5]] or Enum.EaseType.Linear)",
    "                        :SetRelative(rotation)",
    "                    sequence:InsertCallback(track[3], function() target[1][target[2]] = from end)",
    "                    sequence:Insert(track[3], tween)",
    "                end",
    "            end",
    "        end",
    "        -- 后续 Clip 的构造不能把预览初始状态提前改成未来值。",
    "        for index, target in ipairs(lane.targets) do",
    "            if initials[index] ~= nil then target[1][target[2]] = initials[index] end",
    "        end",
    "    end",
    "    return sequence",
    "end",
    "",
    "return TweenTimelineLib",
    "",
  ];
  return { code: lines.join("\n"), fileName: "TweenTimelineLib.lua" };
}

function relativeControlPath(
  node: UINode,
  rootNode: UINode,
  nodeById: Map<string, UINode>,
) {
  if (node.id === rootNode.id) return "";
  const segments = [node.name];
  const visited = new Set([node.id]);
  let parentId = node.parentId;

  while (parentId) {
    if (parentId === rootNode.id) return segments.reverse().join("/");
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent) return null;
    segments.push(parent.name);
    parentId = parent.parentId;
  }
  return null;
}

function hasUnsafePathSegment(
  node: UINode,
  rootNode: UINode,
  nodeById: Map<string, UINode>,
) {
  if (node.id === rootNode.id) return false;
  const visited = new Set<string>();
  let current: UINode | undefined = node;
  while (current && current.id !== rootNode.id) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    if (!current.name.trim() || current.name.includes("/")) return true;
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  return current?.id !== rootNode.id;
}

/**
 * 将所选控件子树中的 Timeline 编译成可逆的紧凑 Lua Data 模块。
 * 所选控件本身对应 script.object；所有后代都使用相对该控件的 FindChild 路径。
 */
export function buildTweenTimelineDataLua(
  options: ExportOptions,
): TweenSequenceLuaExportResult {
  const { nodes, tracks, rootNodeId } = options;
  const warnings: string[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootNode = nodeById.get(rootNodeId);
  if (!rootNode) {
    throw new Error("找不到导出根控件");
  }

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const pathByNodeId = new Map<string, string>();
  for (const node of nodes) {
    const path = relativeControlPath(node, rootNode, nodeById);
    if (path !== null) pathByNodeId.set(node.id, path);
  }

  const prepared: PreparedTrack[] = [];
  const clipsByNodeField = new Map<string, UITweenTrack[]>();
  const acceptedTracks: UITweenTrack[] = [];
  const pathOwner = new Map<string, string>();
  for (const track of tracks) {
    const node = nodeById.get(track.nodeId);
    const nodePath = node ? pathByNodeId.get(node.id) : undefined;
    if (!node || nodePath === undefined) continue;
    const field = getTweenableField(node.type, track.fieldKey);
    if (field?.valueKind === "boolean") throw new Error("控件显隐须使用关键帧导出，不支持旧版 Tween Clip。");
    if (!field) {
      warnings.push(`控件「${node.name}」的字段 ${track.fieldKey} 不是已知 Tweenable 字段，已跳过。`);
      continue;
    }
    const relative = track.relative === true && isRelativeTweenField(field.fieldKey);
    if (track.relative === true && !relative) {
      warnings.push(`控件「${node.name}」的字段 ${field.fieldKey} 不支持位置/大小/缩放增量，已按绝对值导出。`);
    }
    const uniqueFieldKey = `${node.id}\0${field.fieldKey}`;
    const numberValuesAreValid =
      field.valueKind === "number" &&
      typeof track.initialValue === "number" &&
      Number.isFinite(track.initialValue) &&
      typeof track.endValue === "number" &&
      Number.isFinite(track.endValue);
    const colorValuesAreValid =
      field.valueKind === "color" &&
      isColor(track.initialValue) &&
      isColor(track.endValue);
    if (!numberValuesAreValid && !colorValuesAreValid) {
      warnings.push(`控件「${node.name}」的字段 ${field.fieldKey} 缺少有效的初始值或结束值，已跳过。`);
      continue;
    }
    if (!Number.isFinite(track.startTime) || track.startTime < 0 || !Number.isFinite(track.duration) || track.duration <= 0 || !Number.isFinite(track.startTime + track.duration)) {
      warnings.push(`控件「${node.name}」的字段 ${field.fieldKey} 时间参数无效，已跳过。`);
      continue;
    }
    const laneClips = clipsByNodeField.get(uniqueFieldKey) ?? [];
    if (laneClips.some((other) => tweenClipsOverlap(track, other))) {
      warnings.push(`控件「${node.name}」的字段 ${field.fieldKey} 存在时间重叠的 Clip，已保留先出现的 Clip 并跳过冲突项。`);
      continue;
    }
    if (hasUnsafePathSegment(node, rootNode, nodeById)) {
      warnings.push(`控件「${node.name}」的层级名称无法组成可靠的 FindChild 路径，已跳过。`);
      continue;
    }
    const owner = pathOwner.get(nodePath);
    if (owner && owner !== node.id) {
      warnings.push(`相对路径「${nodePath}」对应多个控件，无法可靠查找，重复目标已跳过。`);
      continue;
    }
    const conflict = getTweenTrackConflict(node.id, field.fieldKey, nodes, acceptedTracks);
    if (conflict) {
      warnings.push(`控件「${node.name}」的字段 ${field.fieldKey} ${conflict} 已跳过。`);
      continue;
    }
    const clampGroupAlpha = (value: UITweenValue) => field.fieldKey === GROUP_ALPHA_FIELD_KEY
      ? Math.max(0, Math.min(GROUP_ALPHA_MAX, value as number)) : value;
    clipsByNodeField.set(uniqueFieldKey, [...laneClips, track]);
    pathOwner.set(nodePath, node.id);
    acceptedTracks.push(track);
    prepared.push({
      node,
      nodePath,
      fieldKey: field.fieldKey,
      valueType: field.valueKind,
      startTime: track.startTime,
      duration: track.duration,
      easeType: track.easeType,
      initialValue: clampGroupAlpha(track.initialValue),
      endValue: clampGroupAlpha(track.endValue),
      relative,
    });
  }

  prepared.sort((left, right) =>
    left.startTime - right.startTime ||
    (nodeOrder.get(left.node.id) ?? 0) - (nodeOrder.get(right.node.id) ?? 0) ||
    left.fieldKey.localeCompare(right.fieldKey),
  );

  const validTracks = prepared;
  const targetIds = new Set<string>();
  let tweenCount = 0;
  for (const track of validTracks) {
    if (track.fieldKey !== GROUP_ALPHA_FIELD_KEY) {
      targetIds.add(track.node.id);
      tweenCount += 1;
      continue;
    }
    let groupTweenCount = 0;
    for (const target of getTweenGroupNodes(track.node.id, nodes)) {
      const colors = getGroupAlphaColorFields(target.type).filter((key) =>
        isColor((target.properties as unknown as Record<string, UITweenValue>)[key]),
      );
      if (colors.length) targetIds.add(target.id);
      groupTweenCount += colors.length;
    }
    tweenCount += groupTweenCount;
    if (groupTweenCount === 0) {
      warnings.push(`控件「${track.node.name}」及其子级当前没有可控制的颜色；已保留组透明度数据，运行时将重新扫描子级。`);
    }
  }
  const targetCount = targetIds.size;
  const hasGroupAlpha = validTracks.some((track) => track.fieldKey === GROUP_ALPHA_FIELD_KEY);
  const hasRelative = validTracks.some((track) => track.relative);
  const hasRelativeLayout = validTracks.some((track) => track.relative && !isScaleTweenField(track.fieldKey));
  const hasMultipleClips = [...clipsByNodeField.values()].some((clips) => clips.length > 1);
  const inferredDuration = validTracks.reduce(
    (maximum, track) => Math.max(maximum, track.startTime + track.duration),
    0,
  );
  const sequenceDuration =
    typeof options.sequenceDuration === "number" && Number.isFinite(options.sequenceDuration)
      ? Math.max(0, options.sequenceDuration)
      : inferredDuration;

  const lines: string[] = [
    `-- ${luaComment(options.projectName || "Client UI Animation")}`,
    `-- 导出根控件：${luaComment(rootNode.name)}`,
    "-- 可逆格式：tracks 每行依次为路径、字段、开始、时长、缓动、初值、终值。",
  ];
  if (hasGroupAlpha) {
    lines.push("-- groupAlpha：0–255 的自身及子级透明度，乘以各原始颜色的 Alpha；需要新版 TweenTimelineLib。");
  }
  if (hasRelative) {
    lines.push("-- 第 8 列 relative=true 表示位置/大小/缩放增量；首段基于 Create 前属性，后续段基于同轨道上一段终值。");
  }
  if (hasMultipleClips) {
    lines.push("-- 同一路径和字段的多行代表同一轨道的多个 Clip；空档保持上一段终值，需要新版 TweenTimelineLib。");
  }
  if (warnings.length) {
    lines.push("-- 导出提示：");
    warnings.forEach((warning) => lines.push(`-- ${luaComment(warning)}`));
  }

  lines.push(
    "",
    "local TweenTimelineData = {",
    `    schema = ${luaString(hasMultipleClips || hasRelativeLayout ? LAYOUT_RELATIVE_TWEEN_TIMELINE_SCHEMA : hasRelative ? SCALE_RELATIVE_TWEEN_TIMELINE_SCHEMA : hasGroupAlpha ? GROUP_ALPHA_TWEEN_TIMELINE_SCHEMA : LEGACY_TWEEN_TIMELINE_SCHEMA)},`,
    `    duration = ${formatNumber(sequenceDuration)},`,
    `    columns = { ${[
      "path",
      "field",
      "start",
      "duration",
      "ease",
      "from",
      "to",
      ...(hasRelative ? ["relative"] : []),
    ].map(luaString).join(", ")} },`,
    "    tracks = {",
  );

  validTracks.forEach((track) => {
    lines.push(
      `        { ${luaString(track.nodePath)}, ${luaString(track.fieldKey)}, ${formatNumber(track.startTime)}, ${formatNumber(track.duration)}, ${luaString(track.easeType)}, ${formatTimelineValue(track.initialValue, track.valueType)}, ${formatTimelineValue(track.endValue, track.valueType)}${track.relative ? ", true" : ""} },`,
    );
  });
  lines.push(
    "    },",
    "}",
    "",
    "return TweenTimelineData",
    "",
  );

  const baseName = [options.projectName, rootNode.name, "TweenTimelineData"]
    .filter(Boolean)
    .map(sanitizeFilePart)
    .join("-");
  return {
    code: lines.join("\n"),
    fileName: `${baseName || "TweenTimeline"}.lua`,
    warnings,
    trackCount: validTracks.length,
    tweenCount,
    targetCount,
  };
}
