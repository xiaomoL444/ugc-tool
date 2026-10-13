import { t } from "../../i18n";
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
  return typeof node?.name === "string" && node.name ? node.name : t("clientUIAnimationEditor.ui.controls.unnamed");
}

function controlType(node: RecordValue | undefined): ControlType | null {
  return typeof node?.type === "string" && Object.prototype.hasOwnProperty.call(controlRegistry, node.type)
    ? node.type as ControlType : null;
}

function clipTarget(clip: RecordValue, nodes: Map<string, IdentifiedValue>): string {
  const node = typeof clip.nodeId === "string" ? nodes.get(clip.nodeId) : undefined;
  const fieldKey = typeof clip.fieldKey === "string" ? clip.fieldKey : "clientUIAnimationEditor.ui.history.unknownProperty";
  const type = controlType(node);
  const fieldLabel = type ? getTweenableField(type, fieldKey)?.label ?? fieldKey : fieldKey;
  return t("clientUIAnimationEditor.ui.history.nodeFieldTarget", { name: nodeName(node), field: t(fieldLabel) });
}

function keyframeChange(before: RecordValue, after: RecordValue, nodes: Map<string, IdentifiedValue>): string | null {
  const oldTracks = identifiedValues(before.keyframeTracks);
  const nextTracks = identifiedValues(after.keyframeTracks);
  const oldTrackMap = new Map(oldTracks.map((track) => [track.id, track]));
  const nextTrackMap = new Map(nextTracks.map((track) => [track.id, track]));
  const addedTracks = nextTracks.filter((track) => !oldTrackMap.has(track.id));
  const removedTracks = oldTracks.filter((track) => !nextTrackMap.has(track.id));
  if (addedTracks.length && removedTracks.length) return t("clientUIAnimationEditor.ui.history.replaceKeyframeAnimation");
  if (addedTracks.length) return addedTracks.length === 1
    ? t("clientUIAnimationEditor.ui.history.addKeyframeTrack", { value: clipTarget(addedTracks[0], nodes) }) : t("clientUIAnimationEditor.ui.history.addKeyframeTracks", { count: addedTracks.length });
  if (removedTracks.length) return removedTracks.length === 1
    ? t("clientUIAnimationEditor.ui.history.deleteKeyframeTrack", { value: clipTarget(removedTracks[0], nodes) }) : t("clientUIAnimationEditor.ui.history.deleteKeyframeTracks", { count: removedTracks.length });
  const track = nextTracks.find((item) => JSON.stringify(oldTrackMap.get(item.id)) !== JSON.stringify(item));
  if (!track) return null;
  const previousTrack = oldTrackMap.get(track.id)!;
  const target = clipTarget(track, nodes);
  if (changed(previousTrack, track, ["nodeId", "fieldKey"])) return t("clientUIAnimationEditor.ui.history.modifyKeyframeTrack", { target: target });
  const previousFrames = identifiedValues(previousTrack.keyframes);
  const nextFrames = identifiedValues(track.keyframes);
  const previousFrameMap = new Map(previousFrames.map((frame) => [frame.id, frame]));
  const nextFrameMap = new Map(nextFrames.map((frame) => [frame.id, frame]));
  const addedFrames = nextFrames.filter((frame) => !previousFrameMap.has(frame.id));
  const removedFrames = previousFrames.filter((frame) => !nextFrameMap.has(frame.id));
  if (addedFrames.length && removedFrames.length) return t("clientUIAnimationEditor.ui.history.replaceTrackKeyframes", { target: target });
  if (addedFrames.length) return addedFrames.length === 1
    ? t("clientUIAnimationEditor.ui.history.addKeyframe", { target: target }) : t("clientUIAnimationEditor.ui.history.addMultipleKeyframes", { target: target, count: addedFrames.length });
  if (removedFrames.length) return removedFrames.length === 1
    ? t("clientUIAnimationEditor.ui.history.deleteKeyframe", { target: target }) : t("clientUIAnimationEditor.ui.history.deleteMultipleKeyframes", { target: target, count: removedFrames.length });
  const frame = nextFrames.find((item) => JSON.stringify(previousFrameMap.get(item.id)) !== JSON.stringify(item));
  if (!frame) return previousFrames.some((item, index) => item.id !== nextFrames[index]?.id)
    ? t("clientUIAnimationEditor.ui.history.reorderKeyframes", { target: target }) : t("clientUIAnimationEditor.ui.history.modifyKeyframeTrack", { target: target });
  const previous = previousFrameMap.get(frame.id)!;
  if (changed(previous, frame, ["time"])) return t("clientUIAnimationEditor.ui.history.moveKeyframe", { target: target });
  if (Boolean(previous.relative) !== Boolean(frame.relative)) return frame.relative
    ? t("clientUIAnimationEditor.ui.history.enableKeyframeDelta", { target }) : t("clientUIAnimationEditor.ui.history.disableAdditiveKeyframes", { target });
  if (changed(previous, frame, ["easeType"])) return t("clientUIAnimationEditor.ui.history.changeKeyframeEasing", { target: target });
  if (changed(previous, frame, ["interpolation"])) return t("clientUIAnimationEditor.ui.history.editKeyframeInterpolation", { target: target });
  if (changed(previous, frame, ["value"])) return t("clientUIAnimationEditor.ui.history.editKeyframeValue", { target: target });
  return t("clientUIAnimationEditor.ui.history.editKeyframe", { target: target });
}

function nodeChange(before: IdentifiedValue, after: IdentifiedValue): string {
  const target = t("clientUIAnimationEditor.ui.history.nodeTarget", { name: nodeName(after) });
  if (changed(before, after, ["name"])) return t("clientUIAnimationEditor.ui.history.renameControl", { value: nodeName(before), target: target });
  // 移动会同步更新 anchorOffset；仅四个 Min/Max 字段代表锚点设置。
  if (changed(before, after, ["anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY"])) return t("clientUIAnimationEditor.ui.history.changeAnchors", { target: target });
  if (changed(before, after, ["pivotX", "pivotY"])) return t("clientUIAnimationEditor.ui.history.changePivot", { target: target });
  if (changed(before, after, ["rotation", "rotationX", "rotationY"])) return t("clientUIAnimationEditor.ui.history.rotateControl", { target: target });
  if (changed(before, after, ["scaleX", "scaleY", "scaleZ"])) return t("clientUIAnimationEditor.ui.history.scaleControl", { target: target });
  if (changed(before, after, ["width", "height", "sizeDeltaX", "sizeDeltaY"])) return t("clientUIAnimationEditor.ui.history.resizeControl", { target: target });
  if (changed(before, after, ["x", "y", "anchorOffsetX", "anchorOffsetY"])) return t("clientUIAnimationEditor.ui.history.moveControl", { target: target });
  if (changed(before, after, ["active"])) return t("clientUIAnimationEditor.ui.history.actionTarget", { value: after.active ? t("clientUIAnimationEditor.ui.history.activateLabel") : t("clientUIAnimationEditor.ui.controls.deactivate"), target: target });
  if (changed(before, after, ["visible"])) return t("clientUIAnimationEditor.ui.history.actionTarget", { value: after.visible ? t("clientUIAnimationEditor.ui.actions.show") : t("clientUIAnimationEditor.ui.controls.hide"), target: target });
  if (changed(before, after, ["locked"])) return t("clientUIAnimationEditor.ui.history.actionTarget", { value: after.locked ? t("clientUIAnimationEditor.ui.history.lockLabel") : t("clientUIAnimationEditor.ui.controls.unlock"), target: target });
  if (changed(before, after, ["editor"])) return t("clientUIAnimationEditor.ui.history.changeDirectionIndicator", { target: target });
  const previousProperties = isRecord(before.properties) ? before.properties : {};
  const nextProperties = isRecord(after.properties) ? after.properties : {};
  if (controlType(after) === "primitive") {
    if (changed(previousProperties, nextProperties, ["imageResourceId"])) return t("clientUIAnimationEditor.ui.history.changeImageResource", { target: target });
    if (changed(previousProperties, nextProperties, ["imageUrl"])) return t("clientUIAnimationEditor.ui.history.replacePrimitiveSourceImage", { target: target });
    if (changed(previousProperties, nextProperties, ["fitData"])) return nextProperties.fitData ? t("clientUIAnimationEditor.ui.history.generatePrimitiveData", { target: target }) : t("clientUIAnimationEditor.ui.history.clearPrimitiveData", { target: target });
    if (changed(previousProperties, nextProperties, ["fitOptions"])) return t("clientUIAnimationEditor.ui.history.changePrimitiveSettings", { target: target });
    if (changed(previousProperties, nextProperties, ["previewMode"])) return t("clientUIAnimationEditor.ui.history.switchPrimitivePreview", { target: target });
  }
  const propertyKeys = [...new Set([...Object.keys(previousProperties), ...Object.keys(nextProperties)])]
    .filter((key) => changed(previousProperties, nextProperties, [key]));
  if (propertyKeys.length) {
    const type = controlType(after);
    const fields = type ? controlRegistry[type].fields : [];
    if (propertyKeys.length === 1) {
      const field = fields.find((item) => item.key === propertyKeys[0]);
      return t("clientUIAnimationEditor.ui.history.changeControlField", { target: target, value: t(field?.label ?? "clientUIAnimationEditor.ui.history.controlPropertiesLabel") });
    }
    if (propertyKeys.every((key) => fields.some((field) => field.key === key && field.kind === "color"))) {
      return t("clientUIAnimationEditor.ui.history.changeControlColor", { target: target });
    }
  }
  return t("clientUIAnimationEditor.ui.history.changeControlProperties", { target: target });
}

/** 根据一次已合并的编辑行为命名；快照只用于描述，不会在此修改编辑器状态。 */
export function describeHistoryChange(beforeSource: string, afterSource: string): string {
  try {
    const before: unknown = JSON.parse(beforeSource);
    const after: unknown = JSON.parse(afterSource);
    if (!isRecord(before) || !isRecord(after)) return t("clientUIAnimationEditor.ui.history.modifyContent");
    if (changed(before, after, ["primitiveResources"])) {
      const oldResources = identifiedValues(before.primitiveResources), nextResources = identifiedValues(after.primitiveResources);
      const added = nextResources.find(asset => !oldResources.some(previous => previous.id === asset.id));
      if (added) return t("clientUIAnimationEditor.ui.history.importImageResource", { name: added.name });
      const removed = oldResources.find(asset => !nextResources.some(next => next.id === asset.id));
      if (removed) return t("clientUIAnimationEditor.ui.history.removeImageResource", { name: removed.name });
      const updated = nextResources.find(asset => JSON.stringify(asset) !== JSON.stringify(oldResources.find(old => old.id === asset.id)));
      if (updated) {
        const previous = oldResources.find(old => old.id === updated.id)!;
        if (changed(previous, updated, ["imageUrl"])) return t("clientUIAnimationEditor.ui.history.replaceImageResource", { name: updated.name });
        if (changed(previous, updated, ["fitData"])) return t("clientUIAnimationEditor.ui.history.setPrimitiveData", { value: updated.fitData ? t("clientUIAnimationEditor.ui.history.generateLabel") : t("clientUIAnimationEditor.ui.history.clearLabel"), name: updated.name });
        if (changed(previous, updated, ["fitOptions"])) return t("clientUIAnimationEditor.ui.history.changeImageFitSettings", { name: updated.name });
        if (changed(previous, updated, ["name"])) return t("clientUIAnimationEditor.ui.history.renameImageResource", { name: updated.name });
      }
      return t("clientUIAnimationEditor.ui.history.switchImageResourcePreview");
    }
    if (changed(before, after, ["controlTemplates"])) {
      const oldTemplates = identifiedValues(before.controlTemplates), nextTemplates = identifiedValues(after.controlTemplates);
      const added = nextTemplates.find(asset => !oldTemplates.some(previous => previous.id === asset.id));
      if (added) return t("clientUIAnimationEditor.ui.history.importControlTemplate", { name: added.name });
      return t("clientUIAnimationEditor.ui.history.editControlTemplates");
    }
    const oldNodes = identifiedValues(before.nodes);
    const nextNodes = identifiedValues(after.nodes);
    const oldNodeMap = new Map(oldNodes.map((node) => [node.id, node]));
    const nodeMap = new Map(nextNodes.map((node) => [node.id, node]));
    const addedNodes = nextNodes.filter((node) => !oldNodeMap.has(node.id));
    const removedNodes = oldNodes.filter((node) => !nodeMap.has(node.id));
    if (addedNodes.length && removedNodes.length) return t("clientUIAnimationEditor.ui.history.replaceHierarchy");
    if (addedNodes.length) return addedNodes.length === 1
      ? t("clientUIAnimationEditor.ui.history.addControl", { value: t(controlType(addedNodes[0]) ? controlRegistry[controlType(addedNodes[0])!].label : "clientUIAnimationEditor.ui.history.controlTarget"), value2: nodeName(addedNodes[0]) })
      : t("clientUIAnimationEditor.ui.history.addControls", { count: addedNodes.length });
    if (removedNodes.length) return removedNodes.length === 1
      ? t("clientUIAnimationEditor.ui.history.deleteControl", { value: nodeName(removedNodes[0]) }) : t("clientUIAnimationEditor.ui.history.deleteControls", { count: removedNodes.length });
    const reparented = nextNodes.find((node) => oldNodeMap.get(node.id)?.parentId !== node.parentId);
    if (reparented) {
      const parent = typeof reparented.parentId === "string" ? nodeMap.get(reparented.parentId) : undefined;
      return parent ? t("clientUIAnimationEditor.ui.history.moveControlToParent", { value: nodeName(reparented), value2: nodeName(parent) }) : t("clientUIAnimationEditor.ui.history.changeControlParent", { value: nodeName(reparented) });
    }
    const oldOrder = oldNodes.map((node) => node.id);
    const orderChanged = nextNodes.find((node, index) => oldOrder[index] !== node.id);
    if (orderChanged) return t("clientUIAnimationEditor.ui.history.reorderControls", { value: nodeName(orderChanged) });
    // 切换设备会重新计算整棵控件树，不能将派生的布局变化记录为移动控件。
    if (changed(before, after, ["deviceMode", "previewPresetId", "canvasWidth", "canvasHeight"])) return t("clientUIAnimationEditor.ui.history.changePreviewDeviceOrSize");
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
    if (addedAnimation) return t("clientUIAnimationEditor.ui.history.addAnimation", { name: addedAnimation.name });
    if (removedAnimation) return t("clientUIAnimationEditor.ui.history.deleteAnimation", { name: removedAnimation.name });
    for (const animation of nextAnimations) {
      const previous = oldAnimationMap.get(animation.id)!;
      if (previous.name !== animation.name) return t("clientUIAnimationEditor.ui.history.renameAnimation", { name: previous.name, name2: animation.name });
      if (JSON.stringify(previous.events ?? []) !== JSON.stringify(animation.events ?? [])) {
        const oldEvents = identifiedValues(previous.events), nextEvents = identifiedValues(animation.events);
        const action = nextEvents.length > oldEvents.length ? t("clientUIAnimationEditor.ui.history.addEvent") : nextEvents.length < oldEvents.length ? t("clientUIAnimationEditor.ui.history.deleteEvent") : t("clientUIAnimationEditor.ui.history.modifyEvents");
        return t("clientUIAnimationEditor.ui.history.animationAction", { name: animation.name, action });
      }
      const label = keyframeChange(previous, animation, nodeMap);
      if (label) return t("clientUIAnimationEditor.ui.history.animationChange", { name: animation.name, label });
      if (previous.duration !== animation.duration) return t("clientUIAnimationEditor.ui.history.changeSequenceDuration", { name: animation.name });
    }
    const keyframeLabel = keyframeChange(before, after, nodeMap);
    if (keyframeLabel) return keyframeLabel;
    const oldTracks = identifiedValues(before.tweenTracks);
    const nextTracks = identifiedValues(after.tweenTracks);
    const oldTrackMap = new Map(oldTracks.map((clip) => [clip.id, clip]));
    const nextTrackMap = new Map(nextTracks.map((clip) => [clip.id, clip]));
    const addedClips = nextTracks.filter((clip) => !oldTrackMap.has(clip.id));
    const removedClips = oldTracks.filter((clip) => !nextTrackMap.has(clip.id));
    if (addedClips.length && removedClips.length) return t("clientUIAnimationEditor.ui.history.replaceTweenAnimation");
    if (addedClips.length) return addedClips.length === 1
      ? t("clientUIAnimationEditor.ui.history.addClip", { value: clipTarget(addedClips[0], nodeMap) }) : t("clientUIAnimationEditor.ui.history.addMultipleClips", { count: addedClips.length });
    if (removedClips.length) return removedClips.length === 1
      ? t("clientUIAnimationEditor.ui.history.deleteClip", { value: clipTarget(removedClips[0], nodeMap) }) : t("clientUIAnimationEditor.ui.history.deleteMultipleClips", { count: removedClips.length });
    const clip = nextTracks.find((track) => JSON.stringify(oldTrackMap.get(track.id)) !== JSON.stringify(track));
    if (clip) {
      const previous = oldTrackMap.get(clip.id)!;
      const target = t("clientUIAnimationEditor.ui.history.clipTarget", { target: clipTarget(clip, nodeMap) });
      if (changed(previous, clip, ["duration"])) return t("clientUIAnimationEditor.ui.history.adjustClipDuration", { target: target });
      if (changed(previous, clip, ["startTime"])) return t("clientUIAnimationEditor.ui.history.moveClip", { target: target });
      if (changed(previous, clip, ["easeType"])) return t("clientUIAnimationEditor.ui.history.changeClipEasing", { target: target });
      if (Boolean(previous.relative) !== Boolean(clip.relative)) return clip.relative
        ? t("clientUIAnimationEditor.ui.history.enableRelativeTween", { target }) : t("clientUIAnimationEditor.ui.history.disableClipDelta", { target });
      const initialChanged = changed(previous, clip, ["initialValue"]);
      const endChanged = changed(previous, clip, ["endValue"]);
      if (initialChanged || endChanged) return t("clientUIAnimationEditor.ui.history.changeClipEndpoint", { target: target, value: initialChanged && endChanged ? t("clientUIAnimationEditor.ui.history.startAndEndValuesLabel") : initialChanged ? t("clientUIAnimationEditor.ui.history.initialValueLabel") : t("clientUIAnimationEditor.ui.timeline.endValue") });
      return t("clientUIAnimationEditor.ui.history.editClip", { target: target });
    }
    if (changed(before, after, ["duration"])) return t("clientUIAnimationEditor.ui.history.adjustSequenceDuration");
    if (changed(before, after, ["timelineSnapEnabled"])) return t(after.timelineSnapEnabled ? "clientUIAnimationEditor.ui.history.enableTimelineSnap" : "clientUIAnimationEditor.ui.history.disableTimelineSnap");
    if (changed(before, after, ["showContainerBones"])) return t("clientUIAnimationEditor.ui.history.toggleContainerBones", { value: after.showContainerBones ? t("clientUIAnimationEditor.ui.actions.show") : t("clientUIAnimationEditor.ui.controls.hide") });
    return t("clientUIAnimationEditor.ui.history.modifyContent");
  } catch {
    return t("clientUIAnimationEditor.ui.history.modifyContent");
  }
}
