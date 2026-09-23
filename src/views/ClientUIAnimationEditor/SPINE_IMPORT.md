# Spine 动画文件夹导入

在「导入 → 导入 Spine 动画文件夹」选择包含 skeleton.json 和原始图片的文件夹。
例如 `H:/Code/ugc-web/spinetoastra` 中的 `skeleton.json`、`body_正.png`；
不需要 `.spine` 文件；同目录存在该文件也会忽略。编辑文件使用 JSON 所在文件夹名称。
优先查找 skeleton.json，允许同目录存在其他配置 JSON；没有该名称时兼容唯一的其他 JSON。
仅有 `.spine` 时，需要先在 Spine 中导出 JSON。图片可在子文件夹内，优先按 JSON 的 images 路径匹配，
其次按 JSON 所在目录匹配，最后才使用唯一同名图片。缺图、同名歧义、多个骨骼候选 JSON
或不支持的版本会报错，不替换当前工程。

当前支持 Spine 3.8（样本为 3.8.75）：

- FK 骨骼及父子关系、静态位移/旋转/缩放、朝右的骨骼长度标记。
- 默认皮肤的普通 region 图片附件；资源内嵌到工程中，分享时无需本机路径。
- 多 Animation、位移 X/Y 与旋转 Z；Spine 相对 setup 的数据转换为编辑器绝对值。
- 线性和 stepped 关键帧；贝塞尔曲线按 30 Hz 采样为线性关键帧近似。
- 在当前设备画布中居中放置 setup 包围盒；导入工作区时创建新的编辑文件。

限制会通过状态栏和导入提示报告：X/Y 缩放动画不导入（游戏 Tween 字段已停用），
静态缩放仍保留。约束、插槽颜色/附件切换、draw order、deform、事件等动画不还原。
仅保留默认皮肤的初始附件，特殊混合和染色不还原；跨骨骼插槽层叠可能不同。
暂不支持 mesh/蒙皮、atlas 裁图、剪切、特殊骨骼变换继承以及 Spine 4.x。
因此导入不是对所有 Spine 工程的无损转换；原始文件始终保持不变。

格式依据：https://esotericsoftware.com/spine-json-format

测试：`node scripts/test-client-ui-spine-import.cjs [可选的 skeleton.json 路径]`。
测试验证数据转换、曲线采样、错误输入和 SFC 编译，不代表游戏内试运行通过。
