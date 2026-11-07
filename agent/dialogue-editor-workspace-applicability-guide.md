# 对话编辑器：工作区配置与显示规则说明

当前工作区只记录文件类型、基准版本和扩展包，不再保存或显示完整模版来源。已实现工作区目标设置、基准自带包锁定、按文件类型过滤编辑器入口，以及元件版新建工作区前的本机 GIL 参数校对。

当前基准 ID 1 对应原神 7.1 / 模版 2.0 / 内部 1.0.3，基准 ID 2 对应原神 7.2 / 模版 2.1 / 内部 1.0.4。扩展包 ID 1 为“7.2技能动画扩展包”，由基准 ID 2 自带；基准 ID 1 的自带包清单为空。每个扩展包就是一份固定内容，没有另外的包版本目录，也不根据包名称推断包含关系。

第 1–4 节说明当前实现；第 5–10 节保留其他条目、字段和选项级过滤的扩展设计。7.2 新增技能动画通过 `requiredPackageIds` 归属扩展包，公共事件通过 `baseVersionRanges` 使用基准门槛，其他参数和选项尚未全部接入。文中的“冲刺”仅演示规则写法。

## 1. 配置职责和目录

| 配置 | 保存内容 | 放在哪里 |
| --- | --- | --- |
| 基准目录 | 基准 ID、顺序、原神版本、模版版本、内部版本、自带包、适用文件类型 | `components/versioning/baseReleases.ts` |
| 扩展包目录 | 包 ID、名称、兼容基准、文件类型、依赖包 | `components/versioning/extensionPackages.ts` |
| 工作区配置 | 文件类型、实际基准、已安装包清单 | 工作区根目录 `WorkspaceSettings.json` |
| 功能入口规则 | 入口和预设分类适用哪些目标 | `components/workspaceFeatures.ts` |
| 单条预设规则 | 系统条目的基准范围和包要求 | `EntityPresetEditor/systemPresetConfig.ts` 的 `applicability` |

共享类型和显示名称格式在 `components/versioning/types.ts`。`catalog.ts` 查询基准和包、校验组合、合并自带包并生成目标签名，不依赖 Vue 或存储服务。原来的两份完整发行目录已移除，历史发行 ID 只在旧配置解码时使用固定迁移映射。

## 2. 文件类型使用整数

编号发布后不改号、不复用：

| 整数 | 代码名称 | 显示名称 |
| --- | --- | --- |
| 0 | `BeyondMap` | 超限模式地图版 |
| 1 | `BeyondComponent` | 超限模式元件版 |
| 2 | `ClassicComponent` | 经典模式元件版 |

`WorkspaceFileType`、`workspaceFileTypeOptions` 和 `isWorkspaceFileType()` 均从 `components/versioning/types.ts` 导入。`0` 是有效类型，读取默认值不能用 `||` 把它当作未填写。

## 3. 基准目录

```ts
interface BaseRelease {
  id: number;
  order: number;
  gameVersion: string;
  templateVersion: string;
  internalVersion: string;
  packageIds: readonly number[];
  fileTypes?: readonly WorkspaceFileType[];
}

const baseReleases: readonly BaseRelease[] = [
  {
    id: 1,
    order: 1,
    gameVersion: "7.1",
    templateVersion: "2.0",
    internalVersion: "1.0.3",
    packageIds: [],
  },
  {
    id: 2,
    order: 2,
    gameVersion: "7.2",
    templateVersion: "2.1",
    internalVersion: "1.0.4",
    packageIds: [1],
  },
];
```

三个版本字段独立保存，显示名称由 `formatReleaseLabel()` 统一生成。它们共同描述一条基准，工作区和适用规则通过稳定 ID 引用；范围比较使用 `order`，不比较名称、ID 大小或版本字符串。

基准的 `packageIds` 表示其固定自带包。选择基准后自动勾选、禁用取消，并标记“基准自带”。引用的包必须已在扩展包目录定义，且满足基准、文件类型和依赖校验。基准发布后保持固定，后续版本新增记录。

`legacyBaseReleaseId` 固定为 1，兼容缺少设置的旧工作区；`latestBaseReleaseId` 按 `order` 计算，仅用于新建工作区。

### 3.1 扩展包目录与基准引用

```ts
const extensionPackages: readonly ExtensionPackage[] = [
  { id: 1, name: "7.2技能动画扩展包" },
];
```

包 ID 与基准 ID 分属两个目录，各自保持稳定；基准 ID 2 的 `packageIds: [1]` 表示引用扩展包 ID 1。包名中的“7.2”只是名称的一部分，不存在额外的包版本字段。

- 原神 7.2 基准（ID 2）：自动启用该包，复选框标记“基准自带”，不可取消。
- 原神 7.1 基准（ID 1）：不自带该包，可按实际安装情况手动勾选。目前包未设置 `fileTypes`、`baseVersionRanges` 或依赖，三种文件类型均可选择。
- 7.2 新增的 31 个技能动画已接入该包：对应条目的 `applicability.requiredPackageIds: [1]` 统一控制卡片、引用候选和创建前 GIL 校对，详见第 4.3 节。7.1 勾选后可用，取消勾选后隐藏；7.2 通过基准自带包启用。

## 4. 工作区配置

当前保存格式为：

```json
{
  "kind": "DSFGWorkspaceSettings",
  "schemaVersion": 3,
  "fileType": 0,
  "baseReleaseId": 1,
  "packageIds": []
}
```

| 字段 | 含义 |
| --- | --- |
| `kind` | 工作区设置文件标识 |
| `schemaVersion` | 配置文件格式版本，与原神和模版版本分开 |
| `fileType` | 文件类型 0、1 或 2 |
| `baseReleaseId` | 当前实际使用的明确基准 ID；新建和设置界面均不提供“未配置基准”选项 |
| `packageIds` | 当前启用的包，包括基准自带包；同一包不可重复 |

新建和兼容规则：

- `createWorkspaceSettings()` 默认使用基准 1（模版 2.0），用于缺少设置的旧工作区和独立组件的兼容默认值。
- `createNewWorkspaceSettings()` 仅用于新建，默认使用最新基准，目前为基准 2（模版 2.1），并自动启用扩展包 ID 1。再次打开新建弹窗也重置为最新基准及其自带包。
- 格式 1 的 `templateReleaseId` 通过历史映射转换为基准 1 或 2；未知 ID 报错并保留原文件。
- 格式 2 优先保留已明确设置的基准及包。早期文件的基准为 `null` 且存在 `sourceTemplateReleaseId` 时，使用历史映射恢复基准；来源不影响已有明确基准。格式 3 不使用来源信息。
- 历史格式 2、3 的基准为 `null`，且无法按上述格式 2 来源恢复时，使用兼容基准 ID 1（模版 2.0）；保留已有包清单并校验兼容性。正常保存后写入明确基准 ID，不再保存空基准。
- 读取旧配置只在内存转换，不重写文件；正常保存时写格式 3，去掉全部来源字段。未知基准、未知包、损坏配置和不兼容组合不能被默认值覆盖。
- 可选包按工作区清单读取，不自动补选。基准自带包在读取和保存时确保启用，即使手动删去其 ID 也不能关闭。缺少包列表属于格式错误。
- 切换基准时，移除旧基准自带包，保留其余手动选择，再加入新基准自带包；共有包继续启用。保留的可选包若不兼容新基准，需调整后再保存。
- 每个工作区共用一份目标配置。设置页面统一编辑名称、文件类型、基准、扩展包和结构体 ID；包目录为空时显示“暂无可选扩展包”。草稿和异步校对持有独立包数组。
- 点击工作区右侧“…”直接打开设置。工作区名称、结构体 ID 和各编辑文件沿用原有存储位置。

### 4.1 当前显示过滤

以下内容仅在超限模式地图版（`fileType: 0`）显示：

- 顶部任务、场景入口。
- 预设中的任务样式、存档模块。
- 工作区设置中的任务、场景结构体 ID 分组。

多语言文本管理在地图版和两种元件版均可使用。

元件版（1、2）隐藏这些内容，但保留原有文件、预设和 ID。目标变化后，当前入口不再适用时返回对话；切回地图版恢复。结构体校验仅检查当前类型使用的分组。

适用规则统一由 `workspaceFeatures.ts` 的 `isApplicable(rule, target)` 判断：`fileTypes`、`baseVersionRanges`、`requiredPackageIds` 同时存在时取“且”；多个版本区间取“或”。包要求必须全部具备，基准自带包也计入。已移除旧的完整发行 `versionRanges`。

技能动画按实际启用的包判断，公共事件按实际基准判断，均不依赖曾经选择的来源。历史空基准配置按兼容规则恢复后，再按实际基准及其自带包判断。包目录可以声明 `baseVersionRanges`、`fileTypes` 和 `requiredPackageIds`；依赖不会被隐式安装。

### 4.2 元件版创建前校对

选择超限模式元件版或经典模式元件版后，需要导入 `.gil` 存档完成本机校对，才能创建工作区：

- 校对结构体 ID 与当前目标适用的系统技能动画 ID；缺失项保留默认值，同名多候选需先选择有效 ID。
- 无适用匹配、存档无效或超过 100 MB 时不能创建；不上传或保存 GIL 原始数据。
- 文件类型、基准或包集合变化后使旧校对失效；仅包顺序变化不影响校对。读取期间不能创建，过期异步结果不能覆盖新目标。
- 创建时保存工作区设置、结构体 ID 和技能 ID 覆盖，然后切换工作区。元件版不自动创建场景文件；初始化失败时将本次不完整工作区移入回收站，保留草稿重试。

界面位于 `components/WorkspaceGilCalibration.vue`，逻辑位于 `components/workspaceGilCalibration.ts`。校对只负责参数，不推断整个基准或扩展包已经安装。

### 4.3 技能动画的扩展包归属

已对比 `7.1.0 DSFG v1.0.3.1.gil` 与 `7.1.53 DSFG v1.0.4.gil` 的原生技能定义表（GIL `15/1`，类型 `6`）：技能模组从 42 个增加到 73 个，新增 31 个，原有模组没有删除或改名。新增技能全部归入扩展包 ID 1“7.2技能动画扩展包”。原神 7.2 / 模版 2.1 / 内部版本 1.0.4 的基准 ID 2 自带该包；原神 7.1 基准可手动启用。存档文件名中的 `7.1.53` 不用于判断包归属。

配置统一在 `systemPresetConfig.skillAnimations.presets`，新增项声明：

```ts
applicability: {
  requiredPackageIds: [1],
}
```

省略 `fileTypes` 和 `baseVersionRanges`，三种工作区类型均按包是否启用判断。7.1 不选包时显示原有 37 项，选包后显示 68 项；7.2 基准因自带包而显示 68 项。未来基准需通过自己的 `packageIds` 声明自带关系，不按版本号隐式启用。原有系统项与自定义技能不增加包要求。

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

`isSkillAnimationApplicable()` 按系统稳定 ID 读取配置中的规则，再调用共享的 `isApplicable()`。`useSkillAnimationPresets()` 提供响应式 `visibleSystemPresets` 给预设卡片与词条浏览，`availablePresets` 给技能引用下拉；`presets`、`systemPresets` 保留完整数据用于保存、历史和 ID 导入。工作区文件不保存适用规则，用户覆盖配置 ID 后仍遵循系统规则。元件版创建前的 GIL 校对只匹配当前目标适用的动画；7.1 未启用该包时不列出这 31 项，启用后按 68 项校对。

切换基准或扩展包仅更新可见列表，不清除已保存的系统覆盖、自定义项或已配置动作；重新启用包后恢复显示，不增加导出拦截。

### 4.4 公共事件的版本归属

原有 9 个系统公共事件的显示代号（`alias`）追加 `（v7.1）`，实际事件名（`name`）保持原值。新增系统项 `public-player-look-forward`，显示代号为 `玩家朝向实体（v7.2）`，事件名为 `NOLOC_PlayerLookForward`，适用规则复用包含基准 ID 2 的下界，不限制文件类型，即原神 7.2 / 模版 2.1 / 内部版本 1.0.4 起可选。

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
  baseVersionRanges?: VersionRange[];
}
```

字段含义：

- `fileTypes`：允许显示的文件类型列表。
- `baseVersionRanges`：允许显示的版本区间列表，命中任意一个区间即可。
- `min`：区间下界，省略代表不限制下界。
- `max`：区间上界，省略代表不限制上界。
- `releaseId`：边界对应的基准记录 ID。
- `inclusive`：是否包含边界版本，必须明确填写 `true` 或 `false`。

组合规则：

1. 多个文件类型之间取“或”。
2. 多个版本区间之间取“或”。
3. 文件类型条件与版本条件之间取“且”。
4. 同一区间的下界和上界必须同时满足。
5. 省略 `fileTypes`，代表不限制文件类型。
6. 省略 `baseVersionRanges`，代表不限制版本。
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
    baseVersionRanges: [
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

这条示例表示：两种超限类型，且从 ID 2 对应基准记录开始显示，包含该版本及其后续版本。

不要混淆以下字段：

| 字段 | 此例中的值 | 含义 |
| --- | --- | --- |
| `id` | `"movement-sprint"` | 标识这条选项本身 |
| `label` | `"冲刺"` | 界面显示文字 |
| `value` | `"2"` | 选中后使用的原有业务值，含义保持不变 |
| `applicability.fileTypes` | `[0, 1]` | 选项允许显示的文件类型 |
| `min.releaseId` | `2` | 版本范围下界引用的基准记录 ID |

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
  baseVersionRanges: [
    { min: { releaseId: 2, inclusive: true } },
  ],
}
```

### 高于 ID 2 对应版本，不包含该版本

```ts
applicability: {
  baseVersionRanges: [
    { min: { releaseId: 2, inclusive: false } },
  ],
}
```

该规则在目前只有两条基准记录时不会命中任何已发布版本，但后续新增更高顺序的基准记录后可命中。

### ID 2 对应版本之前，不包含该版本

```ts
applicability: {
  baseVersionRanges: [
    { max: { releaseId: 2, inclusive: false } },
  ],
}
```

若需要“不高于该版本”，将这里的 `inclusive` 改为 `true`。

### 从 ID 1 到 ID 2，包含下界、不包含上界

```ts
applicability: {
  baseVersionRanges: [
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
  baseVersionRanges: [
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

1. `components/versioning/types.ts`：整数文件类型和共享类型；`baseReleases.ts`、`extensionPackages.ts`：基准和包目录。
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
// workspaceSettings.value.baseReleaseId
// workspaceSettings.value.packageIds
```

验证命令：

```sh
node scripts/test-dsfg-workspace-settings.cjs
node scripts/test-dsfg-workspace-memory.cjs
node scripts/test-dsfg-workspace-struct-ids.cjs
node scripts/test-dsfg-skill-animation-releases.cjs
npm run type-check
```
