# 时间轴事件（TweenTimelineLib v8.3）

每个 Animation 有独立的「⚑ 事件」轨道。点击加号在播放头添加事件，或双击轨道空白处。
拖动标记调整时间，吸附开关与属性轨道共用；同一时间允许多个事件，纵向堆叠显示。
点击标记展开编辑区，设置时间、名称、目标控件、字符串参数，点击「应用」。
事件列表中的上下顺序决定同刻事件执行顺序；可复制、粘贴到播放头、删除及撤销。
Ctrl+C/V 和 Delete 在事件区域生效；输入框保留原生文字编辑行为。

参数是原样传递的字符串，可为空，最多 4096 字。不是 JSON，不会被解析或当作 Lua 执行。
网页播放仅记录最近 50 条事件日志；拖动进度条不触发，暂停后继续不重复触发，
从起点重播及每轮循环会重新触发。日志不写入存档或撤销历史。

## 游戏接入

重新下载并替换 `Lib/TweenTimelineLib.lua`（v8.3），Data 仍使用 @8 数据结构并标记 `libVersion`。
纯事件动画也可以导出及重新导入；没有事件字段的旧文件保持兼容。
控件目标按所选导出根生成相对路径，范围外的目标事件不导出。
未指定目标的事件随动画导出，以当前导出根为回调目标；导回网页时绑定到所选导入根。
删除目标控件时清理关联事件，撤销可恢复。

```lua
local sequence = TweenTimelineLib.Create(script.object, Data, {
    onEvent = function(event, target)
        -- event.time / event.name / event.target / event.params
        -- target 是解析后的控件；event.params 是字符串。
        if event.name == "ShowDialogue" then
            print("对白参数：", event.params)
        end
    end,
})
sequence:Play()
-- 在持有者销毁时调用 sequence:Kill(false)。
```

运行库先验证事件并解析目标，再构造动画。同刻事件合并在一个 InsertCallback 中按列表顺序调用。
回调异常会记录错误，不阻断同刻后续事件；回调目标已销毁时跳过。
不传 `onEvent` 时提示一次并忽略事件，不影响属性动画。不在 Create 阶段调用用户事件。
调用方可以自行分发事件名；库不自动调用同名函数或执行参数中的文本。

`InsertCallback`、`Restart`、`Kill` 接口依据客户端 UI API 文档。
Lua 5.3 API 模拟测试覆盖事件构造、顺序、异常隔离、重复回调和版本校验；
游戏端 Restart/SetLoops 的事件边界、Complete 是否补发事件，以及同刻属性与事件的先后顺序仍需试运行。
本库保证用户事件彼此间的同刻顺序，不承诺同刻属性已由游戏引擎全部更新。
