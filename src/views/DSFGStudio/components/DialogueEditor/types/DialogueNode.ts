/** 一个节点就是一句台词及其配套演出。 */
export interface DialogueNode {
  id: string;
  name: string;
  nodeType: NodeType;
  durationMode: DurationMode;
  duration?: number;
  /** 可选的固定 Dialogue Line；新建 Group 时默认创建一个。 */
  dialogue?: DialogueClip;
  /** 可选的固定 Select Line；一个 Group 最多一个 Select Clip。 */
  select?: SelectClip;
  /** 固定单 Clip，时间到达后强制推进；目标由节点图连接决定。 */
  focusPush?: FocusPushClip;
  lines: PerformanceLine[];
  timeline: TimelineSettings;
  next?: string[];
}

export interface TimelineSettings {
  /** 编辑器显示范围（秒）；未设置时自动计算，不影响演出时长。 */
  displayDuration?: number;
  /** 包含固定 Dialogue Line 在内的最大纵向 Line 数。 */
  maxLines: number;
  /** Timeline 的基础结束时间；其他 Clip 可以把实际结束时间继续向后推。 */
  duration: number;
}

export type DurationMode = "Auto" | "Fixed";
export type NodeType = "Dialogue" | "Option" | "Branch";
export type DialogueStyleId = string;

export interface DialogueStyleDefinition {
  id: DialogueStyleId;
  label: string;
  description?: string;
}

export type SelectStyleId = string;

export interface SelectStyleDefinition {
  id: SelectStyleId;
  label: string;
  description?: string;
}

/** Dialogue Line 中至多存在一个台词 Clip。 */
export interface DialogueClip {
  id: string;
  /** 千星 DialogueData 的 UI 样式 ID。 */
  style: DialogueStyleId;
  speaker: string;
  content: string;
  subtitle: string;
  startTime: number;
  /** Clip 内部延迟标记；外层结束时间始终由 Group Timeline 派生。 */
  continueDelayTime: number;
  advanceMode: DialogueAdvanceMode;
  nodeGraphEvent: string[];
}

export interface FocusPushClip {
  id: string;
  startTime: number;
  outputMode: "Self" | "Shared";
  /** 共用模式下，现有出口的零基序号。 */
  sharedOutletIndex: number;
}

export interface SelectClip {
  id: string;
  style: SelectStyleId;
  startTime: number;
  /** Clip 内部延迟标记；外层结束时间始终由 Group Timeline 派生。 */
  continueDelayTime: number;
  options: SelectOption[];
}

/** 编辑时将 content/icon 成对保存，导出时再拆成两个平行列表。 */
export interface SelectOption {
  id: string;
  content: string;
  icon: number;
}

/** Dialogue 之外可纵向扩展的演出 Line。 */
export interface PerformanceLine {
  id: string;
  name: string;
  type: PerformanceLineType;
  clips: PerformanceClip[];
}

export type BuiltInPerformanceLineType =
  | "Camera"
  | "PublicEvent"
  | "Animation"
  | "Audio"
  | "Behavior"
  | "Custom";

/** 保留内置类型提示，同时允许后续注册用户自定义 Line。 */
export type PerformanceLineType =
  | BuiltInPerformanceLineType
  | (string & {});

export interface PerformanceClip {
  id: string;
  /** Clip 类型由所属 Line 决定，并随数据保存。 */
  type: PerformanceLineType;
  name: string;
  startTime: number;
  duration: number;
  components: ClipComponent[];
}

/** Clip 上可叠加的、完全可序列化的功能组件实例。 */
export interface ClipComponent {
  id: string;
  templateId: string;
  name: string;
  enabled: boolean;
  /** Camera only: omitted in older files, where viewpoint configuration stays enabled. */
  cameraViewpointEnabled?: boolean;
  properties: Record<string, unknown>;
}

export type ClipPropertyType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "text"
  | "vector3"
  | "struct"
  | "struct-list";

export interface ClipPropertyOption {
  label: string;
  value: string | number | boolean;
}

export interface ClipPropertyDefinition {
  key: string;
  label: string;
  type: ClipPropertyType;
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: ClipPropertyOption[];
  description?: string;
  /** 根据同一层级的另一个字段控制显示；隐藏时保留已填写的数据。 */
  visibleWhen?: { key: string; values: Array<string | number | boolean> };
  /** 嵌套结构体的字段；struct-list 时表示每个列表元素的字段。 */
  properties?: ClipPropertyDefinition[];
  /** List element fields selected by a sibling mode. */
  propertiesWhen?: { key: string; cases: Record<string, ClipPropertyDefinition[]> };
  maxItems?: number;
  minItems?: number;
  /** List bounds selected by a sibling field in the same struct. */
  itemLimitsWhen?: { key: string; cases: Record<string, { min: number; max: number }> };
}

/** 模板只描述结构和默认值；实例属性保存在 ClipComponent 中。 */
export interface ClipComponentTemplate {
  id: string;
  name: string;
  description?: string;
  extends?: string;
  properties: ClipPropertyDefinition[];
}

export interface PerformanceLineDefinition {
  type: PerformanceLineType;
  label: string;
  clipLabel: string;
  removable: boolean;
  defaultComponentTemplateIds: string[];
  allowedComponentTemplateIds: string[];
}

/** Dialogue 是否等待玩家按下“下一句”。 */
export type DialogueAdvanceMode = "PlayerInput" | "None";
