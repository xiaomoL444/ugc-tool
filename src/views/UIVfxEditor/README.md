# UI 粒子工坊（实验版）

入口：/UIVfxEditor。复用现有动画编辑器的 ImageAssetLibrary、SpriteImage、
ColorRGBAField 和 Public/CustomUIImage OSS 目录，不新增资源接口。

## 功能

- 多发射器、图层排序、启用/禁用；星光、飘雪、收集路径预设。
- 点/圆/圆环/矩形出生区域；持续发射、周期爆发、延迟和循环。
- 寿命、尺寸、速度、初始旋转、角速度随机范围；重力/三次贝塞尔运动。
- 大小倍率、透明度的分段线性关键点；出生色到结束色渐变。
- 路径控制点拖动；暂停、重播、速度和时间定位；固定随机种子。
- 工作区与文件切换、自动保存、重命名、回收与撤销；JSON 往返、Lua 与接入包 ZIP 导出。

## 工作区与文件

左上角“工作区与文件”打开与动画编辑器一致的管理面板。使用应用统一存储，
存档命名空间为 UIVfxEditor，与 ClientUIAnimationEditor 隔离。支持浏览器存档和
应用已配置的桌面存档方式。切换文件、工作区或路由前先提交当前文件，保存失败时保留现场。
刷新恢复最近打开的工作区和文件。文件名由管理面板或“工程名称”旁的重命名按钮修改。

导入 JSON 创建新文件，重名时自动编号；预设替换仅修改当前文件的效果，不改文件名。
首次使用自动把旧 localStorage 单工程迁入默认工作区，并保留旧数据。
迁移通过日志记录进度，失败可重试；完成后不会因为删除工作区而重新导入旧工程。

## 模块

- particleModel.ts：版本化工程结构、预设、严格导入验证。
- particleWorkspace.ts：独立存档命名空间、旧版工程迁移和文件名兼容。\n- particleSimulation.ts：不依赖帧步进的绝对时间采样；合并连续发射与周期爆发。
- particleLuaRuntime.ts：相同算法的 Lua 实现、图片控件池与回收。
- particleLuaExporter.ts：Lua 字符串转义、数据序列化、宿主回调与接入说明。
- ParticleCurve.vue / ParticleNumber.vue：局部编辑控件。
- UIVfxEditor.vue：预览、OSS 资源选择、工程状态及下载。

## 语义与边界

持续发射从 0 秒开始，以 1/rate 的间隔跨周期继续；爆发在每个周期起点产生。
同一时刻先爆发，再发出持续粒子。非循环发射的出生窗口为 [0,duration)，
已有粒子继续存活。达到上限后按出生顺序复用槽位，长寿命粒子可能提前消失。
预览和 Lua 按槽位绘制同一层的粒子，后面的发射器覆盖前面的发射器。

贝塞尔路径使用 Lua 数学函数，不依赖千星曲线资产；不是弧长匀速运动。
生命周期关键点采用线性插值，没有贝塞尔切线编辑。
图片以正方形尺寸和普通透明混合渲染，没有 Shader、加法混合或贴图序列。

画布坐标以中心为原点，Y 向上。画布边界是网页预览窗口；游戏中是否裁剪取决于宿主容器。
预览速度/时长/循环按钮仅用于网页，不覆盖发射器的游戏运行设置。
每层上限 512、总预算 1024 是工具限制，尚未据此证明任何设备的可用帧率。

Lua 创建接口由 createImage(parent) 注入。导出的宿主脚本仅需配置
IMAGE_CONTROL_TEMPLATE_INDEX，默认 nil，不虚构模板索引。模板根节点要求
ClientUIImageControl，宿主要求 ClientUIContainerControl。不同文档版本将
InstantiateClientUIControl 第一参数称为模板索引或模板 ID，应以当前工程 API 为准。
不使用版本冲突的 EnableUpdate/EnableTick，接入时需确认选定更新回调触发。

## 验证

- npm run type-check
- npm run build
- node scripts/test-ui-particles.cjs
  - 需要 Python + lupa.lua53；可通过 PYTHON_BIN 指定解释器。
  - 检查边界、容量、导入、转义、224 组 JS/Lua 对照和控件生命周期模拟。
- 浏览器回归：
  - 先 npm run serve -- --host 127.0.0.1 --port 8088。
  - node scripts/test-ui-particles-browser.cjs。
  - 需要 Playwright，可用 PARTICLE_PLAYWRIGHT 指向模块；默认无头 Edge，
    可用 PARTICLE_BROWSER 选择已安装的 Chromium 通道。
  - 使用全新浏览器上下文，检查真实 OSS 图片、拖动、导入、下载和布局，
    截图保存在 node_modules/.cache/ui-particle-qa。

尚未在千星编辑器/客户端实机运行。原生图片效果、旋转方向、模板与资源的实际可用性、
回调触发，以及目标设备性能仍需在游戏工程验证。


- 工作区回归：
  - node scripts/test-client-ui-workspace-storage.cjs
  - node scripts/test-client-ui-workspace-session.cjs
  - node scripts/test-ui-particles-workspace-browser.cjs（同上 Playwright 配置）
  - 覆盖动画/特效存档隔离、旧工程迁移重试、快速切换、同名文件、刷新恢复和删除撤销。
