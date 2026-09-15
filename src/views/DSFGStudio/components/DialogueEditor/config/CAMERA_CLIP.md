# Camera Clip（V2.0）

结构体来源：`src/assets/DSFGStudio`，与用户提供的「结构体导出/V2.0」对应。

在 Group Timeline 的 Camera Line 中添加 Clip，点击 Clip 编辑参数。一个 Camera
Line 可以有多个 Clip；每个 Clip 默认创建一个 `camera.shot` 组件。位置与旋转
分别维护自己的 Slot 列表，共用 `PositionSlot` 字段模板。

一个 Clip 只能新增一份 `camera.shot` 镜头参数，停用后也不能重复添加；删除后可重新添加。旧文件中的重复项会提示手动保留一份，不自动删除已有配置。多段镜头应在 Camera Line 上添加多个 Clip。

镜头使用专用「镜头设置」面板：时间和相机名置顶，相机位置／视点位置分页，类型按钮控制点位卡片与额外字段。相机位置必须配置；视点位置可选，新镜头默认不配置，勾选后可编辑。关闭视点保留原参数，以组件上的 `cameraViewpointEnabled: false` 保存；导出使用空的 RotationData（空 type、空 slot、snapToTarget=false），不写出该编辑标记。旧组件没有此标记时维持原有视点配置。Linear 可添加终点、交换起终点；坐标三轴横排。Components 及扩展字段收进「高级设置」。旧文件有多份镜头参数时编辑最后一份已启用项，并提示在高级设置中整理。

| 编辑器数据 | 千星结构体字段 |
| --- | --- |
| `clip.startTime` | Group 的 `Timer`；同一时间的 Clip 进入同一 ActionClip 列表 |
| `clip.duration` | `ActionClip.duration` 与 `CameraClip.duration` |
| `camera.shot.properties.cameraName` | `CameraClip.cameraName` |
| `camera.shot.properties.positionData` | `CameraClip.positionData` → PositionData |
| `camera.shot.properties.rotationData` | `CameraClip.rotationData` → RotationData |
| `positionData.slot` / `rotationData.slot` | PositionSlot 的 StructList，保留编辑顺序 |

`NOLOC_CAMERA` 的 `intParams[0]`（Int32List）引用 `CameraMovementDate` 中的全局序号，`stringParams` 为空。
演出根结构中的 `CameraMovementDate` 字典键使用 Int32。已同步 V2.0 新版演出与对话节点定义；对话新增的 `autoContinue` 按结构体默认值 `10.00` 导出。
Camera 数据仍按每 100 项拆分字典；位置和旋转 Slot 数量分别按类型限制。

字段及中文标签定义在 `cameraClip.ts`，注册入口在 `clipComponentRegistry.ts`。
通用 Clip 参数支持 `vector3`、`struct`、`struct-list`，并非 Camera 专用编辑控件。
结构体 ID 在界面的「结构体 ID 设置」中编辑，配置随工程 JSON 保存，导出时递归替换。

注意：

- 相机名称是文本框，编辑器默认 `Default`。位置类型下拉为 `Fixed`（默认）、`Linear`、`Follow`、`Orbit`；旋转类型下拉为 `Fixed`（默认）、`Linear`、`LookAt`。
- 旋转 Slot 默认 1 个且不能删除最后一个。Fixed、LookAt 限定 1 个，Linear 允许 1～2 个；仅 LookAt 显示 `snapToTarget`。切换为单 Slot 类型时保留第一个点位，隐藏字段值保留；旧文件的超量点位读取时保留并提示。
- 位置 Slot 默认 1 个且不能删除最后一个。Fixed、Follow、Orbit 限定 1 个，Linear 允许 1～2 个；切换为单 Slot 模式时保留第一个点位。旧文件若有超量点位，读取时保留并在面板提示，可手动删除或切换模式规范数量。
- 仅 Follow 显示 `snapToTarget`（立即抵达目标）；仅 Orbit 显示 `orbitRot` 的三维输入和 `orbitRadius`。切换时保留隐藏字段值。
- Slot 的坐标空间下拉为 `Local`（数值 0，默认）与 `World`（数值 1）。点位类型为 `Vector3`（默认）、`Guid`、`Entity`。
- 视点位置的点位类型额外支持 `Rot`（旋转）。选择后显示旋转 XYZ，表示根据旋转确定视点位置；仍保存并导出到 PositionSlot 的 `vector3` 字段，`pointType` 为 `Rot`。相机位置不提供此选项，切换类型保留已有字段值。
- Fixed 视点的点位类型仅提供 `Vector3` 和 `Rot`，专用面板与高级设置一致。主动切换为 Fixed 时，Guid／Entity 点位改为 Vector3，原目标字段保留；Rot 保持原样。只读取旧文件不改写原点位，受限类型在下拉框中提示重新选择。
- Vector3 点位只显示向量；Guid / Entity 点位显示对应目标字段以及挂接点、offset、requiresClientPos。显隐由模板 `visibleWhen` 定义，切换时保留隐藏字段的原值，导出仍按完整结构体顺序写入。
- 已保存的空值或未知枚举不会被擅自覆盖，下拉会提示重新选择。业务默认由组件模板提供，不改动源结构体 JSON。
- `guid` 用整数字符串保存；`entity` 在 V2.0 中是 String，不是 Entity ID 类型。
- Vector3 用 `"x,y,z"` 保存，面板提供 X/Y/Z 独立输入框。
- 新建镜头的位置和旋转 Slot 各为一个独立的默认 Vector3 点位，orbitRadius 为 0。独立 PositionData 文件中的半径 2 不覆盖该默认。
- V2.0 不再导出旧版 `delay`、起止坐标等扁平字段。已有组件的旧扩展属性仍保存在工程里，但不会猜测转换为新的 Slot。
