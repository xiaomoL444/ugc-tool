# Camera Clip（V2.0）

结构体来源：`src/assets/DSFGStudio`，与用户提供的「结构体导出/V2.0」对应。

在 Group Timeline 的 Camera Line 中添加 Clip，点击 Clip 编辑参数。一个 Camera
Line 可以有多个 Clip；每个 Clip 默认创建一个 `camera.shot` 组件。位置与旋转
分别维护自己的 Slot 列表，共用 `PositionSlot` 字段模板。

| 编辑器数据 | 千星结构体字段 |
| --- | --- |
| `clip.startTime` | Group 的 `Timer`；同一时间的 Clip 进入同一 ActionClip 列表 |
| `clip.duration` | `ActionClip.duration` 与 `CameraClip.duration` |
| `camera.shot.properties.cameraName` | `CameraClip.cameraName` |
| `camera.shot.properties.positionData` | `CameraClip.positionData` → PositionData |
| `camera.shot.properties.rotationData` | `CameraClip.rotationData` → RotationData |
| `positionData.slot` / `rotationData.slot` | PositionSlot 的 StructList，保留编辑顺序 |

`NOLOC_CAMERA` 的 `stringParams[0]` 引用 `CameraMovementDate` 中的全局序号。
Camera 数据仍按每 100 项拆分字典；单个 Slot 列表的上限为 100 项。

字段及中文标签定义在 `cameraClip.ts`，注册入口在 `clipComponentRegistry.ts`。
通用 Clip 参数支持 `vector3`、`struct`、`struct-list`，并非 Camera 专用编辑控件。
结构体 ID 在界面的「结构体 ID 设置」中编辑，配置随工程 JSON 保存，导出时递归替换。

注意：

- 相机名称是文本框，编辑器默认 `Default`。位置类型下拉为 `Fixed`（默认）、`Linear`、`Follow`、`Orbit`；旋转类型暂时保留文本输入。
- Slot 的坐标空间下拉为 `Local`（数值 0，默认）与 `World`（数值 1）。点位类型为 `Vector3`（默认）、`Guid`、`Entity`。
- Vector3 点位只显示向量；Guid / Entity 点位显示对应目标字段以及挂接点、offset、requiresClientPos。显隐由模板 `visibleWhen` 定义，切换时保留隐藏字段的原值，导出仍按完整结构体顺序写入。
- 已保存的空值或未知枚举不会被擅自覆盖，下拉会提示重新选择。业务默认由组件模板提供，不改动源结构体 JSON。
- `guid` 用整数字符串保存；`entity` 在 V2.0 中是 String，不是 Entity ID 类型。
- Vector3 用 `"x,y,z"` 保存，面板提供 X/Y/Z 独立输入框。
- 新建镜头采用 CameraClip 内嵌默认：Slot 列表为空、orbitRadius 为 0。独立 PositionData 文件中的一个示例 Slot 和半径 2 不覆盖该默认。
- V2.0 不再导出旧版 `delay`、起止坐标等扁平字段。已有组件的旧扩展属性仍保存在工程里，但不会猜测转换为新的 Slot。
