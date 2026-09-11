import { controlRegistry } from "./controlRegistry";
import { getTweenableField } from "./tweenRegistry";
import type { ControlType } from "./types";

type RecordValue = Record<string, unknown>;
type IdentifiedValue = RecordValue & { id: string };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifiedValues(value: unknown): IdentifiedValue[] {
  return Array.isArray(value)
    ? value.filter((item): item is IdentifiedValue => isRecord(item) && typeof item.id === "string")
    : [];
}

function changed(before: RecordValue, after: RecordValue, keys: string[]): boolean {
  return keys.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function nodeName(node: RecordValue | undefined): string {
  return typeof node?.name === "string" && node.name ? node.name : "未命名控件";
}

function controlType(node: RecordValue | undefined): ControlType | null {
  return typeof node?.type === "string" && Object.prototype.hasOwnProperty.call(controlRegistry, node.type)
    ? node.type as ControlType : null;
}

function clipTarget(clip: RecordValue, nodes: Map<string, IdentifiedValue>): string {
  const node = typeof clip.nodeId === "string" ? nodes.get(clip.nodeId) : undefined;
  const fieldKey = typeof clip.fieldKey === "string" ? clip.fieldKey : "未知属性";
  const type = controlType(node);
  const fieldLabel = type ? getTweenableField(type, fieldKey)?.label ?? fieldKey : fieldKey;
  return `「${nodeName(node)} · ${fieldLabel}」`;
}

function keyframeChange(before: RecordValue, after: RecordValue, nodes: Map<string, IdentifiedValue>): string | null {
  const oldTracks = identifiedValues(before.keyframeTracks);
  const nextTracks = identifiedValues(after.keyframeTracks);
  const oldTrackMap = new Map(oldTracks.map((track) => [track.id, track]));
  const nextTrackMap = new Map(nextTracks.map((track) => [track.id, track]));
  const addedTracks = nextTracks.filter((track) => !oldTrackMap.has(track.id));
  const removedTracks = oldTracks.filter((track) => !nextTrackMap.has(track.id));
  if (addedTracks.length && removedTracks.length) return "替换关键帧动画";
  if (addedTracks.length) return addedTracks.length === 1
    ? `新增 ${clipTarget(addedTracks[0], nodes)} 关键帧轨道` : `新增 ${addedTracks.length} 条关键帧轨道`;
  if (removedTracks.length) return removedTracks.length === 1
    ? `删除 ${clipTarget(removedTracks[0], nodes)} 关键帧轨道` : `删除 ${removedTracks.length} 条关键帧轨道`;
  const track = nextTracks.find((item) => JSON.stringify(oldTrackMap.get(item.id)) !== JSON.stringify(item));
  if (!track) return null;
  const previousTrack = oldTrackMap.get(track.id)!;
  const target = clipTarget(track, nodes);
  if (changed(previousTrack, track, ["nodeId", "fieldKey"])) return `修改 ${target} 关键帧轨道`;
  const previousFrames = identifiedValues(previousTrack.keyframes);
  const nextFrames = identifiedValues(track.keyframes);
  const previousFrameMap = new Map(previousFrames.map((frame) => [frame.id, frame]));
  const nextFrameMap = new Map(nextFrames.map((frame) => [frame.id, frame]));
  const addedFrames = nextFrames.filter((frame) => !previousFrameMap.has(frame.id));
  const removedFrames = previousFrames.filter((frame) => !nextFrameMap.has(frame.id));
  if (addedFrames.length && removedFrames.length) return `替换 ${target} 关键帧`;
  if (addedFrames.length) return addedFrames.length === 1
    ? `新增 ${target} 关键帧` : `新增 ${target} 的 ${addedFrames.length} 个关键帧`;
  if (removedFrames.length) return removedFrames.length === 1
    ? `删除 ${target} 关键帧` : `删除 ${target} 的 ${removedFrames.length} 个关键帧`;
  const frame = nextFrames.find((item) => JSON.stringify(previousFrameMap.get(item.id)) !== JSON.stringify(item));
  if (!frame) return previousFrames.some((item, index) => item.id !== nextFrames[index]?.id)
    ? `调整 ${target} 关键帧顺序` : `修改 ${target} 关键帧轨道`;
  const previous = previousFrameMap.get(frame.id)!;
  if (changed(previous, frame, ["time"])) return `移动 ${target} 关键帧`;
  if (Boolean(previous.relative) !== Boolean(frame.relative)) return `${frame.relative ? "启用" : "关闭"} ${target} 关键帧增量`;
  if (changed(previous, frame, ["easeType"])) return `修改 ${target} 关键帧缓动`;
  if (changed(previous, frame, ["interpolation"])) return `修改 ${target} 关键帧插值方式`;
  if (changed(previous, frame, ["value"])) return `修改 ${target} 关键帧值`;
  return `修改 ${target} 关键帧`;
}

function nodeChange(before: IdentifiedValue, after: IdentifiedValue): string {
  const target = `「${nodeName(after)}」`;
  if (changed(before, after, ["name"])) return `重命名「${nodeName(before)}」为${target}`;
  // 移动会同步更新 anchorOffset；仅四个 Min/Max 字段代表锚点设置。
  if (changed(before, after, ["anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY"])) return `修改${target}的锚点`;
  if (changed(before, after, ["pivotX", "pivotY"])) return `修改${target}的中心点`;
  if (changed(before, after, ["rotation", "rotationX", "rotationY"])) return `旋转${target}`;
  if (changed(before, after, ["scaleX", "scaleY", "scaleZ"])) return `缩放${target}`;
  if (changed(before, after, ["width", "height", "sizeDeltaX", "sizeDeltaY"])) return `调整${target}的大小`;
  if (changed(before, after, ["x", "y", "anchorOffsetX", "anchorOffsetY"])) return `移动${target}`;
  if (changed(before, after, ["active"])) return `${after.active ? "激活" : "停用"}${target}`;
  if (changed(before, after, ["visible"])) return `${after.visible ? "显示" : "隐藏"}${target}`;
  if (changed(before, after, ["locked"])) return `${after.locked ? "锁定" : "解锁"}${target}`;
  if (changed(before, after, ["editor"])) return `修改${target}的方向标识`;
  const previousProperties = isRecord(before.properties) ? before.properties : {};
  const nextProperties = isRecord(after.properties) ? after.properties : {};
  const propertyKeys = [...new Set([...Object.keys(previousProperties), ...Object.keys(nextProperties)])]
    .filter((key) => changed(previousProperties, nextProperties, [key]));
  if (propertyKeys.length) {
    const type = controlType(after);
    const fields = type ? controlRegistry[type].fields : [];
    if (propertyKeys.length === 1) {
      const field = fields.find((item) => item.key === propertyKeys[0]);
      return `修改${target}的${field?.label ?? "控件属性"}`;
    }
    if (propertyKeys.every((key) => fields.some((field) => field.key === key && field.kind === "color"))) {
      return `修改${target}的颜色`;
    }
  }
  return `修改${target}的控件属性`;
}

/** 根据一次已合并的编辑行为命名；快照只用于描述，不会在此修改编辑器状态。 */
export function describeHistoryChange(beforeSource: string, afterSource: string): string {
  try {
    const before: unknown = JSON.parse(beforeSource);
    const after: unknown = JSON.parse(afterSource);
    if (!isRecord(before) || !isRecord(after)) return "修改编辑内容";
    const oldNodes = identifiedValues(before.nodes);
    const nextNodes = identifiedValues(after.nodes);
    const oldNodeMap = new Map(oldNodes.map((node) => [node.id, node]));
    const nodeMap = new Map(nextNodes.map((node) => [node.id, node]));
    const addedNodes = nextNodes.filter((node) => !oldNodeMap.has(node.id));
    const removedNodes = oldNodes.filter((node) => !nodeMap.has(node.id));
    if (addedNodes.length && removedNodes.length) return "替换控件层级";
    if (addedNodes.length) return addedNodes.length === 1
      ? `新增${controlType(addedNodes[0]) ? controlRegistry[controlType(addedNodes[0])!].label : "控件"}「${nodeName(addedNodes[0])}」`
      : `新增 ${addedNodes.length} 个控件`;
    if (removedNodes.length) return removedNodes.length === 1
      ? `删除控件「${nodeName(removedNodes[0])}」` : `删除 ${removedNodes.length} 个控件`;
    const reparented = nextNodes.find((node) => oldNodeMap.get(node.id)?.parentId !== node.parentId);
    if (reparented) {
      const parent = typeof reparented.parentId === "string" ? nodeMap.get(reparented.parentId) : undefined;
      return parent ? `将「${nodeName(reparented)}」移入「${nodeName(parent)}」` : `调整「${nodeName(reparented)}」的父级`;
    }
    const oldOrder = oldNodes.map((node) => node.id);
    const orderChanged = nextNodes.find((node, index) => oldOrder[index] !== node.id);
    if (orderChanged) return `调整「${nodeName(orderChanged)}」的层级顺序`;
    // 切换设备会重新计算整棵控件树，不能将派生的布局变化记录为移动控件。
    if (changed(before, after, ["deviceMode", "previewPresetId", "canvasWidth", "canvasHeight"])) return "切换画布预览设备或尺寸";
    const changedNodes = nextNodes.filter((node) => JSON.stringify(oldNodeMap.get(node.id)) !== JSON.stringify(node));
    if (changedNodes.length) {
      const changedIds = new Set(changedNodes.map((node) => node.id));
      // 父级变换可能改变全部后代的世界位置：优先命名最上层的实际编辑对象。
      const primary = changedNodes.find((node) => {
        let parentId = node.parentId;
        const visited = new Set<string>();
        while (typeof parentId === "string" && !visited.has(parentId)) {
          if (changedIds.has(parentId)) return false;
          visited.add(parentId);
          parentId = nodeMap.get(parentId)?.parentId;
        }
        return true;
      }) ?? changedNodes[0];
      return nodeChange(oldNodeMap.get(primary.id)!, primary);
    }
    const oldAnimations = identifiedValues(before.animations);
    const nextAnimations = identifiedValues(after.animations);
    const oldAnimationMap = new Map(oldAnimations.map(animation => [animation.id, animation]));
    const addedAnimation = nextAnimations.find(animation => !oldAnimationMap.has(animation.id));
    const removedAnimation = oldAnimations.find(animation => !nextAnimations.some(next => next.id === animation.id));
    if (addedAnimation) return `新增动画「${addedAnimation.name}」`;
    if (removedAnimation) return `删除动画「${removedAnimation.name}」`;
    for (const animation of nextAnimations) {
      const previous = oldAnimationMap.get(animation.id)!;
      if (previous.name !== animation.name) return `重命名动画「${previous.name}」为「${animation.name}」`;
      const label = keyframeChange(previous, animation, nodeMap);
      if (label) return `「${animation.name}」· ${label}`;
      if (previous.duration !== animation.duration) return `调整序列时长 ·「${animation.name}」`;
    }
    const keyframeLabel = keyframeChange(before, after, nodeMap);
    if (keyframeLabel) return keyframeLabel;
    const oldTracks = identifiedValues(before.tweenTracks);
    const nextTracks = identifiedValues(after.tweenTracks);
    const oldTrackMap = new Map(oldTracks.map((clip) => [clip.id, clip]));
    const nextTrackMap = new Map(nextTracks.map((clip) => [clip.id, clip]));
    const addedClips = nextTracks.filter((clip) => !oldTrackMap.has(clip.id));
    const removedClips = oldTracks.filter((clip) => !nextTrackMap.has(clip.id));
    if (addedClips.length && removedClips.length) return "替换 Timeline 动画";
    if (addedClips.length) return addedClips.length === 1
      ? `新增 ${clipTarget(addedClips[0], nodeMap)} Clip` : `新增 ${addedClips.length} 个 Clip`;
    if (removedClips.length) return removedClips.length === 1
      ? `删除 ${clipTarget(removedClips[0], nodeMap)} Clip` : `删除 ${removedClips.length} 个 Clip`;
    const clip = nextTracks.find((track) => JSON.stringify(oldTrackMap.get(track.id)) !== JSON.stringify(track));
    if (clip) {
      const previous = oldTrackMap.get(clip.id)!;
      const target = `${clipTarget(clip, nodeMap)} Clip`;
      if (changed(previous, clip, ["duration"])) return `调整 ${target} 时长`;
      if (changed(previous, clip, ["startTime"])) return `移动 ${target}`;
      if (changed(previous, clip, ["easeType"])) return `修改 ${target} 缓动`;
      if (Boolean(previous.relative) !== Boolean(clip.relative)) return `${clip.relative ? "启用" : "关闭"} ${target} 增量`;
      const initialChanged = changed(previous, clip, ["initialValue"]);
      const endChanged = changed(previous, clip, ["endValue"]);
      if (initialChanged || endChanged) return `修改 ${target} ${initialChanged && endChanged ? "起止值" : initialChanged ? "初始值" : "结束值"}`;
      return `修改 ${target}`;
    }
    if (changed(before, after, ["duration"])) return "调整序列时长";
    if (changed(before, after, ["timelineSnapEnabled"])) return `${after.timelineSnapEnabled ? "启用" : "关闭"}时间轴吸附`;
    if (changed(before, after, ["showContainerBones"])) return `${after.showContainerBones ? "显示" : "隐藏"}容器骨骼`;
    return "修改编辑内容";
  } catch {
    return "修改编辑内容";
  }
}
