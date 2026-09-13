import type { PrimitiveProperties } from "./primitiveData";

export type ControlType =
  | "container"
  | "image"
  | "primitive"
  | "text"
  | "textWindow"
  | "presetButton"
  | "cursorEventArea"
  | "gridScroller"
  | "keyHint"
  | "uiAnimation"
  | "fullscreenAnimation"
  | "reference";

export type UIImageType = "basic" | "stretch";
export type UIImageSource = "staticReference" | "item" | "equipment" | "skill" | "unitStatus" | "faction" | "currency" | "prefab";
export type ImageFillType = "unused" | "horizontal" | "vertical" | "radial90" | "radial180" | "radial360";
export type ImageMaskSoftEdgeMode = "percentage" | "pixel";
export type TextHorizontalAlignment = "left" | "middle" | "right";
export type TextVerticalAlignment = "top" | "middle" | "bottom";
export type ScrollDirection = "horizontal" | "vertical";
export type ScrollLayoutConstraint = "autoWrap" | "fixed";
export type UIAnimationLayer = "aboveAllControls" | "belowAllControls";

export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 编辑器基础模型；仅公开需要编辑的 ClientUIBaseControl 值。 */
export interface ClientUIBaseControlModel {
  /** 编辑器内部稳定标识，不是运行时控件 ID。 */
  id: string;
  /** 仅供层级树持久化，不在属性面板中作为 parent 字段公开。 */
  parentId: string | null;
  name: string;
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationX: number;
  rotationY: number;
  rotation: number;
  anchorMinX: number;
  anchorMinY: number;
  anchorMaxX: number;
  anchorMaxY: number;
  pivotX: number;
  pivotY: number;
  /** anchoredPositionX/Y：控件 pivot 相对锚点参考位置的偏移（与 GIA、Tween 共用）。 */
  anchorOffsetX: number;
  anchorOffsetY: number;
  sizeDeltaX: number;
  sizeDeltaY: number;
  canControllerFocus: boolean;
  visible: boolean;
  /** 仅属于编辑器，不导出为 ClientUIBaseControl 字段。 */
  locked: boolean;
}

export interface ClientUIContainerControlProperties {
  isolateNavigation: boolean;
  disableKeyEventPassthrough: boolean;
  disableCursorEventPassthrough: boolean;
  showCursor: boolean;
}

export interface ClientUIImageControlProperties {
  imageSource: UIImageSource | null;
  imageId: number | null;
  imageColor: ColorRGBA;
  imageType: UIImageType | null;
  enableMask: boolean;
  enableSoftEdge: boolean;
  softEdgeMode: ImageMaskSoftEdgeMode | null;
  softEdgeWidthX: number | null;
  softEdgeWidthY: number | null;
  horizontalSoftRange: number | null;
  verticalSoftRange: number | null;
  reverseMaskArea: boolean;
  fillType: ImageFillType | null;
  fillHorizontalType: "left" | "right" | null;
  fillVerticalType: "bottom" | "top" | null;
  fillRadial90Type: "bottomLeft" | "topLeft" | "topRight" | "bottomRight" | null;
  fillRadialType: "bottom" | "left" | "top" | "right" | null;
  fillAmount: number | null;
}

export interface ClientUITextBoxControlProperties {
  text: string;
  fontSize: number | null;
  fontColor: ColorRGBA;
  bgColor: ColorRGBA;
  enableOutline: boolean;
  outlineColor: ColorRGBA;
  horizontalAlignment: TextHorizontalAlignment | null;
  verticalAlignment: TextVerticalAlignment | null;
  adaptiveFontSize: boolean;
  minimumFontSize: number | null;
}

export interface ClientUITextWindowControlProperties extends ClientUITextBoxControlProperties {
  interactable: boolean;
  showScrollBar: boolean;
}

export interface ClientUIPresetButtonControlProperties {
  interactable: boolean;
  clickAudioId: number | null;
  raycastTarget: boolean;
}

export interface ClientUICursorEventAreaControlProperties {
  raycastTarget: boolean;
}

export interface ClientUIGridScrollerControlProperties {
  itemCount: number | null;
  itemPrefabIndex: number | null;
  raycastTarget: boolean;
  showScrollBar: boolean;
  interactable: boolean;
  scrollDirection: ScrollDirection | null;
  layoutConstraint: ScrollLayoutConstraint | null;
  layoutConstraintFixedCount: number | null;
  scrollProgress: number | null;
}

export interface ClientUIKeyHintControlProperties {
  keyboardKeyCode: string | null;
  controllerKeyCode: string | null;
}

export interface ClientUIAnimationControlProperties {
  animationId: number | null;
  playSoundEffect: boolean;
  layer: UIAnimationLayer | null;
}

export interface ClientUIFullscreenAnimationControlProperties {
  animationId: number | null;
  playSoundEffect: boolean;
}

export interface ClientUIReferenceControlProperties {
  referencedPrefabIndex: number | null;
}

export interface ControlPropertiesMap {
  /** 图元控件引用文件级图片资源；旧文件的内嵌图片在载入时迁移。原生导出暂映射为容器。 */
  primitive: PrimitiveProperties;
  container: ClientUIContainerControlProperties;
  image: ClientUIImageControlProperties;
  text: ClientUITextBoxControlProperties;
  textWindow: ClientUITextWindowControlProperties;
  presetButton: ClientUIPresetButtonControlProperties;
  cursorEventArea: ClientUICursorEventAreaControlProperties;
  gridScroller: ClientUIGridScrollerControlProperties;
  keyHint: ClientUIKeyHintControlProperties;
  uiAnimation: ClientUIAnimationControlProperties;
  fullscreenAnimation: ClientUIFullscreenAnimationControlProperties;
  reference: ClientUIReferenceControlProperties;
}

/** 画布辅助标识的存档数据，不属于游戏控件属性或 Tween 字段。 */
export interface UINodeEditorSettings {
  directionArrowLength?: number;
}

export type UINodeOf<T extends ControlType> = ClientUIBaseControlModel & {
  type: T;
  properties: ControlPropertiesMap[T];
  editor?: UINodeEditorSettings;
};

export type UINode = {
  [T in ControlType]: UINodeOf<T>;
}[ControlType];

export type UITweenValue = number | ColorRGBA | null;

/** 与 Enum.EaseType 完全一致的缓动类型。 */
export type TweenEaseType =
  | "Linear"
  | "InSine" | "OutSine" | "InOutSine"
  | "InQuad" | "OutQuad" | "InOutQuad"
  | "InCubic" | "OutCubic" | "InOutCubic"
  | "InQuart" | "OutQuart" | "InOutQuart"
  | "InQuint" | "OutQuint" | "InOutQuint"
  | "InExpo" | "OutExpo" | "InOutExpo"
  | "InCirc" | "OutCirc" | "InOutCirc"
  | "InBack" | "OutBack" | "InOutBack"
  | "InElastic" | "OutElastic" | "InOutElastic"
  | "InBounce" | "OutBounce" | "InOutBounce";

export interface UITweenTrack {
  /** 一个对象代表一个 Clip；相同 nodeId + fieldKey 的多个 Clip 共用一条属性轨道。 */
  id: string;
  nodeId: string;
  /** Client UI API 中的 Tweenable 字段名。 */
  fieldKey: string;
  startTime: number;
  duration: number;
  /** Tween 独立保存的首尾值，不会反向修改控件当前属性。 */
  initialValue: UITweenValue;
  endValue: UITweenValue;
  /** 位置/大小/缩放首尾值是加法增量；首段基于创建时属性，后续段基于上一段终值。省略表示绝对值。 */
  relative?: boolean;
  easeType: TweenEaseType;
}

/** A key's interpolation and easing describe the segment leading to the next key. */
export interface UIKeyframe {
  id: string;
  time: number;
  value: UITweenValue;
  /** Add to the previous key's resolved right-side value; the first key uses the control's base value. */
  relative?: boolean;
  easeType: TweenEaseType;
  interpolation: "tween" | "step";
  /** Optional left limit preserves a legacy Clip end followed immediately by a different Clip start. */
  incomingValue?: UITweenValue;
  /** Uses the same previous-key baseline as value, not this key's right-side value. */
  incomingRelative?: boolean;
}

export interface UIKeyframeTrack {
  id: string;
  nodeId: string;
  fieldKey: string;
  keyframes: UIKeyframe[];
}

/** One named animation of the shared control hierarchy. */
export interface UIAnimation {
  id: string;
  name: string;
  duration: number;
  keyframeTracks: UIKeyframeTrack[];
}
