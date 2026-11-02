# 对话编辑器：工作区配置与显示规则说明

当前已实现工作区目标设置、按文件类型过滤编辑器入口和预设分类，以及元件版新建工作区前的本机 GIL 参数校对。

第 1–4 节说明当前已实现的功能；第 5–10 节保留其他条目、字段和选项级过滤的扩展设计。目前两个发行版本使用相同的文件类型限制；技能动画和公共事件已按第 4.3–4.4 节接入单条预设的版本门槛。

文中的“冲刺”限制仅用于演示写法，不代表它实际只能用于某种类型或版本。

## 1. 三种配置分别负责什么

| 配置 | 保存内容 | 放在哪里 |
| --- | --- | --- |
| 版本目录 | 版本 ID、先后顺序、原神版本、模版版本、内部版本 | 代码中的统一配置表 `components/templateReleases.ts` |
| 工作区配置 | 当前工作区选择的文件类型和版本 ID | 工作区目录中的 `WorkspaceSettings.json` |
| 功能入口适用条件 | 编辑器入口、预设分类在哪些文件类型中显示 | `components/workspaceFeatures.ts` 的 `workspaceFeatureRules` |
| 条目的适用条件 | 单个条目、字段或选项在哪些文件类型、版本中显示 | 技能动画和公共事件在 `systemPresetConfig.ts` 的系统定义对象上配置 `applicability`；其他类别按需扩展 |

工作区保存选中的目标配置；界面从共享的响应式设置读取目标。以后需要更细的过滤时，再为条目声明适用范围。

## 2. 文件类型使用整数

固定映射如下，发布后不改号、不复用编号。

| 整数 | 代码名称 | 显示名称 |
| --- | --- | --- |
| 0 | `BeyondMap` | 超限模式地图版 |
| 1 | `BeyondComponent` | 超限模式元件版 |
| 2 | `ClassicComponent` | 经典模式元件版 |

```ts
enum WorkspaceFileType {
  BeyondMap = 0,
  BeyondComponent = 1,
  ClassicComponent = 2,
}
```

代码定义中可以使用枚举名称，也可以直接使用整数；保存到 JSON 时使用整数。

`0` 是有效类型。读取默认值时使用 `??`，不要用 `||` 把 `0` 当作未填写。

## 3. 版本目录

每一条记录代表一个完整且固定的发行组合，三个版本号不能自由拼接。

```ts
interface TemplateRelease {
  id: number;
  order: number;
  gameVersion: string;
  templateVersion: string;
  internalVersion: string;
}

const templateReleases: TemplateRelease[] = [
  {
    id: 1,
    order: 1,
    gameVersion: "7.1",
    templateVersion: "2.0",
    internalVersion: "1.0.3",
  },
  {
    id: 2,
    order: 2,
    gameVersion: "7.2",
    templateVersion: "2.1",
    internalVersion: "1.0.4",
  },
];
```

对应的版本选择项为：

- ID 1：原神 v7.1，模版版本 v2.0，模版内部版本 v1.0.3。
- ID 2：原神 v7.2，模版版本 v2.1，模版内部版本 v1.0.4。

字段含义：

- `id`：稳定的记录编号，工作区和适用规则通过它引用版本。
- `order`：版本先后顺序，用于选择默认最新版本和比较版本范围。
- 三个版本号：用于描述发行组合和生成显示名称。

ID 和顺序分开保存，方便以后补录历史版本。不要通过 ID 大小、显示文字或三个版本号的字符串大小直接比较先后。

发行记录发布后保持固定。新增版本时新增记录；只有内部版本变化，也应新增完整记录。

## 4. 工作区配置

工作区保存的 `WorkspaceSettings.json`：

```json
{
  "kind": "DSFGWorkspaceSettings",
  "schemaVersion": 1,
  "fileType": 0,
  "templateReleaseId": 1
}
```

| 字段 | 含义 |
| --- | --- |
| `kind` | 标识这是工作区设置文件 |
| `schemaVersion` | 此配置文件的数据格式版本，与原神和演出模版版本无关 |
| `fileType` | 当前选择的一种文件类型，值为 0、1 或 2 |
| `templateReleaseId` | 当前选择的一条完整发行记录的整数 ID |

工作区名称沿用现有工作区标识，结构体 ID 沿用现有 `StructIds.json`；在同一个“工作区设置”页面统一展示和编辑。

创建与设置行为：

- 新建时填写名称，文件类型默认选择超限模式地图版（0），版本默认选当前目录中顺序最新的版本，目前为 ID 2。
- 旧工作区缺少目标配置时，默认使用 `fileType: 0`、`templateReleaseId: 1`。
- 每个工作区共用一组目标配置，对话、任务、镜头、场景、预设等模块读取同一份设置。
- 点击右侧三点按钮直接打开“工作区设置”，无需经过下拉菜单；页面名称替代原“设置结构体 ID”。
- 工作区设置整合名称、文件类型、演出模版版本和结构体 ID，删除工作区按钮也移入此处。
- 切换工作区后读取它自己的配置；保存目标配置后，界面按当前文件类型更新显示入口。

### 4.1 当前显示过滤

以下内容仅在超限模式地图版（`fileType: 0`）显示：

- 编辑器顶部的任务、场景入口。
- 预设中的任务样式、多语言文本管理、存档模块。
- 工作区设置中的任务、场景结构体 ID 分组。此处根据尚未保存的文件类型草稿即时更新。

两个元件版（`1`、`2`）均隐藏这些内容。切换工作区或保存文件类型后，若当前正在编辑任务或场景，则返回对话；预设当前分类不再可用时返回公共事件。隐藏不会删除已有文件、预设或结构体 ID。结构体校验仅检查当前类型使用的分组，避免元件 ID 与未使用的地图默认 ID 重合时误报；切回地图版后恢复完整校验。

限制统一定义在 `components/workspaceFeatures.ts`。调用 `isWorkspaceFeatureAvailable(feature, target)` 判断入口，调用 `isWorkspaceStructGroupAvailable(group, target)` 判断结构体分组。底层 `isApplicable(rule, target)` 已支持文件类型与版本范围按“且”组合、多个版本区间按“或”组合，版本比较使用发行记录的 `order`。

### 4.2 元件版创建前校对

选择超限模式元件版或经典模式元件版后，必须导入 `.gil` 存档完成校对，才能点击创建。导入仅在本机解码，不上传或保存 GIL 原始存档。

- 复用 `gilSkillAnimations.ts`，校对结构体 ID 与系统技能动画配置 ID；缺失项保留默认值并列出提示。
- 完全没有适用匹配、存档无效或超过 100 MB 时不能创建；同名多候选必须先选择有效 ID。
- 改变文件类型或模版版本会使旧校对失效，需要重新导入；读取期间不允许创建。
- 创建时写入 `WorkspaceSettings.json`、`StructIds.json` 和 `SkillAnimationPresets.json` 后，再切换到新工作区。技能动画使用现有 `system-overrides` 存储格式，不修改系统名称和默认配置。
- 元件版不自动创建场景文件。初始化写入失败时，将本次创建的不完整工作区移入回收站，保留校对草稿供重试。

界面位于 `components/WorkspaceGilCalibration.vue`，读取与序列化逻辑位于 `components/workspaceGilCalibration.ts`。

### 4.3 技能动画的版本归属

已对比 `7.1.0 DSFG v1.0.3.1.gil` 与 `7.1.53 DSFG v1.0.4.gil` 的原生技能定义表（GIL `15/1`，类型 `6`）：技能模组从 42 个增加到 73 个，新增 31 个，原有模组没有删除或改名。经用户确认，新增技能全部归入发行 ID 2：原神 7.2、模版 2.1、内部版本 1.0.4。存档文件名中的 `7.1.53` 不用于判断发行归属。

配置统一在 `systemPresetConfig.skillAnimations.presets`，新增项声明：

```ts
applicability: {
  versionRanges: [{ min: { releaseId: 2, inclusive: true } }],
}
```

省略 `fileTypes`，三种工作区类型均适用；包含 ID 2 及其后续发行记录。原有系统项与自定义技能不增加版本限制。

系统技能显示名称统一追加首次归属版本：原有 37 项为 `名称（v7.1）`，新增 31 项为 `名称（v7.2）`。版本后缀随条目固定，不随当前工作区版本改变。原生 GIL 的名称不带该后缀；匹配系统项时兼容其不带后缀的原名，自定义技能仍按完整名称精确匹配。

以下名称省略共同的 `[演出]` 前缀；配置 ID 逐项取自 1.0.4 存档，不按编号补齐不存在的技能：

| 动画 | 持续配置 ID | 后摇配置 ID | 单段配置 ID |
| --- | --- | --- | --- |
| 受击倒地 | 1098907704 | 1098907706 | — |
| 叉腰站立_01 | 1098907707 | 1098907708 | — |
| 叉腰站立_02 | 1098907709 | 1098907710 | — |
| 交谈_02 | 1098907711 | 1098907713 | — |
| 鼓掌_01 | — | — | 1098907714 |
| 沉浸演奏_01 | — | — | 1098907715 |
| 拍打_01 | — | — | 1098907716 |
| 鼓励_01 | — | — | 1098907717 |
| 打招呼_01 | — | — | 1098907718 |
| 大笑_01 | — | — | 1098907719 |
| 点头_01 | — | — | 1098907720 |
| 点头_02 | — | — | 1098907721 |
| 拒绝_01 | — | — | 1098907722 |
| 摇头_01 | — | — | 1098907723 |
| 摇头_02 | — | — | 1098907724 |
| 坐姿交谈_01 | 1098907725 | 1098907727 | — |
| 坐姿消沉_01 | 1098907728 | 1098907729 | — |
| 坐姿抱臂_01 | 1098907730 | 1098907731 | — |
| 坐地上_01 | 1098907732 | — | — |
| 坐姿耸肩_01 | 1098907733 | 1098907734 | — |
| 坐姿思考_01 | 1098907735 | 1098907737 | — |
| 交谈_03 | — | — | 1098907738 |

原生存档的 42 / 73 是全部技能模组数量；编辑器的技能动画预设为 37 / 68，另有 5 个原有技能不属于本次新增动画清单，保持原有处理方式。

`isSkillAnimationApplicable()` 按系统稳定 ID 读取配置中的规则，再调用共享的 `isApplicable()`。`useSkillAnimationPresets()` 提供响应式 `visibleSystemPresets` 给预设卡片与词条浏览，`availablePresets` 给技能引用下拉；`presets`、`systemPresets` 保留完整数据用于保存、历史和 ID 导入。工作区文件不保存适用规则，用户覆盖配置 ID 后仍遵循系统规则。元件版创建前的 GIL 校对只匹配当前目标适用的动画，7.1 不列出这 31 项缺失提示。

切换版本仅更新可见列表，不清除已保存的系统覆盖、自定义项或已配置动作；切回 7.2 后恢复显示，不增加导出拦截。

### 4.4 公共事件的版本归属

原有 9 个系统公共事件的显示代号（`alias`）追加 `（v7.1）`，实际事件名（`name`）保持原值。新增系统项 `public-player-look-forward`，显示代号为 `玩家朝向实体（v7.2）`，事件名为 `NOLOC_PlayerLookForward`，适用规则复用包含发行 ID 2 的下界，不限制文件类型，即原神 7.2 / 模版 2.1 / 内部版本 1.0.4 起可选。

参数按截图顺序定义：

| 参数 | 类型 | 默认值 / 来源 | 显示条件 |
| --- | --- | --- | --- |
| 是否是朝向说话人 | Bool | `True`（是），手动填写 | 始终显示 |
| 实体获取方式 | Int32 | 空，引用 `entityGetMethods.value` | 朝向说话人为否 |
| GUID | Guid | 空，手动填写 | 朝向说话人为否，且实体获取方式为 0 |
| String | String | 空，手动填写 | 朝向说话人为否，且实体获取方式为 1 |

`isPublicEventApplicable()` 按稳定系统 ID 从中央配置读取规则；`usePublicEventPresets()` 的 `visibleSystemPresets` 用于预设卡片与词条，`availablePresets` 用于 Timeline 和公共事件名引用下拉。7.1 显示 9 个系统项，7.2 起显示 10 个。完整 `presets`、`systemPresets` 用于历史与保存，旧工作区事件名、参数覆盖和已有片段均保留；自定义项不增加版本限制。

版本代号只用于显示与搜索，不改变导出事件名。沿用公共事件的类型列表协议：Bool、Int32、Guid 各占对应列表第 0 项，String 参数占 `stringParams[1]`，事件名仍在 `stringParams[0]`；隐藏值保存在工程中，导出时按既有协议写入空值或零占位。

验证命令：`node scripts/test-dsfg-public-event-presets.cjs`、`node scripts/test-dsfg-public-event-visibility.cjs`、`node scripts/test-dsfg-preset-editor.cjs`。

## 5. applicability 的字段结构（后续设计）

`applicability` 可以理解成“显示适用条件”。它既能限制文件类型，也能限制版本范围。

```ts
interface VersionBound {
  releaseId: number;
  inclusive: boolean;
}

interface VersionRange {
  min?: VersionBound;
  max?: VersionBound;
}

interface Applicability {
  fileTypes?: WorkspaceFileType[];
  versionRanges?: VersionRange[];
}
```

字段含义：

- `fileTypes`：允许显示的文件类型列表。
- `versionRanges`：允许显示的版本区间列表，命中任意一个区间即可。
- `min`：区间下界，省略代表不限制下界。
- `max`：区间上界，省略代表不限制上界。
- `releaseId`：边界对应的发行记录 ID。
- `inclusive`：是否包含边界版本，必须明确填写 `true` 或 `false`。

组合规则：

1. 多个文件类型之间取“或”。
2. 多个版本区间之间取“或”。
3. 文件类型条件与版本条件之间取“且”。
4. 同一区间的下界和上界必须同时满足。
5. 省略 `fileTypes`，代表不限制文件类型。
6. 省略 `versionRanges`，代表不限制版本。
7. 完全省略 `applicability`，代表不增加适用限制。
8. 父条目隐藏时，内部字段和选项一起隐藏。

空数组、没有任何边界的区间、未知文件类型、未知版本 ID、上下界颠倒或排除所有边界的空区间，应作为开发者配置错误处理。需要不限制时直接省略对应条件。

## 6. option 是什么，保存在哪里（后续设计）

`option` 只是代码遍历时给“某一条选项对象”起的变量名，不需要为了显示判断额外保存一份选项。

项目现有的系统选项定义在：

`H:/Code/ugc-web/ugc-tools/src/views/DSFGStudio/components/EntityPresetEditor/systemPresetConfig.ts`

例如原本已有“冲刺”选项。以后可以直接在这个对象上新增适用条件：

```ts
{
  id: "movement-sprint",
  label: "冲刺",
  value: "2",

  applicability: {
    fileTypes: [0, 1],
    versionRanges: [
      {
        min: {
          releaseId: 2,
          inclusive: true,
        },
      },
    ],
  },
}
```

这条示例表示：两种超限类型，且从 ID 2 对应发行记录开始显示，包含该版本及其后续版本。

不要混淆以下字段：

| 字段 | 此例中的值 | 含义 |
| --- | --- | --- |
| `id` | `"movement-sprint"` | 标识这条选项本身 |
| `label` | `"冲刺"` | 界面显示文字 |
| `value` | `"2"` | 选中后使用的原有业务值，含义保持不变 |
| `applicability.fileTypes` | `[0, 1]` | 选项允许显示的文件类型 |
| `min.releaseId` | `2` | 版本范围下界引用的发行记录 ID |

选项的业务 `value` 与版本 ID 各自独立，碰巧都为 2 不代表二者有关联。

如果代码中将这个对象命名为 `option`，那么 `option.applicability` 就是在读取上面的适用条件对象。字段、条目也使用相同的 `applicability` 结构。

## 7. 常见规则写法（后续设计）

### 不增加限制

省略 `applicability` 字段即可。

### 仅超限模式地图版

```ts
applicability: {
  fileTypes: [0],
}
```

### 两种超限类型

```ts
applicability: {
  fileTypes: [0, 1],
}
```

### 从 ID 2 对应版本开始，包含该版本

```ts
applicability: {
  versionRanges: [
    { min: { releaseId: 2, inclusive: true } },
  ],
}
```

### 高于 ID 2 对应版本，不包含该版本

```ts
applicability: {
  versionRanges: [
    { min: { releaseId: 2, inclusive: false } },
  ],
}
```

该规则在目前只有两条发行记录时不会命中任何已发布版本，但后续新增更高顺序的发行记录后可命中。

### ID 2 对应版本之前，不包含该版本

```ts
applicability: {
  versionRanges: [
    { max: { releaseId: 2, inclusive: false } },
  ],
}
```

若需要“不高于该版本”，将这里的 `inclusive` 改为 `true`。

### 从 ID 1 到 ID 2，包含下界、不包含上界

```ts
applicability: {
  versionRanges: [
    {
      min: { releaseId: 1, inclusive: true },
      max: { releaseId: 2, inclusive: false },
    },
  ],
}
```

### 只允许 ID 1 或 ID 2 对应的两个特定发行版本

```ts
applicability: {
  versionRanges: [
    {
      min: { releaseId: 1, inclusive: true },
      max: { releaseId: 1, inclusive: true },
    },
    {
      min: { releaseId: 2, inclusive: true },
      max: { releaseId: 2, inclusive: true },
    },
  ],
}
```

多个区间取“或”，也就可以表达不连续的版本集合。这个例子不自动覆盖未来新增的版本。

## 8. 显示时如何使用（后续设计，当前不可直接调用）

### 常规情况：只维护配置

在系统条目、字段或选项定义上写好 `applicability`。统一的候选生成与显示入口负责判断，维护具体选项时不用额外声明 `option`，也不用每次传入工作区设置。

项目现有的下拉候选生成入口位于：

`H:/Code/ugc-web/ugc-tools/src/views/DSFGStudio/components/EntityPresetEditor/presetReferences.ts`

实现时在映射为下拉选项之前，统一过滤源条目。保持这份结果是响应式的，例如：

```ts
import { useWorkspaceApplicability } from "@/views/DSFGStudio/components/useWorkspaceSettings";

// 后续接入过滤时拟采用的接口；当前尚未提供 useWorkspaceApplicability。
const { isApplicable } = useWorkspaceApplicability();

const visibleOptions = computed(() =>
  availablePresets.value
    .filter(option => isApplicable(option.applicability))
    .map(option => ({
      label: option.label || option.value,
      value: option.value,
    })),
);
```

其中：

- `option` 由列表遍历自动传入，依次代表每个选项对象。
- `option.applicability` 是该选项自己的适用条件。
- `isApplicable()` 返回 `true` 表示适用，`false` 表示不适用。
- 没有配置条件时返回 `true`，但仍受父项状态及已有联动条件影响。
- `useWorkspaceApplicability()` 内部取得编辑器顶层提供的当前工作区响应式配置，对外只需要传规则。
- `computed()` 会跟踪工作区配置变化，修改目标后重新生成可见列表。

### 手写按钮、面板等情况

在组件初始化时取得一次判断函数：

```ts
const { isApplicable } = useWorkspaceApplicability();
```

模板中直接写条件：

```vue
<NButton v-if="isApplicable({ fileTypes: [0] })">
  仅地图版显示的功能
</NButton>
```

此处不用声明一个虚构的选项对象，也不用传入 `workspaceSettings.value`。配置驱动的选项列表由公共入口统一过滤，只有手写的页面条件才需要直接调用函数。

## 9. 与现有 visibleWhen 的关系（后续设计）

现有 `visibleWhen` 用于参数之间的联动，例如“设置位置为 true 时显示位置参数”。

新增 `applicability` 专门用于工作区文件类型和演出模版版本限制。两种条件同时存在时，必须同时满足才显示。

现有代码中部分 `visibleWhen` 逻辑也参与导出参数处理。新增的 `applicability` 应独立实现，不接入该导出过滤逻辑。

## 10. 数据保留与导出约定（后续过滤设计）

- 切换配置后，不适用的条目、字段和选项按规则隐藏，不增加降级提示。
- 隐藏不会删除已有条目、清空参数值或自动替换已选值。
- 切回适用配置后，应能继续使用原数据。
- 新增规则只控制显示，不增加导出拦截，也不因为规则不匹配剔除导出内容。
- 保存与导出继续遵循原有业务逻辑。

列表过滤与原始数据应分开处理，不能将“过滤后的可见列表”直接覆盖回原始存档。

## 11. 当前已接入的位置

以下路径相对 `src/views/DSFGStudio`：

1. `components/templateReleases.ts`：整数文件类型和统一版本目录。
2. `components/workspaceSettings.ts`：工作区目标配置的读写、兼容默认值及校验。
3. `components/useWorkspaceSettings.ts`：共享当前工作区的响应式配置，只提供 `useWorkspaceSettings()`。
4. `DSFGStudio.vue`：新建工作区选择类型和版本，加载、保存、重命名及删除工作区。
5. `components/WorkspaceStructIdSettings.vue`：工作区设置页面，保留 GIL 识别和结构体 ID 功能。

当前入口规则和纯判断函数集中在 `workspaceFeatures.ts`；共享目标通过 `useWorkspaceSettings()` 读取。技能动画和公共事件的单条候选已按第 4.3–4.4 节接入版本过滤，解码器仍只负责数据读取与校验。尚未提供前述示例中的 `useWorkspaceApplicability()`；其他类别、字段和选项按实际需求继续扩展。

读取当前工作区配置的方式：

```ts
import { useWorkspaceSettings } from "@/views/DSFGStudio/components/useWorkspaceSettings";

const workspaceSettings = useWorkspaceSettings();
// workspaceSettings.value.fileType
// workspaceSettings.value.templateReleaseId
```

验证命令：

```sh
node scripts/test-dsfg-workspace-settings.cjs
node scripts/test-dsfg-workspace-memory.cjs
node scripts/test-dsfg-workspace-struct-ids.cjs
node scripts/test-dsfg-skill-animation-releases.cjs
npm run type-check
```
