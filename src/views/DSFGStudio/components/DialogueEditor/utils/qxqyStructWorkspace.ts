import { VariableWorkspace, type StructDefinition } from "miliastra-variable";
import performanceDefinition from "@/assets/DSFGStudio/1077936158演出.json";
import actionGroupDefinition from "@/assets/DSFGStudio/1077936159ActionGroup.json";
import actionClipDefinition from "@/assets/DSFGStudio/1077936160ActionClip.json";
import dialogueDefinition from "@/assets/DSFGStudio/1077936129对话节点.json";
import selectDefinition from "@/assets/DSFGStudio/1077936138选项卡.json";
import cameraDefinition from "@/assets/DSFGStudio/1077936156CameraClip.json";
import cameraPositionDefinition from "@/assets/DSFGStudio/1077936162PositionData.json";
import cameraRotationDefinition from "@/assets/DSFGStudio/1077936163RotationnData.json";
import cameraSlotDefinition from "@/assets/DSFGStudio/1077936164PositionSlot.json";
import type {
  QxqyStructIdKey,
  QxqyStructIds,
} from "../types/FileStruct";

export const DEFAULT_QXQY_STRUCT_IDS: QxqyStructIds = {
  performance: "1077936158",
  actionGroup: "1077936159",
  actionClip: "1077936160",
  dialogue: "1077936129",
  select: "1077936138",
  camera: "1077936156",
  cameraPosition: "1077936162",
  cameraRotation: "1077936163",
  cameraSlot: "1077936164",
};

export const QXQY_STRUCT_ID_FIELDS: ReadonlyArray<{
  key: QxqyStructIdKey;
  label: string;
  description: string;
}> = [
  { key: "performance", label: "演出", description: "导出 JSON 的根结构体" },
  { key: "actionGroup", label: "ActionGroup", description: "每个 Group 的演出数据" },
  { key: "actionClip", label: "ActionClip", description: "每个时间点触发的动作" },
  { key: "dialogue", label: "DialogueData", description: "台词数据结构体" },
  { key: "select", label: "SelectData", description: "选项卡数据结构体" },
  { key: "camera", label: "CameraMovement", description: "镜头运镜数据结构体" },
  { key: "cameraPosition", label: "PositionData", description: "运镜位置参数结构体" },
  { key: "cameraRotation", label: "RotationData", description: "运镜旋转参数结构体" },
  { key: "cameraSlot", label: "PositionSlot", description: "运镜位置／目标点结构体" },
];

const definitions: Record<QxqyStructIdKey, StructDefinition> = {
  performance: performanceDefinition as StructDefinition,
  actionGroup: actionGroupDefinition as StructDefinition,
  actionClip: actionClipDefinition as StructDefinition,
  dialogue: dialogueDefinition as StructDefinition,
  select: selectDefinition as StructDefinition,
  camera: cameraDefinition as StructDefinition,
  cameraPosition: cameraPositionDefinition as StructDefinition,
  cameraRotation: cameraRotationDefinition as StructDefinition,
  cameraSlot: cameraSlotDefinition as StructDefinition,
};

export function createDefaultQxqyStructIds(): QxqyStructIds {
  return { ...DEFAULT_QXQY_STRUCT_IDS };
}

export function normalizeQxqyStructIds(value: unknown): QxqyStructIds {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    QXQY_STRUCT_ID_FIELDS.map(({ key }) => {
      const candidate = source[key];
      return [
        key,
        typeof candidate === "string" && candidate.trim()
          ? candidate.trim()
          : DEFAULT_QXQY_STRUCT_IDS[key],
      ];
    }),
  ) as unknown as QxqyStructIds;
}

export function validateQxqyStructIds(ids: QxqyStructIds): string[] {
  const errors: string[] = [];
  const used = new Map<string, string>();

  for (const field of QXQY_STRUCT_ID_FIELDS) {
    const value = ids[field.key].trim();
    if (!/^\d+$/.test(value)) {
      errors.push(`${field.label} 的 ID 必须是数字`);
      continue;
    }
    const duplicate = used.get(value);
    if (duplicate) {
      errors.push(`${field.label} 与 ${duplicate} 不能使用相同 ID`);
    } else {
      used.set(value, field.label);
    }
  }

  return errors;
}

export function createQxqyStructWorkspace(ids: QxqyStructIds) {
  const replacements = new Map(
    QXQY_STRUCT_ID_FIELDS.map(({ key }) => [
      DEFAULT_QXQY_STRUCT_IDS[key],
      ids[key],
    ]),
  );

  const remappedDefinitions = Object.fromEntries(
    QXQY_STRUCT_ID_FIELDS.map(({ key }) => [
      ids[key],
      remapStructIds(definitions[key], replacements) as StructDefinition,
    ]),
  ) as Record<string, StructDefinition>;

  return new VariableWorkspace(remappedDefinitions);
}

function remapStructIds(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapStructIds(item, replacements));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (
        (key === "structId" || key === "value_structId") &&
        typeof child === "string"
      ) {
        return [key, replacements.get(child) ?? child];
      }
      return [key, remapStructIds(child, replacements)];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
