# Camera Clip（V2.0）

结构体来源：`src/assets/DSFGStudio`，与用户提供的「结构体导出/V2.0」对应。

在 Group Timeline 的 Camera Line 中添加 Clip，点击 Clip 编辑参数。一个 Camera
Line 可以有多个 Clip；每个 Clip 默认创建一个 `camera.shot` 组件。位置与旋转
分别维护自己的 Slot 列表，共用 `PositionSlot` 字段模板。

一个 Clip 只能新增一份 `camera.shot` 镜头参数，停用后也不能重复添加；删除后可重新添加。旧文件中的重复项会提示手动保留一份，不自动删除已有配置。多段镜头应在 Camera Line 上添加多个 Clip。

镜头使用专用「镜头设置」面板：时间和相机名置顶，相机位置／视点位置分页，类型按钮控制点位卡片与额外字段。相机位置必须配置；视点位置可选，新镜头默认不配置，勾选后可编辑。关闭视点保留原参数，以组件上的 `cameraViewpointEnabled: false` 保存；导出使用空的 RotationData（空 type、空 slot、snapToTarget=false），不写出该编辑标记。旧组件没有此标记时维持原有视点配置。线性移动默认仅配置终点，点位列表上方提供“添加起点（若不填写起点则获取当前位置）”；新增点位插入终点前，两个点位按起点、终点顺序导出，可交换或移除起点。坐标三轴横排。Components 及扩展字段收进「高级设置」。旧文件有多份镜头参数时编辑最后一份已启用项，并提示在高级设置中整理。

| 编辑器数据 | 千星结构体字段 |
| --- | --- |
| `clip.startTime` | Group 的 `Timer`；同一时间的 Clip 进入同一 ActionClip 列表 |
| `clip.duration` | `ActionClip.duration` 与 `CameraClip.duration` |
| `camera.shot.properties.cameraName` | `CameraClip.cameraName` |
| `camera.shot.properties.positionData` | `CameraClip.positionData` → PositionData |
| `camera.shot.properties.rotationData` | `CameraClip.rotationData` → RotationData |
| `positionData.slot` / `rotationData.slot` | PositionSlot 的 StructList，保留编辑顺序 |

`NOLOC_CAMERA` 的 `intParams[0]`（Int32List）引用 `CameraMovementData` 中的全局序号，`stringParams` 为空。
演出根结构中的 `CameraMovementData` 字典键使用 Int32。已同步 V2.0 新版演出与对话节点定义；对话的 `autoContinue` 在 Dialogue Clip 编辑区配置自动推进等待秒数，新建与旧工程缺失字段时默认 `-1`（不自动推进）。保存、导入与导出保留该值，导出为 Float。
Camera 数据仍按每 100 项拆分字典；位置和旋转 Slot 数量分别按类型限制。

字段及中文标签定义在 `cameraClip.ts`，注册入口在 `clipComponentRegistry.ts`。
通用 Clip 参数支持 `vector3`、`struct`、`struct-list`，并非 Camera 专用编辑控件。
结构体 ID 统一在工作区右侧「… → 设置结构体 ID」中编辑，保存至工作区根目录 `StructIds.json`，对所有对话文件生效，导出时递归替换。可读取 `.gil` 按结构体名称自动填入 ID，识别后点击保存应用。工程内原有 ID 仅保留为兼容元数据。

注意：

- 镜头名称通过工作区相机预设搜索选择，系统项为“默认镜头 / NOLOC_Default”，新建镜头的 `cameraName` 默认使用 `NOLOC_Default`，不再提供单独的名称输入框，高级设置也不重复显示该字段。选择后按原文写入 `cameraName`；删除或修改预设不会改写已配置的镜头。相机位置类型为 `NOLOC_Fixed`（固定位置，默认）、`NOLOC_Linear`（线性移动）、`NOLOC_Follow`（跟随）、`NOLOC_Orbit`（环绕）；视点位置类型为 `NOLOC_Fixed`（固定角度，默认）、`NOLOC_Linear`（线性移动）、`NOLOC_LookAt`（固定视点位置）。
- 视点 Slot 默认 1 个且不能删除最后一个。NOLOC_Fixed、NOLOC_LookAt 限定 1 个，NOLOC_Linear 允许 1～2 个；仅 NOLOC_LookAt 显示 `snapToTarget`。切换为单 Slot 类型时保留第一个点位，隐藏字段值保留；旧文件的超量点位读取时保留并提示。
- 位置 Slot 默认 1 个且不能删除最后一个。NOLOC_Fixed、NOLOC_Follow、NOLOC_Orbit 限定 1 个，NOLOC_Linear 允许 1～2 个；切换为单 Slot 模式时保留第一个点位。旧文件若有超量点位，读取时保留并在面板提示，可手动删除或切换模式规范数量。
- 相机位置的 NOLOC_Follow、视点位置的 NOLOC_LookAt 显示 `snapToTarget`（是否立即抵达目标）；仅 NOLOC_Orbit 显示 `orbitRotStart`（初始环绕角度）、`orbitRotEnd`（结束环绕角度）的三维输入和 `orbitRadius`。两个角度默认均为 `0,0,0`，切换时保留隐藏字段值。
- PositionData 按新版顺序导出：`type`、`slot`、`snapToTarget`、`orbitRotStart`、`orbitRotEnd`、`orbitRadius`。源 CameraClip 的内嵌 PositionData 仍为旧版五栏，项目副本已补齐结束角度，防止半径错位。旧项目缺失的新角度补默认值；旧 `orbitRot` 作为扩展草稿保留但不导出，不自动把它或 Slot.vector3 猜测转换为新角度。
- Slot 的坐标空间下拉为 `Local`（数值 0，默认）与 `World`（数值 1）。点位类型为 `NOLOC_Vector3`（默认）、`NOLOC_Guid`、`NOLOC_Entity`。相机位置与视点位置的点位为 NOLOC_Vector3 时均隐藏坐标空间；NOLOC_Guid / NOLOC_Entity 及视点 NOLOC_Rot 时显示。专用面板中点位类型在左、坐标空间在右；高级设置沿用相同显隐规则。隐藏不清空原值，保存和导出仍保留；任务调查点不受影响。
- 固定角度额外支持 `NOLOC_Rot`（旋转），共有四种点位类型。选择后显示旋转 XYZ；仍保存并导出到 PositionSlot 的 `vector3` 字段。相机位置不提供此选项。
- 视点的线性移动和固定视点位置不提供 `NOLOC_Rot`，专用面板与高级设置一致。主动切换到这两种模式时，旋转点位改为 `NOLOC_Vector3`，已有向量和目标字段保留；只读取旧文件不重置点位数据，受限类型提示重新选择。
- NOLOC_Vector3 点位只显示位置向量；NOLOC_Guid / NOLOC_Entity 点位显示对应目标字段以及挂接点、offset、requiresClientPos。NOLOC_Orbit 同样遵循点位类型，Slot.vector3 不再用于初始环绕角度。显隐由模板 `visibleWhen` 定义，切换时保留隐藏字段的原值，导出仍按完整结构体顺序写入。
- 旧相机的已知模式和点位类型在工程读取、运行时导入及导出时升级为对应 `NOLOC_` 值，保留点位顺序、GUID 和扩展字段。已保存的空值或未知枚举不会被覆盖，下拉会提示重新选择。业务默认由组件模板提供，不改动源结构体 JSON。
- `guid` 用整数字符串保存；`entity` 在 V2.0 中是 String，不是 Entity ID 类型。
- Vector3 用 `"x,y,z"` 保存，面板提供 X/Y/Z 独立输入框。
- 新建镜头的位置和旋转 Slot 各为一个独立的默认 Vector3 点位，orbitRadius 为 0。独立 PositionData 文件中的半径 2 不覆盖该默认。
- V2.0 不再导出旧版 `delay`、起止坐标等扁平字段。已有组件的旧扩展属性仍保存在工程里，但不会猜测转换为新的 Slot。
