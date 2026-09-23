# 图片资源与图元拟合

工具栏「图片资源」管理当前文件的自定义原图、拟合设置与结果。图元控件通过 imageResourceId 引用 primitiveResources 中的资源，只保存引用和显示方式。旧文件的内嵌 imageUrl/fitData 会按原图合并迁移；未被引用的资源也随文件保存。替换原图会清除旧拟合结果，所有引用恢复原图预览。

拖动控件仅修改控件变换，不改写资源中的图元坐标。自动保存和撤销快照在拖动/输入事务期间暂停全文序列化，结束后再捕获最终状态；普通修改按 Vue 更新批次合并。这样原图模式下移动控件不会因反复扫描内嵌图片和拟合数据而阻塞。关闭页面前仍会捕获尚未结束的事务，用于未保存提示。相关回归：`node scripts/test-client-ui-history-editor.cjs`（包含大资源拖动、最终保存、撤销重做与关闭检查）。

拟合在浏览器 Web Worker 中运行 Go WASM，默认 400 个图元、512 px 精度、16 个线程，实际线程数最大 min(16, hardwareConcurrency)。每轮分布搜索候选、选取最低误差并提交到主计算线程。关闭面板或取消操作会终止本轮全部 Worker，保留之前成功的拟合结果。单张生成时切换资源也会取消本轮生成。数量、分辨率与并行数分别影响输出复杂度、计算精度与内存/并行计算开销。

「一键生成缺失图元」按各资源的拟合参数逐张处理当前文件中有图片且没有拟合结果的资源，不受搜索筛选影响。已有结果会跳过，失败会记录原因并继续处理下一张。批量处理期间可切换图片查看结果，参数编辑和单张生成暂时停用；取消后再次点击会继续处理剩余未拟合图片。结果写入前会检查资源是否被删除、换图、改参数或已获得结果，避免覆盖期间的编辑。队列验证：node scripts/test-client-ui-primitive-batch.cjs。

参数 JSON 使用 UGCTools.PrimitiveImage@1：原图中心为原点、X 向右、Y 向上、角度为度、尺寸为原图像素，elements 按底层到顶层排列。每项包含 imageId、position、rotation、size、color、layer。控件预览按 min(控件宽/原图宽, 控件高/原图高) 等比适配。白底模式会增加一个背景矩形。预览使用编辑器已有的游戏素材 100001/100002/100003；游戏实际渲染还可能存在采样差异。原生 GIA 导出把图元控件作为同名容器；可以配合以下 Lua 图元项目在这些容器下生成实际图片。

## 图元项目 Lua 导出

1. 在层级树选中容器，打开「Lua 工具 → 导出图元项目 Lua」。导出该容器全部后代图元控件，包含隐藏控件，不依赖当前原图/拟合显示模式。未拟合资源跳过并提示；路径有斜杠或同级重名时阻止导出，避免定位到错误控件。
2. 「Lua 工具 → 导出图元运行库」下载独立的 `PrimitiveImageLib.lua`。无需 TweenTimelineLib 或 Timeline Data。
3. 先将 GIA 布局导入游戏，保留根容器及后代容器的名称、层级、布局。每个图元控件在 GIA 中已有一个同名空容器；运行库会查找它并恢复该图元控件的显隐与手柄聚焦，不重建容器或修改其变换和激活状态。
4. 将运行库放入 Lib，数据模块放入 Data。取得与导出时所选根容器对应的运行时对象，以及一个图片控件模板索引，调用：

```lua
-- PrimitiveImageLib、primitiveData 为已加载的运行库和数据模块。
-- rootControl 是导出时所选容器对应的运行时对象。
-- imagePrefabIndex 是用于创建图片的控件模板索引。
local images = PrimitiveImageLib.create(rootControl, primitiveData, imagePrefabIndex)

-- 在所属脚本的 OnDestroy 或不再需要此集合时调用：
images:destroy()
```

GIA 导出时，全部控件内部 ID（包括从 GIA 导入的控件）按当前节点列表重新连续分配，通常从 1073741825 开始，UI 包装节点使用下一号；如遇需保留的外部依赖 ID，则整体移动编号区间以避免冲突。父子关系、根引用、控件标识及组件所属标识同步更新。客户端 UI 索引、图片素材 ID、模板索引和编辑器文档内 ID 保持原值。Lua 图元项目按名称路径查找容器，不受这些内部编号变化影响。

`create` 使用 `rootControl:FindChild(path)` 找到每个目标容器，再调用 `game.InstantiateClientUIControl(imagePrefabIndex, container)` 创建图片，立即登记到集合中。通过 `SetImage(Enum.ImageSource.StaticReference, imageId)` 设置矩形 100001、椭圆 100002、三角形 100003；不直接写只读的 imageId。模板索引与这三个素材 ID 不同。

新数据使用紧凑版本标记 `v=3`，groups 中每项包含相对路径和 elements；非默认状态仅额外写入 `visible=false` 或 `focus=true`（默认可见、不允许手柄聚焦）。不重复输出 schema 字符串、根名称、控件尺寸和列名表。路径不包含根容器名。elements 各列为 `type, mode, x, y, width, height, rotation, r, g, b, a`；type 为 `0=矩形、1=椭圆、2=三角形`，mode 为 `0=Basic、1=Stretch`，由运行库映射为实际素材 ID 和 Enum.ImageType。颜色包括透明度都是 0–255。图元位置和大小已经按对应控件的尺寸等比换算，锚点和轴心居中、Y 向上，旋转是 Z 轴角度。运行库按数组顺序从底到顶创建图片。父容器的位移、旋转、缩放、显隐和动画通过层级继承，不重复写入图元；如运行时修改了容器尺寸，图元仍使用导出时的尺寸数据。

```lua
return {v=3,groups={
  {path="头部/中刘海",elements={
    {1,0,30,-15,60,30,-30,12,34,56,128},
  }},
}}
```

导出新版数据时请同步更新 `PrimitiveImageLib.lua`。新版库兼容旧的 `UGCTools.PrimitiveProject@1` 及 v2 数据，旧版库不支持 v3 数据。旧数据维持原有的容器状态；v3 通过文档确认的 `SetVisible` 和 `canControllerFocus` 恢复编辑器状态。原生 GIA 的这两个字段仍未确认，因此只对图元占位容器交由运行库处理，不把“隐藏”改成 `active=false`。隐藏的 PSD 嘴型不会再被这项 GIA 检查阻断；只有配合新版图元 Data 和 Lib 创建后才应用这些状态。创建失败会回滚本轮已修改的容器状态并清理新图片。

同一个库实例对同一根容器重复 `create` 会替换自己上次生成的集合，不删除原有容器和其他控件。路径和数据在创建前全量检查；生成途中失败会逆序销毁本轮创建的图片，已有集合保留。`destroy` 可重复调用，已被游戏销毁的图片会跳过。

API 依据（documented）：用户 `E:/GenshinUGC/2026.8.13 7.1beta/Lua 客户端 UI 脚本 API.md` 的创建/销毁、FindChild、布局、SetImage、ImageType、Color 和同级排序接口。导出及 Lua 5.3 模拟接口测试（passed）：`node scripts/test-client-ui-primitive-lua.cjs`。运行 Lua 测试需设置 `LUA_BIN`，或 `PYTHON_BIN` 与 `LUPA_PATH` 使用 Lua 5.3。游戏内实际显示与性能验证：pending，模拟接口不代表真机验证。

## 动画旋转与游戏预览

TweenTimelineLib v8.1 对 localRotationX/Y/Z 使用原始数据的终值减初值作为 Tween 增量（SetRelative(true)）。例如 -116° → -136° 应转 -20°；如果原生欧拉角 getter 将初值读回为 244°，旧绝对 Tween 会向 -136° 转动 -380°。此修正兼容角度原样读回和归一化读回，并保留用户指定的多圈旋转，不强制取最短路径。关键帧边界仍写入原始值，incoming 跳变和 step 语义保持不变。

数据 Schema 保持 @8，并兼容 @3–7；已有项目只需重新导出并替换 TweenTimelineLib.lua，无需重拟合图片或重新导出图元 Data/GIA。此处修改的是容器动画运行库，PrimitiveImageLib 的静态图元角度不变。

依据：本地原生 API 文档的 Tween:SetRelative 增量语义（documented）。Lua 5.3 模拟接口验证覆盖归一化/原样角度、立即/延迟捕获初值、三轴、新旧格式、负角度、跨 360°、多圈、重播、incoming/step 和溢出（passed）。用户视频与欧拉角归一化问题相符，但尚未取得游戏 getter 实测值；引擎同一时刻的回调/Tween 顺序及实际播放效果仍需游戏验证（pending）。

## 引擎来源

- 上游：https://github.com/1475505/Miliastra-toolbox-primitive-shape
- 固定版本：46f30bb318c82aa4d4ece7bd790dc68e483fb360
- 基于该版本的源码，现从 vendor/primitive-fitting 构建 primitive.wasm。透明模式增加了前景种子、距离场、搜索及提交阶段的越界约束，取消导出时的平均透明度乘算。wasm_exec.js 与编译器配套；Worker 使用同目录资源及 alpha-edge-1 缓存版本。
- 上游 MIT 许可保存在 public/primitive-wasm/LICENSE，primitive 依赖许可保存在 primitive-LICENSE。WASM 与 wasm_exec.js 必须配套更新。
- 静态构建直接包含以上资源，无需远端拟合 API、Go 服务或浏览器跨源隔离。来源为网址的图片需要允许跨域读取；本地导入图片可直接计算。

验证：node scripts/test-client-ui-primitive-data.cjs；node node_modules/vue-tsc/bin/vue-tsc.js --noEmit。

## 透明底修正与 GE-IMG 对照

对用户提供的 GE_IMG_Tool.exe（说明文件标注 1.2.0）进行了静态检查，未运行程序，也未复制其代码。其透明模式通过边缘距离缩小候选图形，并拒绝透明像素占比超过约 5% 的候选及其微调结果；普通模式允许大色块越界。

旧接入将透明像素写成白色 RGB，违反 Go image.RGBA 的预乘颜色要求；上游又在导出时给整个图形乘以平均覆盖透明度，因此可能得到越出轮廓的半透明色块。现在透明像素为零 RGBA，半透明颜色正确预乘，所有候选限制透明区域覆盖并检查真实几何边界，导出保留优化后的 alpha。约束允许少量栅格边缘，不保证与原图逐像素完全一致。图元预览使用实际图形，不用原图遮罩隐藏越界。

旧文件的拟合结果不会自动改写，需要在图片资源面板重新生成。搜索可能跳过无改善或不合法候选，实际数量不超过设定预算。构建方法见 vendor/primitive-fitting/README.md；回归验证运行 node scripts/test-client-ui-primitive-alpha.cjs。

## 拟合 SVG 编辑

图片资源的拟合设置提供「导出拟合 SVG」和「导入 SVG 覆盖拟合」。导出的是独立、可编辑的矢量图元，不是内嵌位图；顺序、颜色、单图元透明度、位置及旋转保留。SVG 使用左上原点 / Y 向下，导入时转换回图片中心 / Y 向上。

导出图形使用绝对坐标，颜色为小写 `#rrggbb`，透明度为 `opacity`（四位小数），旋转为 `rotate(角度 中心X 中心Y)`，不使用 `translate`。坐标、尺寸和旋转角保留两位小数（因此重新导入存在相应舍入误差），例如 `<ellipse cx="150.00" cy="150.00" rx="88.00" ry="88.00" fill="#0f766e" opacity="0.9500" transform="rotate(-0.00 150.00 150.00)" />`。原项目数据不受导出舍入影响。

导入只替换当前资源的 fitData 并切到图元预览，保留资源 ID、名称、原图、拟合参数和控件引用，通过原有资源保存流程持久化及撤销。已有拟合结果时，按其画布尺寸等比居中适配 SVG viewBox；没有结果时采用 SVG 自身 viewBox / 像素宽高。与原图替换入口分开：选择本地图片仍表示替换原图并清空拟合。

支持纯填充 rect、ellipse、circle、等腰三角形 polygon / M-L-H-V-Z 直线路径，以及可表示的平移、旋转、缩放和矩阵变换。支持纯色、单图元透明度及组内填充继承。曲线、描边、圆角、渐变、滤镜、蒙版、引用、组透明度混色、斜切等无法无损表达的内容会报错，不会部分覆盖。建议直接编辑本工具导出的 SVG，并保留原始图元类型。游戏素材边缘与数学矢量图形仍可能存在采样差异。

SVG 最大 2 MiB、1001 个图元、画布边长 32768。只使用脱离页面的 XML 解析，不挂载 SVG；拒绝脚本、事件、外部引用和实体声明。导入失败或读取期间切换资源 / 替换原图 / 更新拟合，均不会覆盖已有结果。

验证：`node scripts/test-client-ui-primitive-svg.cjs` 覆盖转换、顺序、颜色透明度、适配、拒绝不支持内容和资源持久化（Node 测试采用 AST 适配，不代替浏览器 XML 解析）。`scripts/fixtures/primitive-svg-*.svg` 用于页面实测；已验证导入、失败保留和撤销。下载事件的浏览器自动化确认仍待验证。

## 拟合 CSS 导出

「导出拟合 CSS」生成 `.css` 文件，采用 `/* Miliastra CSS Export */`、`.shaper-container`、`.shaper-element` 与 `.shaper-element.shaper-e0` 等选择器。容器按资源原尺寸、白色背景、裁剪溢出输出（不改写资源透明度或项目数据）；需要透明底可将导出文件的容器背景改为 `transparent`。

图元使用绝对中心坐标（左上原点 / Y 向下）与 `translate(-50%, -50%) rotate(...)`；坐标、大小及角度保留两位小数，`opacity` 四位小数，颜色为小写 `#rrggbb`，`z-index` 按原图元顺序从 0 递增。椭圆使用 `border-radius: 50%`，三角形使用 `clip-path: polygon(50% 0%, 0% 100%, 100% 100%)`。

CSS 本身不创建 DOM，需要配套结构，例如 `<div class="shaper-container"><div class="shaper-element shaper-e0"></div><div class="shaper-element shaper-e1"></div></div>`，为每个图元创建对应编号的子元素。

「导入 CSS 覆盖拟合」读取本工具的 shaper 格式（不需要 HTML），还原图元坐标、大小、旋转、颜色及透明度。按非负整数 z-index 排序，相同层级按 shaper-e 编号排序；容器纯色背景转为底层矩形，透明底不添加，已被最底层不透明矩形完全覆盖的背景不重复添加。颜色自身 alpha 与 opacity 相乘。已有拟合时按其尺寸等比居中适配，否则使用 CSS 容器尺寸。CSS 背景矩形计入最多 1001 个图元的限制，单文件上限 2 MiB。

只解析明确支持的规则，不向页面注入 CSS、不加载外部资源。未知属性/选择器、重复规则、渐变、图片、任意变换、媒体查询、负层级等会整份拒绝；与 SVG 共用读取忙碌状态及过期保护，保留原图、资源 ID 和引用，通过原资源保存/撤销流程覆盖拟合。测试：`node scripts/test-client-ui-primitive-css.cjs`。

## PSD 导入

工具栏「导入 PSD」在当前工作区创建独立文件，画布采用 PSD 原始尺寸。文件夹转为容器，图层转为嵌入 PNG 的图片资源，并创建引用该资源的图元控件。保留名称、嵌套关系、叠放顺序、隐藏状态及相对位置，拟合由图片资源面板单独设置。

解析器使用 ag-psd 31.0.2，在独立 Web Worker 中解码并导出 PNG；仅导入时加载。支持 8 位 RGB/灰度 PSD，文件限制 128 MB，解码像素内存限制 256 MB，最多 1024 个图层与文件夹。普通栅格蒙版与图层不透明度写入图片 alpha；特殊混合模式、剪贴蒙版、图层样式等不重新合成，遇到时在导入状态中列出差异。空图层保留透明图片资源。

ag-psd 返回的 children 顺序按底层到顶层处理，与本项目绘制顺序交叉验证；针对用户提供的 QQ-Ying PSD，正序叠加与文件内合成图的平均通道误差约 0.01，逆序约 24.74。编辑器树按顶层到底层展示。

验证：node scripts/test-client-ui-psd-import.cjs，可追加 PSD 文件路径验证真实文档。常规测试包含嵌套文件夹、隐藏/空图层、局部坐标、透明度、栅格蒙版、资源持久化及无效文件。
