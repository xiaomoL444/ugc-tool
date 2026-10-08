import type { CustomPresetTable } from "./customPresets";
import type { PublicEventPreset, PublicEventParameter } from "./publicEventPresets";
import type { EntityPreset } from "./entityPresets";
import type { SkillAnimationPreset } from "./skillAnimationPresets";

/**
 * 所有预设的系统默认配置统一在这里修改。
 * newItem：新建自定义条目的字段默认值；presets：所有工作区始终提供的只读系统条目。
 * 内置条目必须使用稳定、唯一的 id。未提供真实条目时保持空列表，不虚构技能 ID。
 */
export const systemPresetConfig = {
  entityGetMethods: {
    newItem: { label: "", value: "" },
    presets: [
      { id: "entity-get-guid", label: "GUID", value: "0" },
      { id: "entity-get-string", label: "String", value: "1" },
    ],
  },
  booleans: {
    newItem: { label: "", value: "0" },
    presets: [
      { id: "boolean-false", label: "否", value: "0" },
      { id: "boolean-true", label: "是", value: "1" },
    ],
  },
  customTables: {
    newItem: { name: "", fields: [], records: [] },
    newField: { name: "", type: "String" as const },
    newRecord: { name: "", values: {} },
    presets: [] as CustomPresetTable[],
  },
  cameras: {
    newItem: { label: "", value: "" },
    presets: [{ id: "camera-default", label: "默认镜头", value: "NOLOC_Default" }],
  },
  dialogueStyles: {
    newItem: { label: "", value: "", showTitle: false },
    presets: [
      { id: "dialogue-default", label: "默认样式", value: "NOLOC_Default", showTitle: true },
      { id: "dialogue-black-screen", label: "黑幕对话", value: "NOLOC_BlackScreen", showTitle: false },
      { id: "dialogue-bottom-cg", label: "底部CG文本", value: "NOLOC_BottomCG", showTitle: false },
      { id: "dialogue-bottom-dialog", label: "底部对话文本", value: "NOLOC_BottomDialog", showTitle: true },
      { id: "dialogue-clear", label: "清除效果", value: "NOLOC_Clear", showTitle: false },
    ],
  },
  questStyles: {
    newItem: { label: "", value: "" },
    presets: [{ id: "quest-mainline", label: "主线任务", value: "NOLOC_Mainline" }],
  },
  walkTalkStyles: {
    newItem: { label: "", value: "" },
    presets: [{ id: "walk-talk-default", label: "默认样式", value: "NOLOC_Default" }],
  },
  entities: {
    newItem: { name: "", talker: "", subtitle: "", guid: "", entityQuery: "" },
    presets: [{ id: "system-player-self", name: "玩家自身", talker: "{1:ps.NICKNAME}", subtitle: "", guid: "1086324738", entityQuery: "" }] as EntityPreset[],
  },
  publicEvents: {
    newItem: { alias: "", name: "", parameters: [] as PublicEventParameter[] },
    newParameter: { name: "", type: "String" as const, defaultValue: "" },
    presets: [{
      id: "public-player-skill",
      alias: "玩家播放技能动画",
      name: "NOLOC_PlayerSkill",
      parameters: [{
        id: "public-player-skill-config-id",
        name: "技能配置 ID",
        type: "ConfigReference",
        reference: "skillAnimations.configId",
        defaultValue: "",
      }],
    }, {
      id: "public-player-teleport",
      alias: "玩家传送",
      name: "NOLOC_PlayerTeleport",
      parameters: [
        { id: "public-player-teleport-position-x", name: "位置 X", type: "Float", defaultValue: "0" },
        { id: "public-player-teleport-position-y", name: "位置 Y", type: "Float", defaultValue: "0" },
        { id: "public-player-teleport-position-z", name: "位置 Z", type: "Float", defaultValue: "0" },
        { id: "public-player-teleport-rotation-y", name: "旋转 Y", type: "Float", defaultValue: "0" },
      ],
    }, {
      id: "public-simple-black-screen",
      alias: "播放简单黑幕",
      name: "NOLOC_SimpleBlackScreen",
      parameters: [
        { id: "public-simple-black-screen-color", name: "颜色（#RRGGBB 或 #RRGGBBAA）", type: "String", defaultValue: "#000000FF" },
        { id: "public-simple-black-screen-transition", name: "过渡时间", type: "Float", defaultValue: "0.5" },
        { id: "public-simple-black-screen-hold", name: "持续时间", type: "Float", defaultValue: "1" },
        { id: "public-simple-black-screen-fade-out", name: "淡出时间", type: "Float", defaultValue: "0.5" },
      ],
    }, {
      id: "public-lock-and-play-bgm",
      alias: "锁定并播放BGM",
      name: "NOLOC_LockAndPlayBGM",
      parameters: [
        { id: "public-lock-and-play-bgm-index", name: "背景音乐索引", type: "Int32", defaultValue: "" },
        { id: "public-lock-and-play-bgm-start-time-1", name: "开始时间", type: "Float", defaultValue: "" },
        { id: "public-lock-and-play-bgm-start-time-2", name: "开始时间", type: "Float", defaultValue: "" },
        { id: "public-lock-and-play-bgm-speed", name: "播放速度", type: "Float", defaultValue: "" },
      ],
    }, {
      id: "public-unlock-bgm",
      alias: "解锁BGM",
      name: "NOLOC_UnlockBGM",
      parameters: [],
    }, {
      id: "public-camera-lerp-to-npc",
      alias: "演出注目实体",
      name: "NOLOC_CameraLerpToNPC",
      parameters: [],
    }, {
      id: "public-reset-camera",
      alias: "重置镜头",
      name: "NOLOC_ResetCamera",
      parameters: [{
        id: "public-reset-camera-immediate",
        name: "是否立即到达",
        type: "Int32",
        reference: "booleans.value",
        defaultValue: "0",
      }],
    }, {
      id: "public-set-object-entity-forward",
      alias: "触发实体朝向（仅物件）",
      name: "NOLOC_SetObjectEntityFoward",
      parameters: [
        { id: "object-forward-boolean", name: "设置朝向（否＝重置）", type: "Int32", reference: "booleans.value", defaultValue: "" },
        { id: "object-forward-method-1", name: "实体1获取方式", type: "Int32", reference: "entityGetMethods.value", defaultValue: "" },
        { id: "object-forward-guid-1", name: "实体1 GUID", type: "Guid", reference: "entities.guid", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-method-1", equals: "0" }] },
        { id: "object-forward-string-1", name: "实体1 String", type: "String", reference: "entities.entityQuery", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-method-1", equals: "1" }] },
        { id: "object-forward-method-2", name: "实体2获取方式", type: "Int32", reference: "entityGetMethods.value", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-boolean", equals: "1" }] },
        { id: "object-forward-guid-2", name: "实体2 GUID", type: "Guid", reference: "entities.guid", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-boolean", equals: "1" }, { parameterId: "object-forward-method-2", equals: "0" }] },
        { id: "object-forward-string-2", name: "实体2 String", type: "String", reference: "entities.entityQuery", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-boolean", equals: "1" }, { parameterId: "object-forward-method-2", equals: "1" }] },
      ],
    }] as PublicEventPreset[],
  },
  skillAnimations: {
    newItem: { name: "", configId: "" },
   presets: [
  { id: "skill-afraid-loop", name: "恐惧-持续", configId: "1098907659" },
  { id: "skill-afraid-end", name: "恐惧-后摇", configId: "1098907660" },
  { id: "skill-vigilance-loop", name: "警觉-持续", configId: "1098907662" },
  { id: "skill-vigilance-end", name: "警觉-后摇", configId: "1098907663" },
  { id: "skill-talk-loop", name: "交谈-持续", configId: "1098907649" },
  { id: "skill-talk-end", name: "交谈-后摇", configId: "1098907651" },
  { id: "skill-celebrate-loop", name: "庆祝-持续", configId: "1098907664" },
  { id: "skill-celebrate-end", name: "庆祝-后摇", configId: "1098907665" },
  { id: "skill-confuse-loop", name: "困惑-持续", configId: "1098907655" },
  { id: "skill-confuse-end", name: "困惑-后摇", configId: "1098907656" },
  { id: "skill-depressed-loop", name: "消沉-持续", configId: "1098907666" },
  { id: "skill-depressed-end", name: "消沉-后摇", configId: "1098907667" },
  { id: "skill-arms-crossed-loop", name: "抱胸-持续", configId: "1098907652" },
  { id: "skill-arms-crossed-end", name: "抱胸-后摇", configId: "1098907654" },
  { id: "skill-facepalm-loop", name: "扶额-持续", configId: "1098907668" },
  { id: "skill-facepalm-end", name: "扶额-后摇", configId: "1098907669" },
  { id: "skill-point-forward-loop", name: "向前指向-持续", configId: "1098907670" },
  { id: "skill-point-forward-end", name: "向前指向-后摇", configId: "1098907671" },
  { id: "skill-plead-loop", name: "拜托-持续", configId: "1098907672" },
  { id: "skill-plead-end", name: "拜托-后摇", configId: "1098907673" },
  { id: "skill-salute-loop", name: "敬礼-持续", configId: "1098907674" },
  { id: "skill-salute-end", name: "敬礼-后摇", configId: "1098907675" },
  { id: "skill-handshake-loop", name: "握手-持续", configId: "1098907676" },
  { id: "skill-handshake-end", name: "握手-后摇", configId: "1098907678" },
  { id: "skill-shrugs-loop", name: "摊手-持续", configId: "1098907657" },
  { id: "skill-shrugs-end", name: "摊手-后摇", configId: "1098907658" },
  { id: "skill-shy-loop", name: "害羞-持续", configId: "1098907679" },
  { id: "skill-shy-end", name: "害羞-后摇", configId: "1098907680" },
  { id: "skill-think-loop", name: "思考-持续", configId: "1098907681" },
  { id: "skill-think-end", name: "思考-后摇", configId: "1098907682" },
  { id: "skill-whisper-loop", name: "耳语-持续", configId: "1098907683" },
  { id: "skill-whisper-end", name: "耳语-后摇", configId: "1098907684" },

  { id: "skill-walk-loop", name: "行走-持续", configId: "1098907695" },
{ id: "skill-walk-end", name: "行走-后摇", configId: "1098907698" },
{ id: "skill-run-loop", name: "跑步-持续", configId: "1098907696" },
{ id: "skill-run-end", name: "跑步-后摇", configId: "1098907699" },
{ id: "skill-sprint-loop", name: "冲刺-持续", configId: "1098907697" },
] as SkillAnimationPreset[],
  },
};
