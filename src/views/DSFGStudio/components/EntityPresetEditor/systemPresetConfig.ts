import type { CustomPresetTable } from "./customPresets";
import type { SystemPublicEventPreset, PublicEventParameter } from "./publicEventPresets";
import type { EntityPreset } from "./entityPresets";
import type { SystemSkillAnimationPreset } from "./skillAnimationPresets";
import type { SaveModule, SaveModuleField } from "./saveModules";
import type { StyleParameter } from "./styleParameters";
import type { Applicability } from "../workspaceFeatures";

const sinceBaseRelease2: Applicability = { baseVersionRanges: [{ min: { releaseId: 2, inclusive: true } }] };
const requiresSkillAnimation72Package: Applicability = { requiredPackageIds: [1] };

/**
 * 所有预设的系统默认配置统一在这里修改。
 * newItem：新建条目的字段默认值；presets：代号固定、不可删除的系统默认条目，值可由工作区覆盖。
 * 实体获取方式等固定协议选项保持只读。
 * 内置条目必须使用稳定、唯一的 id。未提供真实条目时保持空列表，不虚构技能 ID。
 */
export const systemPresetConfig = {
  styleParameters: {
    newParameter: { name: "", type: "Int32" as const, defaultValue: "0" },
  },
  entityGetMethods: {
    newItem: { label: "", value: "" },
    presets: [
      { id: "entity-get-guid", label: "GUID", value: "0" },
      { id: "entity-get-string", label: "String", value: "1" },
    ],
  },
  movementMethods: {
    newItem: { label: "", value: "" },
    presets: [
      { id: "movement-walk", label: "行走", value: "0" },
      { id: "movement-run", label: "跑步", value: "1" },
      { id: "movement-sprint", label: "冲刺", value: "2" },
    ],
  },
  customTables: {
    newItem: { name: "", fields: [], records: [] },
    newField: { name: "", type: "String" as const },
    newRecord: { name: "", values: {} },
    presets: [] as CustomPresetTable[],
  },
  saveModules: {
    newItem: { name: "", fields: [] as SaveModuleField[] },
    newField: { name: "", startBit: 0, length: 1, min: "0", max: "1" },
    presets: [] as SaveModule[],
  },
  cameras: {
    newItem: { label: "", value: "" },
    presets: [{ id: "camera-default", label: "默认镜头", value: "NOLOC_Default" }],
  },
  dialogueStyles: {
    newItem: { label: "", value: "", showTitle: false, parameters: [] as StyleParameter[] },
    presets: [
      { id: "dialogue-default", label: "默认样式", value: "NOLOC_Default", showTitle: true, parameters: [] as StyleParameter[] },
      { id: "dialogue-black-screen", label: "黑幕对话", value: "NOLOC_BlackScreen", showTitle: false, parameters: [] as StyleParameter[] },
      { id: "dialogue-bottom-cg", label: "底部CG文本", value: "NOLOC_BottomCG", showTitle: false, parameters: [] as StyleParameter[] },
      { id: "dialogue-bottom-dialog", label: "底部对话文本", value: "NOLOC_BottomDialog", showTitle: true, parameters: [] as StyleParameter[] },
      { id: "dialogue-clear", label: "清除效果", value: "NOLOC_Clear", showTitle: false, parameters: [] as StyleParameter[] },
    ],
  },
  selectStyles: {
    newItem: { label: "", value: "", parameters: [] as StyleParameter[] },
    presets: [{ id: "select-default", label: "默认样式", value: "Default_UI", parameters: [] as StyleParameter[] }],
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
    newItem: { alias: "", name: "", requiresDuration: false, parameters: [] as PublicEventParameter[] },
    newParameter: { name: "", type: "String" as const, defaultValue: "" },
    parameterDefaultValues: { Bool: "False" },
    presets: [{
      id: "public-player-skill",
      alias: "玩家播放技能动画（v7.1）",
      name: "NOLOC_PlayerSkill",
      requiresDuration: false,
      parameters: [{
        id: "public-player-skill-config-id",
        name: "技能配置 ID",
        type: "ConfigReference",
        reference: "skillAnimations.configId",
        defaultValue: "",
      }],
    }, {
      id: "public-player-teleport",
      alias: "玩家传送（v7.1）",
      name: "NOLOC_PlayerTeleport",
      requiresDuration: false,
      parameters: [
        { id: "public-player-teleport-set-position", name: "设置位置", type: "Bool", defaultValue: "False" },
        { id: "public-player-teleport-position-x", name: "位置 X", type: "Float", defaultValue: "0", visibleWhen: [{ parameterId: "public-player-teleport-set-position", equals: "True" }] },
        { id: "public-player-teleport-position-y", name: "位置 Y", type: "Float", defaultValue: "0", visibleWhen: [{ parameterId: "public-player-teleport-set-position", equals: "True" }] },
        { id: "public-player-teleport-position-z", name: "位置 Z", type: "Float", defaultValue: "0", visibleWhen: [{ parameterId: "public-player-teleport-set-position", equals: "True" }] },
        { id: "public-player-teleport-set-rotation", name: "设置旋转", type: "Bool", defaultValue: "False" },
        { id: "public-player-teleport-rotation-y", name: "旋转 Y", type: "Float", defaultValue: "0", visibleWhen: [{ parameterId: "public-player-teleport-set-rotation", equals: "True" }] },
      ],
    }, {
      id: "public-player-move-to-point",
      alias: "玩家移动到指定位置（v7.1）",
      name: "NOLOC_PlayerMoveToPoint",
      requiresDuration: false,
      parameters: [
        { id: "public-player-move-to-point-method", name: "方式", type: "Int32", reference: "movementMethods.value", defaultValue: "0" },
        { id: "public-player-move-to-point-x", name: "X轴", type: "Float", defaultValue: "0" },
        { id: "public-player-move-to-point-z", name: "Z轴", type: "Float", defaultValue: "0" },
      ],
    }, {
      id: "public-simple-black-screen",
      alias: "播放简单黑幕（v7.1）",
      name: "NOLOC_SimpleBlackScreen",
      requiresDuration: false,
      parameters: [
        { id: "public-simple-black-screen-color", name: "颜色（#RRGGBB 或 #RRGGBBAA）", type: "String", defaultValue: "#000000FF" },
        { id: "public-simple-black-screen-transition", name: "过渡时间", type: "Float", defaultValue: "0.5" },
        { id: "public-simple-black-screen-hold", name: "持续时间", type: "Float", defaultValue: "1" },
        { id: "public-simple-black-screen-fade-out", name: "淡出时间", type: "Float", defaultValue: "0.5" },
      ],
    }, {
      id: "public-lock-and-play-bgm",
      alias: "锁定并播放BGM（v7.1）",
      name: "NOLOC_LockAndPlayBGM",
      requiresDuration: false,
      parameters: [
        { id: "public-lock-and-play-bgm-index", name: "背景音乐索引", type: "Int32", defaultValue: "" },
        { id: "public-lock-and-play-bgm-start-time-1", name: "开始时间", type: "Float", defaultValue: "0" },
        { id: "public-lock-and-play-bgm-start-time-2", name: "结束时间", type: "Float", defaultValue: "999" },
        { id: "public-lock-and-play-bgm-speed", name: "播放速度", type: "Float", defaultValue: "1" },
      ],
    }, {
      id: "public-unlock-bgm",
      alias: "解锁BGM（v7.1）",
      name: "NOLOC_UnlockBGM",
      requiresDuration: false,
      parameters: [],
    }, {
      id: "public-camera-lerp-to-npc",
      alias: "演出注目实体（v7.1）",
      name: "NOLOC_CameraLerpToNPC",
      requiresDuration: false,
      parameters: [],
    }, {
      id: "public-reset-camera",
      alias: "重置镜头（v7.1）",
      name: "NOLOC_ResetCamera",
      requiresDuration: false,
      parameters: [{
        id: "public-reset-camera-immediate",
        name: "是否立即到达",
        type: "Bool",
        defaultValue: "False",
      }],
    }, {
      id: "public-set-object-entity-forward",
      alias: "触发实体朝向（仅物件）（v7.1）",
      name: "NOLOC_SetObjectEntityFoward",
      requiresDuration: false,
      parameters: [
        { id: "object-forward-boolean", name: "设置朝向（否＝重置）", type: "Bool", defaultValue: "False" },
        { id: "object-forward-method-1", name: "实体1获取方式", type: "Int32", reference: "entityGetMethods.value", defaultValue: "" },
        { id: "object-forward-guid-1", name: "实体1 GUID", type: "Guid", reference: "entities.guid", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-method-1", equals: "0" }] },
        { id: "object-forward-string-1", name: "实体1 String", type: "String", reference: "entities.entityQuery", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-method-1", equals: "1" }] },
        { id: "object-forward-method-2", name: "实体2获取方式", type: "Int32", reference: "entityGetMethods.value", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-boolean", equals: "True" }] },
        { id: "object-forward-guid-2", name: "实体2 GUID", type: "Guid", reference: "entities.guid", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-boolean", equals: "True" }, { parameterId: "object-forward-method-2", equals: "0" }] },
        { id: "object-forward-string-2", name: "实体2 String", type: "String", reference: "entities.entityQuery", defaultValue: "", visibleWhen: [{ parameterId: "object-forward-boolean", equals: "True" }, { parameterId: "object-forward-method-2", equals: "1" }] },
      ],
    }, {
      id: "public-player-look-forward",
      alias: "玩家朝向实体（v7.2）",
      name: "NOLOC_PlayerLookForward",
      requiresDuration: false,
      applicability: sinceBaseRelease2,
      parameters: [
        { id: "public-player-look-forward-talker", name: "是否是朝向说话人", type: "Bool", defaultValue: "True" },
        { id: "public-player-look-forward-method", name: "实体获取方式", type: "Int32", reference: "entityGetMethods.value", defaultValue: "",
          visibleWhen: [{ parameterId: "public-player-look-forward-talker", equals: "False" }] },
        { id: "public-player-look-forward-guid", name: "GUID", type: "Guid", defaultValue: "",
          visibleWhen: [{ parameterId: "public-player-look-forward-method", equals: "0" }, { parameterId: "public-player-look-forward-talker", equals: "False" }] },
        { id: "public-player-look-forward-string", name: "String", type: "String", defaultValue: "",
          visibleWhen: [{ parameterId: "public-player-look-forward-method", equals: "1" }, { parameterId: "public-player-look-forward-talker", equals: "False" }] },
      ],
    }] as SystemPublicEventPreset[],
  },
  skillAnimations: {
    newItem: { name: "", configId: "" },
   presets: [
  { id: "skill-afraid-loop", name: "恐惧-持续（v7.1）", configId: "1098907659" },
  { id: "skill-afraid-end", name: "恐惧-后摇（v7.1）", configId: "1098907660" },
  { id: "skill-vigilance-loop", name: "警觉-持续（v7.1）", configId: "1098907662" },
  { id: "skill-vigilance-end", name: "警觉-后摇（v7.1）", configId: "1098907663" },
  { id: "skill-talk-loop", name: "交谈-持续（v7.1）", configId: "1098907649" },
  { id: "skill-talk-end", name: "交谈-后摇（v7.1）", configId: "1098907651" },
  { id: "skill-celebrate-loop", name: "庆祝-持续（v7.1）", configId: "1098907664" },
  { id: "skill-celebrate-end", name: "庆祝-后摇（v7.1）", configId: "1098907665" },
  { id: "skill-confuse-loop", name: "困惑-持续（v7.1）", configId: "1098907655" },
  { id: "skill-confuse-end", name: "困惑-后摇（v7.1）", configId: "1098907656" },
  { id: "skill-depressed-loop", name: "消沉-持续（v7.1）", configId: "1098907666" },
  { id: "skill-depressed-end", name: "消沉-后摇（v7.1）", configId: "1098907667" },
  { id: "skill-arms-crossed-loop", name: "抱胸-持续（v7.1）", configId: "1098907652" },
  { id: "skill-arms-crossed-end", name: "抱胸-后摇（v7.1）", configId: "1098907654" },
  { id: "skill-facepalm-loop", name: "扶额-持续（v7.1）", configId: "1098907668" },
  { id: "skill-facepalm-end", name: "扶额-后摇（v7.1）", configId: "1098907669" },
  { id: "skill-point-forward-loop", name: "向前指向-持续（v7.1）", configId: "1098907670" },
  { id: "skill-point-forward-end", name: "向前指向-后摇（v7.1）", configId: "1098907671" },
  { id: "skill-plead-loop", name: "拜托-持续（v7.1）", configId: "1098907672" },
  { id: "skill-plead-end", name: "拜托-后摇（v7.1）", configId: "1098907673" },
  { id: "skill-salute-loop", name: "敬礼-持续（v7.1）", configId: "1098907674" },
  { id: "skill-salute-end", name: "敬礼-后摇（v7.1）", configId: "1098907675" },
  { id: "skill-handshake-loop", name: "握手-持续（v7.1）", configId: "1098907676" },
  { id: "skill-handshake-end", name: "握手-后摇（v7.1）", configId: "1098907678" },
  { id: "skill-shrugs-loop", name: "摊手-持续（v7.1）", configId: "1098907657" },
  { id: "skill-shrugs-end", name: "摊手-后摇（v7.1）", configId: "1098907658" },
  { id: "skill-shy-loop", name: "害羞-持续（v7.1）", configId: "1098907679" },
  { id: "skill-shy-end", name: "害羞-后摇（v7.1）", configId: "1098907680" },
  { id: "skill-think-loop", name: "思考-持续（v7.1）", configId: "1098907681" },
  { id: "skill-think-end", name: "思考-后摇（v7.1）", configId: "1098907682" },
  { id: "skill-whisper-loop", name: "耳语-持续（v7.1）", configId: "1098907683" },
  { id: "skill-whisper-end", name: "耳语-后摇（v7.1）", configId: "1098907684" },

  { id: "skill-walk-loop", name: "行走-持续（v7.1）", configId: "1098907695" },
{ id: "skill-walk-end", name: "行走-后摇（v7.1）", configId: "1098907698" },
{ id: "skill-run-loop", name: "跑步-持续（v7.1）", configId: "1098907696" },
{ id: "skill-run-end", name: "跑步-后摇（v7.1）", configId: "1098907699" },
{ id: "skill-sprint-loop", name: "冲刺-持续（v7.1）", configId: "1098907697" },
  // Added in DSFG 1.0.4 (Genshin 7.2 / template 2.1); IDs verified against the source GIL.
  { id: "skill-knocked-down-loop", name: "受击倒地-持续（v7.2）", configId: "1098907704", applicability: requiresSkillAnimation72Package },
  { id: "skill-knocked-down-end", name: "受击倒地-后摇（v7.2）", configId: "1098907706", applicability: requiresSkillAnimation72Package },
  { id: "skill-hands-on-hips-01-loop", name: "叉腰站立_01-持续（v7.2）", configId: "1098907707", applicability: requiresSkillAnimation72Package },
  { id: "skill-hands-on-hips-01-end", name: "叉腰站立_01-后摇（v7.2）", configId: "1098907708", applicability: requiresSkillAnimation72Package },
  { id: "skill-hands-on-hips-02-loop", name: "叉腰站立_02-持续（v7.2）", configId: "1098907709", applicability: requiresSkillAnimation72Package },
  { id: "skill-hands-on-hips-02-end", name: "叉腰站立_02-后摇（v7.2）", configId: "1098907710", applicability: requiresSkillAnimation72Package },
  { id: "skill-talk-02-loop", name: "交谈_02-持续（v7.2）", configId: "1098907711", applicability: requiresSkillAnimation72Package },
  { id: "skill-talk-02-end", name: "交谈_02-后摇（v7.2）", configId: "1098907713", applicability: requiresSkillAnimation72Package },
  { id: "skill-clap-01-single", name: "鼓掌_01-单段（v7.2）", configId: "1098907714", applicability: requiresSkillAnimation72Package },
  { id: "skill-immersed-performance-01-single", name: "沉浸演奏_01-单段（v7.2）", configId: "1098907715", applicability: requiresSkillAnimation72Package },
  { id: "skill-pat-01-single", name: "拍打_01-单段（v7.2）", configId: "1098907716", applicability: requiresSkillAnimation72Package },
  { id: "skill-encourage-01-single", name: "鼓励_01-单段（v7.2）", configId: "1098907717", applicability: requiresSkillAnimation72Package },
  { id: "skill-greet-01-single", name: "打招呼_01-单段（v7.2）", configId: "1098907718", applicability: requiresSkillAnimation72Package },
  { id: "skill-laugh-01-single", name: "大笑_01-单段（v7.2）", configId: "1098907719", applicability: requiresSkillAnimation72Package },
  { id: "skill-nod-01-single", name: "点头_01-单段（v7.2）", configId: "1098907720", applicability: requiresSkillAnimation72Package },
  { id: "skill-nod-02-single", name: "点头_02-单段（v7.2）", configId: "1098907721", applicability: requiresSkillAnimation72Package },
  { id: "skill-refuse-01-single", name: "拒绝_01-单段（v7.2）", configId: "1098907722", applicability: requiresSkillAnimation72Package },
  { id: "skill-shake-head-01-single", name: "摇头_01-单段（v7.2）", configId: "1098907723", applicability: requiresSkillAnimation72Package },
  { id: "skill-shake-head-02-single", name: "摇头_02-单段（v7.2）", configId: "1098907724", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-talk-01-loop", name: "坐姿交谈_01-持续（v7.2）", configId: "1098907725", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-talk-01-end", name: "坐姿交谈_01-后摇（v7.2）", configId: "1098907727", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-depressed-01-loop", name: "坐姿消沉_01-持续（v7.2）", configId: "1098907728", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-depressed-01-end", name: "坐姿消沉_01-后摇（v7.2）", configId: "1098907729", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-arms-crossed-01-loop", name: "坐姿抱臂_01-持续（v7.2）", configId: "1098907730", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-arms-crossed-01-end", name: "坐姿抱臂_01-后摇（v7.2）", configId: "1098907731", applicability: requiresSkillAnimation72Package },
  { id: "skill-sit-on-ground-01-loop", name: "坐地上_01-持续（v7.2）", configId: "1098907732", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-shrug-01-loop", name: "坐姿耸肩_01-持续（v7.2）", configId: "1098907733", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-shrug-01-end", name: "坐姿耸肩_01-后摇（v7.2）", configId: "1098907734", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-think-01-loop", name: "坐姿思考_01-持续（v7.2）", configId: "1098907735", applicability: requiresSkillAnimation72Package },
  { id: "skill-seated-think-01-end", name: "坐姿思考_01-后摇（v7.2）", configId: "1098907737", applicability: requiresSkillAnimation72Package },
  { id: "skill-talk-03-single", name: "交谈_03-单段（v7.2）", configId: "1098907738", applicability: requiresSkillAnimation72Package },
] as SystemSkillAnimationPreset[],
  },
};
