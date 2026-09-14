import { Position, type Edge, type Node } from "@vue-flow/core";
import type {
  ClipComponent,
  DialogueClip,
  DialogueNode,
  PerformanceClip,
  PerformanceLine,
  PerformanceLineType,
  SelectClip,
  SelectOption,
} from "../types/DialogueNode";
import type {
  ConditionBranchNode,
  ConditionBranchOutput,
} from "../types/ConditionBranchNode";
import type {
  DialogueProject,
  FlowNodeData,
} from "../types/FileStruct";
import {
  createClipComponent,
  resolveClipComponentTemplate,
} from "../config/clipComponentRegistry";
import { createClipPropertyValues } from "./clipProperties";
import { getLineDefinition } from "../config/lineRegistry";
import { DEFAULT_DIALOGUE_STYLE_ID } from "../config/dialogueStyleRegistry";
import { DEFAULT_SELECT_STYLE_ID, DEFAULT_SELECT_ICON_ID } from "../config/selectStyleRegistry";
import {
  DEFAULT_CONTINUE_DELAY_TIME,
  DEFAULT_TIMELINE_DURATION,
} from "./groupTimeline";
import {
  createDefaultQxqyStructIds,
  normalizeQxqyStructIds,
} from "./qxqyStructWorkspace";

export const CURRENT_SCHEMA_VERSION = 12 as const;
const DEFAULT_MAX_LINES = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createDialogueClip(): DialogueClip {
  return {
    id: createId("dialogue"),
    style: DEFAULT_DIALOGUE_STYLE_ID,
    speaker: "",
    content: "新建台词",
    subtitle: "",
    startTime: 0,
    continueDelayTime: DEFAULT_CONTINUE_DELAY_TIME,
    advanceMode: "PlayerInput",
    nodeGraphEvent: [],
  };
}

export function createSelectOption(): SelectOption {
  return {
    id: createId("option"),
    content: "新选项",
    icon: DEFAULT_SELECT_ICON_ID,
  };
}

export function createSelectClip(): SelectClip {
  return {
    id: createId("select"),
    style: DEFAULT_SELECT_STYLE_ID,
    startTime: 0,
    continueDelayTime: DEFAULT_CONTINUE_DELAY_TIME,
    options: [createSelectOption()],
  };
}

export function createPerformanceClip(
  type: PerformanceLineType,
  startTime = 0,
): PerformanceClip {
  const definition = getLineDefinition(type);

  return {
    id: createId("clip"),
    type,
    name: `新建${definition?.clipLabel ?? " Clip"}`,
    startTime: Math.max(0, startTime),
    duration: 1,
    components: (definition?.defaultComponentTemplateIds ?? []).map(
      createClipComponent,
    ),
  };
}

export function createPerformanceLine(
  type: PerformanceLineType,
): PerformanceLine {
  return {
    id: createId("line"),
    name: type,
    type,
    clips: [],
  };
}

export function createDialogueNode(id: string): DialogueNode {
  return {
    id,
    name: "新建 Group",
    nodeType: "Dialogue",
    durationMode: "Auto",
    dialogue: createDialogueClip(),
    select: undefined,
    lines: [createPerformanceLine("Camera")],
    timeline: {
      maxLines: DEFAULT_MAX_LINES,
      duration: DEFAULT_TIMELINE_DURATION,
    },
    next: [],
  };
}

export function createConditionBranchOutput(
  index: number,
): ConditionBranchOutput {
  return {
    id: createId("condition-output"),
    label: `分支 ${index + 1}`,
    condition: "",
  };
}

export function createConditionBranchNode(id: string): ConditionBranchNode {
  return {
    id,
    name: "条件判断",
    nodeType: "ConditionBranch",
    outputs: [
      createConditionBranchOutput(0),
      createConditionBranchOutput(1),
    ],
  };
}

export function createEmptyDialogueProject(): DialogueProject {
  const entryNodeId = createId("entry");

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportSettings: {
      qxqyStructIds: createDefaultQxqyStructIds(),
    },
    dialogue: {
      tree: {},
      entryNodeId,
      nodes: {},
      conditionBranches: {},
    },
    graph: {
      nodes: [
        {
          id: entryNodeId,
          type: "entry",
          position: { x: 120, y: 80 },
          data: {},
          sourcePosition: Position.Right,
          deletable: false,
          draggable: false,
        },
      ],
      edges: [],
    },
  };
}

function normalizeDialogueNode(id: string, value: unknown): DialogueNode {
  const source = isRecord(value) ? value : {};
  const sourceDialogue = isRecord(source.dialogue) ? source.dialogue : undefined;
  const sourceSelect = isRecord(source.select) ? source.select : undefined;
  const lines = Array.isArray(source.lines)
    ? source.lines.map((line, index) => normalizeLine(line, index))
    : [];

  if (!lines.some((line) => line.type === "Camera")) {
    lines.unshift(createPerformanceLine("Camera"));
  }

  const dialogue = sourceDialogue
    ? normalizeDialogueClip(sourceDialogue)
    : undefined;
  const select = sourceSelect ? normalizeSelectClip(sourceSelect) : undefined;
  const timelineSource = isRecord(source.timeline) ? source.timeline : {};
  const legacyTimelineEnd = Math.max(
    DEFAULT_TIMELINE_DURATION,
    sourceDialogue
      ? nonNegativeNumber(sourceDialogue.startTime, 0) +
          nonNegativeNumber(sourceDialogue.duration, 0)
      : 0,
    sourceSelect
      ? nonNegativeNumber(sourceSelect.startTime, 0) +
          nonNegativeNumber(sourceSelect.duration, 0)
      : 0,
  );

  return {
    id,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name
        : "未命名 Group",
    nodeType:
      source.nodeType === "Option" || source.nodeType === "Branch"
        ? source.nodeType
        : "Dialogue",
    durationMode: source.durationMode === "Fixed" ? "Fixed" : "Auto",
    duration: optionalNonNegativeNumber(source.duration),
    dialogue,
    select,
    lines,
    timeline: {
      maxLines: Math.max(
        lines.length + 2,
        positiveInteger(
          timelineSource.maxLines,
          DEFAULT_MAX_LINES,
        ),
      ),
      duration: Math.max(
        0.1,
        nonNegativeNumber(timelineSource.duration, legacyTimelineEnd),
      ),
    },
    next: Array.isArray(source.next)
      ? source.next.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function normalizeConditionBranchNode(
  id: string,
  value: unknown,
): ConditionBranchNode {
  const source = isRecord(value) ? value : {};
  const sourceOutputs = Array.isArray(source.outputs)
    ? source.outputs
    : [undefined, undefined];
  const usedIds = new Set<string>();

  return {
    id,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name
        : "条件判断",
    nodeType: "ConditionBranch",
    outputs: sourceOutputs.map((output, index) => {
      const normalized = normalizeConditionBranchOutput(output, index);
      if (usedIds.has(normalized.id)) {
        normalized.id = createId("condition-output");
      }
      usedIds.add(normalized.id);
      return normalized;
    }),
  };
}

function normalizeConditionBranchOutput(
  value: unknown,
  index: number,
): ConditionBranchOutput {
  const source = isRecord(value) ? value : {};
  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : createId("condition-output"),
    label:
      typeof source.label === "string" && source.label.trim()
        ? source.label
        : `分支 ${index + 1}`,
    condition: typeof source.condition === "string" ? source.condition : "",
  };
}

function normalizeDialogueClip(value: unknown): DialogueClip {
  const source = isRecord(value) ? value : {};
  const fallback = createDialogueClip();

  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : fallback.id,
    style:
      typeof source.style === "string" && source.style.trim()
        ? source.style
        : DEFAULT_DIALOGUE_STYLE_ID,
    speaker: typeof source.speaker === "string" ? source.speaker : "",
    content:
      typeof source.content === "string" ? source.content : "新建台词",
    subtitle: typeof source.subtitle === "string" ? source.subtitle : "",
    startTime: nonNegativeNumber(source.startTime, 0),
    continueDelayTime: nonNegativeNumber(
      source.continueDelayTime,
      DEFAULT_CONTINUE_DELAY_TIME,
    ),
    advanceMode:
      source.advanceMode === "None" || source.delayMode === "Auto"
        ? "None"
        : "PlayerInput",
    nodeGraphEvent: Array.isArray(source.nodeGraphEvent)
      ? source.nodeGraphEvent.filter(
          (event): event is string => typeof event === "string",
        )
      : [],
  };
}

function normalizeSelectClip(value: unknown): SelectClip {
  const source = isRecord(value) ? value : {};
  const fallback = createSelectClip();
  return {
    id:
      typeof source.id === "string" && source.id ? source.id : fallback.id,
    style:
      typeof source.style === "string" && source.style.trim()
        ? source.style
        : DEFAULT_SELECT_STYLE_ID,
    startTime: nonNegativeNumber(source.startTime, 0),
    continueDelayTime: nonNegativeNumber(
      source.continueDelayTime,
      DEFAULT_CONTINUE_DELAY_TIME,
    ),
    options: Array.isArray(source.options)
      ? source.options.map(normalizeSelectOption)
      : fallback.options,
  };
}

function normalizeSelectOption(value: unknown, index: number): SelectOption {
  const source = isRecord(value) ? value : {};
  const icon = source.icon == null ? DEFAULT_SELECT_ICON_ID : Number(source.icon);
  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : `option_${index}_${crypto.randomUUID()}`,
    content: typeof source.content === "string" ? source.content : "",
    icon:
      Number.isInteger(icon) && icon >= -2147483648 && icon <= 2147483647
        ? icon
        : DEFAULT_SELECT_ICON_ID,
  };
}

function normalizeLine(value: unknown, index: number): PerformanceLine {
  const source = isRecord(value) ? value : {};
  const type = normalizeLineType(source.type);
  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : `line_${index}`,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name
        : type,
    type,
    clips: Array.isArray(source.clips)
      ? source.clips.map((clip, clipIndex) =>
          normalizePerformanceClip(clip, type, index, clipIndex),
        )
      : [],
  };
}

function normalizePerformanceClip(
  value: unknown,
  lineType: PerformanceLineType,
  lineIndex: number,
  clipIndex: number,
): PerformanceClip {
  const source = isRecord(value) ? value : {};
  const type =
    typeof source.type === "string" && source.type ? source.type : lineType;
  const definition = getLineDefinition(type);
  const components = Array.isArray(source.components)
    ? source.components.map((component, componentIndex) =>
        normalizeClipComponent(component, componentIndex),
      )
    : (definition?.defaultComponentTemplateIds ?? []).map(createClipComponent);

  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : `clip_${lineIndex}_${clipIndex}`,
    type,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name
        : "未命名 Clip",
    startTime: nonNegativeNumber(source.startTime, 0),
    duration: Math.max(0.1, nonNegativeNumber(source.duration, 1)),
    components,
  };
}

function normalizeClipComponent(
  value: unknown,
  componentIndex: number,
): ClipComponent {
  const source = isRecord(value) ? value : {};
  const templateId = typeof source.templateId === "string" && source.templateId
    ? source.templateId
    : "custom.data";
  const template = resolveClipComponentTemplate(templateId);
  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : `component_${componentIndex}`,
    templateId,
    name:
      typeof source.name === "string" && source.name
        ? source.name
        : "未命名 Component",
    enabled: source.enabled !== false,
    ...(typeof source.cameraViewpointEnabled === "boolean" ? { cameraViewpointEnabled: source.cameraViewpointEnabled } : {}),
    properties: createClipPropertyValues(template?.properties ?? [], source.properties),
  };
}

function normalizeLineType(value: unknown): PerformanceLineType {
  return typeof value === "string" && value ? value : "Camera";
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function optionalNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

function isBusinessNode(type: string | undefined) {
  return type !== "entry" && type !== "output";
}

function normalizeGraphNode(node: Node): Node<FlowNodeData> {
  const isEntry = node.type === "entry";
  const isOutput = node.type === "output";
  const isConditionBranch = node.type === "condition";
  const dialogueNodeId = isBusinessNode(node.type) && !isConditionBranch
    ? isRecord(node.data) && typeof node.data.dialogueNodeId === "string"
      ? node.data.dialogueNodeId
      : node.id
    : undefined;
  const conditionBranchNodeId = isConditionBranch
    ? isRecord(node.data) &&
      typeof node.data.conditionBranchNodeId === "string"
      ? node.data.conditionBranchNodeId
      : node.id
    : undefined;

  return {
    ...node,
    data: dialogueNodeId
      ? { dialogueNodeId }
      : conditionBranchNodeId
        ? { conditionBranchNodeId }
        : {},
    deletable: isEntry ? false : node.deletable,
    draggable: isEntry ? false : node.draggable,
    sourcePosition: isOutput ? undefined : Position.Right,
    targetPosition: isEntry ? undefined : Position.Left,
  };
}

export function normalizeDialogueProject(value: unknown): DialogueProject {
  if (!isRecord(value)) {
    return createEmptyDialogueProject();
  }

  if (isRecord(value.dialogue) && isRecord(value.graph)) {
    const sourceExportSettings = isRecord(value.exportSettings)
      ? value.exportSettings
      : {};
    const sourceDialogue = value.dialogue;
    const sourceNodes = isRecord(sourceDialogue.nodes)
      ? sourceDialogue.nodes
      : {};
    const sourceConditionBranches = isRecord(
      sourceDialogue.conditionBranches,
    )
      ? sourceDialogue.conditionBranches
      : {};
    const dialogueNodes = Object.fromEntries(
      Object.entries(sourceNodes).map(([id, node]) => [
        id,
        normalizeDialogueNode(id, node),
      ]),
    );
    const conditionBranches = Object.fromEntries(
      Object.entries(sourceConditionBranches).map(([id, node]) => [
        id,
        normalizeConditionBranchNode(id, node),
      ]),
    );
    const sourceGraph = value.graph;
    const graphNodes = Array.isArray(sourceGraph.nodes)
      ? (sourceGraph.nodes as Node[]).map(normalizeGraphNode)
      : [];

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportSettings: {
        qxqyStructIds: normalizeQxqyStructIds(
          sourceExportSettings.qxqyStructIds ?? value.qxqyStructIds,
        ),
      },
      dialogue: {
        tree: sourceDialogue.tree ?? {},
        entryNodeId:
          typeof sourceDialogue.entryNodeId === "string"
            ? sourceDialogue.entryNodeId
            : undefined,
        nodes: dialogueNodes,
        conditionBranches,
      },
      graph: {
        nodes: graphNodes,
        edges: Array.isArray(sourceGraph.edges)
          ? (sourceGraph.edges as Edge[])
          : [],
      },
    };
  }

  return createEmptyDialogueProject();
}
