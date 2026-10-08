# 镜头编辑

Follow（跟随）只提供 GUID、Entity 定位，隐藏 Vector3 选项及坐标输入；偏移设置仍可使用。主动从 Vector3 模式切换至 Follow 时默认使用 GUID，原坐标作为隐藏草稿保留。

相机位置的 Linear（线性移动）在 Vector3 点位下也可编辑偏移（offset），起点和终点均支持，保存和导出时保留该值。

左侧「镜头」入口管理当前工作区的 `CameraEditor/*.json`。每份文件编辑一个镜头的时长、相机位置及可选视点位置，复用对话中的 `CameraClipEditor.vue`，包含相同的点位类型、模式和高级设置。

相机位置的 GUID、Entity(String) 可从工作区实体预设选择，分别复制 `guid` 与“实体查询”（`entityQuery`），同时保留手动输入。下拉使用统一样式，按实体名称和实际值搜索；系统玩家自身的 GUID 可直接选择。空查询和无效 GUID 不进入候选，GUID 始终按文本复制以保留精度。已有镜头值不自动更新，后续修改或删除预设不会改写镜头；常规点位与高级设置共用字段定义。

视点的固定角度提供 Vector3 和 Rot（旋转），不显示 GUID 和 Entity；Linear（线性移动）与 LookAt（固定视点位置）均提供 Vector3、GUID 和 Entity，实体定位字段支持工作区预设。Rot 的坐标空间仍可设置。已有文件中的隐藏字段继续保留，存档和导出结构不变。

编辑文件使用 `DSFGCameraProject` 格式，与对话文件和相机名称预设分别保存。读取前验证文件类型和组件结构，损坏文件不会被空白内容覆盖。新建、切换和删除前冲刷保存队列；工作区路径在组件建立时固定，保存失败会阻止离开。

「导出千星镜头」输出 CameraClip 根结构，复用演出导出的镜头编译逻辑，使用工作区集中配置中的镜头、位置、视点和点位结构体 ID。文件名称不会改写相机名称预设，未配置的视点按现有约定导出为空 RotationData。

验证：`node scripts/test-dsfg-camera-files.cjs`、`node scripts/test-dsfg-camera-export.cjs`、`node scripts/test-dsfg-studio-shell.cjs`。
