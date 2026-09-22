# 流程出口导出

ActionClip 已同步 V2.0 新定义，字段顺序为 `actionType`、`duration`、`stringParams`、`intParams`、`guidParams`、`configParams`、`prefabParams`。新增三个列表的类型分别为 `GuidList`、`ConfigReferenceList`、`EntityReferenceList`；现有动作未使用它们时按空列表导出，原有参数含义保持不变。ActionGroup 内嵌的默认 ActionClip 同步为七个字段。

普通 Group 与条件分支节点都会生成一个 ActionGroup，并共用 `groupOrder` 中的全局编号。
从开始节点出发，按节点出口从上到下的顺序遍历；条件节点可以作为编号 0。
ActionGroup 表仍按每 100 项拆成一个字典项，NextGroup 保存的是全局编号，不是块内编号。

条件节点生成一个在 0 秒触发的 ActionClip：

| 字段 | 值 |
| --- | --- |
| actionType | `NOLOC_BRANCH` |
| duration | `0.00` |
| stringParams | `outputs.map(output => output.condition)`，保留空字符串和原文 |
| intParams | 空列表 |
| ActionGroup.NextGroup | 每个出口所连接节点的全局序号，未连接则为 `-1` |

NextGroup 的槽位规则对条件分支、选项卡及普通对话出口一致：

- 一出口一槽位，按界面从上到下的顺序；不能过滤空位或合并重复目标。
- 第 1、3 个出口连接到全局编号 4、8，第 2 个出口空着，导出为 `[4, -1, 8]`。
- 多个出口连接到同一节点时保留重复序号，例如 `[4, 4, -1]`。
- 单个未连接的对话出口导出为 `[-1]`；零出口节点导出为 `[]` 并给出无出口警告。
- 陈旧连线指向已不存在/不可导出的节点时，该槽位同样为 `-1`。
- NextGroup 与表达式都是普通列表，因此单节点最多导出 100 个出口；超出时明确报错，不截断。

条件仍作为字符串保存和导出。文本编辑支持变量／固定值比较、且／或及括号组的可视化搭建，生成 `Lib/Expression.lua` 支持的 `{1:ps.变量}`、`{1:as.变量}`、`{1:lv.变量}`、比较符、`&&` 和 `||`。支持的旧表达式可解析为控件，复杂运算和动态占位符保留原文模式，打开或取消不改写原条件；网页不执行表达式。运行时标识定义在
`qxqyActionRegistry.ts` 的 `CONDITION_BRANCH_ACTION_TYPE` 中。

## Focus Push（强制跳过）

固定 Focus Push 行最多保存一个 Clip，拖动 Clip 设置触发时间。点击后可以选择输出方式，旧工程默认使用独立出口。

- 独立出口：节点图增加一个 `focus-push` 出口，可与 Dialogue 或 Select 出口并存。目标写入 `NextGroup` 的新增槽位，`intParams[0]` 指向这个槽位，`stringParams[0] = NOLOC_Self`。
- 共用出口：不增加节点图出口或 `NextGroup` 槽位。参数下拉框显示现有出口的零基序号和玩家按下 / 选项文本，`intParams[0]` 保存所选序号，`stringParams[0] = NOLOC_Shared`。不存在可用出口或序号越界时提示重新选择并阻止导出。

两种模式都导出为 `NOLOC_FOCUSPUSH`，`Timer` 保存触发时间，`duration` 为 0。未连接的出口槽位保留 `-1`。重复目标不会合并：两个独立出口都指向节点 1 时，`NextGroup = [1, 1]`，若 Focus Push 是第二个出口，则 `intParams[0] = 1`。共用第一个出口时则只保留 `NextGroup = [1]`，`intParams[0] = 0`。

## Player Skill（玩家技能）

「预设设置 → 预设技能动画」可管理动画名及对应技能配置 ID，自动保存到当前工作区的 `SkillAnimationPresets.json`。Timeline 的 Player Skill 片段参数面板支持按动画名或 ID 搜索预设，选择后将有效的非负 Int32 ID 复制到 `player.skill.properties.skillConfigId`，仍可手动输入 ID。预设修改、删除不回写已有片段，导出协议不变。未命名或 ID 未填完的草稿保留保存，但不进入选择列表。

通过新增 Line 选择 Player Skill，可放置多个 Clip；每个 Clip 输入一个非负 Int32 技能配置 ID。ActionType 按协议拼写为 `NOLOC_PLYAERSKILL`，`intParams[0]` 保存 `PlayerSkillData` 的全局序号，`stringParams` 为空，触发时间沿用时间轴设置，持续时间固定为 0。

`PlayerSkillData` 使用 `Int32 → ConfigReferenceList` 字典，每 100 项一块：键 0 对应序号 0–99，键 1 对应 100–199，依此类推；重复技能 ID 保留各自槽位。新版演出字段名为 `DialogueData` 和 `CameraMovementData`。

## Custom（自定义触发）

Custom Clip 使用单行输入框填写字符串，时间轴 Clip 标题直接显示该字符串，导出 `NOLOC_TRIGGERCUSTOME`，原样写入 `stringParams[0]`，`intParams` 为空，不引用外部数据表。输入不支持换行，支持空字符串和空格；仅设置触发时间，持续时间固定为 0。编辑数据沿用 `custom.data.properties.value`，可读取旧 Clip 的值。

## Public Event（公共事件）

Public Event Line 支持多个可设置持续时间的 Clip，默认 1 秒，允许 0 秒，旧文件的 0 秒保持不变。面板持续时间和 Timeline 片段长度共用 clip.duration，参与时间轴结束时间计算，导出 `NOLOC_TRIGGERPUBLIC` 的 `duration` 使用该值。预设定义事件名和带名称、类型、默认值的参数，Clip 内填写每个参数。事件名占 `stringParams[0]`，字符串参数从第 1 项开始；Int32、Guid、ConfigReference、EntityReference 分别写入 `intParams`、`guidParams`、`configParams`、`prefabParams`，各自从第 0 项开始。每个列表上限 100 项，因此最多 99 个字符串参数。
