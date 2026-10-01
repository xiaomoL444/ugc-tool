# 镜头编辑

左侧「镜头」入口管理当前工作区的 `CameraEditor/*.json`。每份文件编辑一个镜头的时长、相机位置及可选视点位置，复用对话中的 `CameraClipEditor.vue`，包含相同的点位类型、模式和高级设置。

编辑文件使用 `DSFGCameraProject` 格式，与对话文件和相机名称预设分别保存。读取前验证文件类型和组件结构，损坏文件不会被空白内容覆盖。新建、切换和删除前冲刷保存队列；工作区路径在组件建立时固定，保存失败会阻止离开。

「导出千星镜头」输出 CameraClip 根结构，复用演出导出的镜头编译逻辑，使用工作区集中配置中的镜头、位置、视点和点位结构体 ID。文件名称不会改写相机名称预设，未配置的视点按现有约定导出为空 RotationData。

验证：`node scripts/test-dsfg-camera-files.cjs`、`node scripts/test-dsfg-camera-export.cjs`、`node scripts/test-dsfg-studio-shell.cjs`。
