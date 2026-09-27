import { LUA_RUNTIME_SOURCE } from "./particleLuaRuntime";
import { parseProject, type ParticleProject } from "./particleModel";

/** Lua decimal escapes are always three digits, so following digits cannot merge. */
function luaString(value: string): string {
  return '"' + value.replace(/[\\\x00-\x1f\x7f"]/g, character => {
    if (character === "\\") return "\\\\";
    if (character === '"') return '\\"';
    return "\\" + character.charCodeAt(0).toString().padStart(3, "0");
  }) + '"';
}
export function toLua(value: unknown, depth = 0): string {
  if (value === null) return "nil";
  if (typeof value === "string") return luaString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const indent = "  ".repeat(depth + 1), closing = "  ".repeat(depth);
  if (Array.isArray(value)) return "{\n" + value.map(item => indent + toLua(item, depth + 1)).join(",\n") + "\n" + closing + "}";
  if (value && typeof value === "object") return "{\n" + Object.entries(value).map(([key, item]) => indent + "[" + luaString(key) + "] = " + toLua(item, depth + 1)).join(",\n") + "\n" + closing + "}";
  throw new Error("不能导出无效 Lua 数据");
}
export interface LuaExportOptions { templateIndex?: number; levelTime?: boolean }
export function buildParticleLua(raw: ParticleProject, options: LuaExportOptions = {}): string {
  const project = parseProject(raw);
  if (!project.emitters.some(e => e.enabled)) throw new Error("至少启用一个发射器后再导出");
  if (project.emitters.some(e => e.enabled && e.imageId === null)) throw new Error("请为启用的发射器选择图片");
  if (options.templateIndex !== undefined && (!Number.isSafeInteger(options.templateIndex) || options.templateIndex < 0)) throw new Error("图片模板索引必须是非负整数");
  return `-- UGCTools UI particles · 在容器控件上挂载本脚本。
-- 将图片模板索引填入下一行；模板根节点必须为 ClientUIImageControl。
-- 此参数传给 game.InstantiateClientUIControl，请按当前编辑器版本的参数定义填写。
local IMAGE_CONTROL_TEMPLATE_INDEX = ${options.templateIndex ?? "nil"}
local FOLLOW_LEVEL_TIME = ${options.levelTime ? "true" : "false"}
local DATA = ${toLua(project)}

local Runtime = (function()
${LUA_RUNTIME_SOURCE}
end)()

local player = nil
local failed = false
local started = false
local resumeOnEnable = true

local function cleanup()
    if player ~= nil then
        local previous = player
        local ok, message = pcall(function() previous:Destroy() end)
        if ok then player = nil else printerr("[UI 粒子清理] " .. tostring(message)) end
    end
end
local function fail(message)
    failed = true
    if player ~= nil then player:Pause() end
    cleanup()
    printerr("[UI 粒子] " .. tostring(message))
end
local function safely(action)
    if failed then return end
    local ok, message = pcall(action)
    if not ok then fail(message) end
end

function OnStart()
    if started then return end
    started = true
    safely(function()
        if IMAGE_CONTROL_TEMPLATE_INDEX == nil then
            error("请先填写 IMAGE_CONTROL_TEMPLATE_INDEX：根节点为图片控件的创建模板索引")
        end
        player = Runtime.Create(script.object, DATA, function(parent)
            return game.InstantiateClientUIControl(IMAGE_CONTROL_TEMPLATE_INDEX, parent)
        end)
        player:Play()
    end)
end
function OnUpdate(deltaTime)
    if not FOLLOW_LEVEL_TIME then safely(function() if player then player:Update(deltaTime) end end) end
end
function OnLevelUpdate(deltaTime)
    if FOLLOW_LEVEL_TIME then safely(function() if player then player:Update(deltaTime) end end) end
end
function OnDisable()
    safely(function()
        if player then resumeOnEnable = player.running; player:Pause(); player:SetVisible(false) end
    end)
end
function OnEnable()
    safely(function()
        if player then player:SetVisible(true); if resumeOnEnable then player:Play() end end
    end)
end
function OnDestroy()
    failed = true
    cleanup()
end

-- 以下为本脚本提供的控制函数，可从你自己的逻辑调用。
function PlayParticles() safely(function() if player then player:SetVisible(true); player:Play() end end) end
function PauseParticles() safely(function() if player then player:Pause() end end) end
function RestartParticles() safely(function() if player then player:SetVisible(true); player:Restart() end end) end
function SeekParticles(seconds) safely(function() if player then player:Seek(seconds) end end) end
`;
}
export function buildHandoff(project: ParticleProject, options: LuaExportOptions = {}): string {
  return `# ${project.name} · 千星 UI 粒子接入说明

1. 在千星编辑器中创建一个容器，建议大小为 ${project.width} × ${project.height}，将 ParticleEffect.lua 挂在这个容器上。
2. 创建一个可由脚本实例化的控件模板，根节点必须是 ClientUIImageControl，不挂额外脚本。将其创建索引填入 IMAGE_CONTROL_TEMPLATE_INDEX。${options.templateIndex === undefined ? "导出文件当前为 nil，必须填写后才能播放。" : "当前配置为 " + options.templateIndex + "，请确认它对应你工程的图片模板。"}
3. game.InstantiateClientUIControl 的第一参数按当前项目 API 定义填写；参考 API 使用模板索引，部分版本称模板 ID。它不是图片资源 ID。
4. 静态图片 ID 来源于动画编辑器共用的 OSS 资源目录；请确认这些资源在你使用的千星版本存在。网站的图片 URL 不会进入游戏脚本。
5. 脚本初始化时创建控件池，失败时回收已创建控件；禁用时暂停并隐藏，销毁时逆序回收。不调用版本间存在差异的 EnableUpdate / EnableTick，请在编辑器确认 ${options.levelTime ? "OnLevelUpdate" : "OnUpdate"} 回调能触发。

## 运行与预览

- 原点是容器中心，X 向右，Y 向上。画布尺寸是设计参考，脚本不强制改变父容器尺寸，不随容器大小自动缩放。
- 三次贝塞尔运动由 Lua 函数计算，P1/P2/终点均相对发射器位置；出生点在形状内采样。时间归一化为寿命进度，不是匀速沿路径移动。
- 大小与透明度使用分段线性关键点。颜色在出生色和结束色间插值。网页颜色透明度 0～1，写入千星 Color.FromRGBA 时转换为 0～255。
- 使用固定随机种子和绝对时间计算。暂停、回放和定位同一时间将产生一致的粒子数据。
- 每个周期在起点产生一次爆发；持续发射从 0 秒开始，每隔 1 / 速率 秒产生一个粒子，跨循环周期保持连续节奏。同一时刻先爆发、再持续发射。非循环模式只在发射周期内出生，停止后已有粒子继续走完寿命。
- 达到池容量时，新粒子复用最早的槽位；这是可重复的覆盖策略，寿命较长时可能提前消失。工程上限 1024 是本工具的预算限制，不是平台性能保证。
- 图片按正方形尺寸渲染，使用普通透明混合；不包含加法混合、Shader、UV 动画或原生 3D 粒子。图层从列表顶部到下方依次覆盖。
- 网页的预览时长、播放速度、网格和辅助线只影响编辑器。游戏脚本会按发射器自身的循环与周期继续运行。
- 控制函数：PlayParticles / PauseParticles / RestartParticles / SeekParticles(seconds)。这些是导出脚本的函数，不是千星原生 API。
- 仅隐藏父容器不一定停止脚本更新；需要停播时请调用 PauseParticles，或禁用脚本宿主以触发 OnDisable。

## 验证状态

已提供网页预览与可独立测试的 Lua 数学模块。千星内的模板索引、资源、事件触发、旋转方向和设备性能仍需要在你的工程内实机验证。

## 图片清单

${project.emitters.map(e => "- " + e.name + "：" + (e.imageId ?? "未选择") + (e.enabled ? "" : "（禁用）")).join("\n")}

project.json 可重新导入网页继续编辑。
`;
}


