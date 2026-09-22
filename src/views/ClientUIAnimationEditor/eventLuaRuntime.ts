/** Event data is validated before any control writes; callbacks never evaluate source text. */
export function buildEventRuntimeLuaLines(): string[] {
  return `
local function PrepareTimelineEvents(root, data, options)
    if data.events == nil then return {} end
    if type(data.events) ~= "table" or #data.events > 10000 then error("无效的 events 列表") end
    if options ~= nil and type(options) ~= "table" then error("事件 options 必须为 table") end
    local handler = options and options.onEvent
    if handler ~= nil and type(handler) ~= "function" then error("onEvent 必须为函数") end
    local events, controls = {}, {}
    for index, event in ipairs(data.events) do
        if type(event) ~= "table" or not IsNumber(event.time) or event.time < 0
            or type(event.name) ~= "string" or event.name == "" or #event.name > 320
            or type(event.target) ~= "string" or type(event.params) ~= "string" or #event.params > 16384 then error("无效的事件：" .. index) end
        local target = GetControl(root, event.target, controls)
        if target == nil then error("找不到事件目标：" .. event.target) end
        events[#events + 1] = { time = event.time, name = event.name, target = event.target, params = event.params, control = target, order = index }
    end
    table.sort(events, function(a, b) if a.time == b.time then return a.order < b.order end return a.time < b.time end)
    if #events > 0 and handler == nil then printerr("[TweenTimeline] Data 包含事件，但未提供 options.onEvent；事件不会执行。") end
    local batches = {}
    for _, event in ipairs(events) do
        local batch = batches[#batches]
        if batch == nil or batch.time ~= event.time then batch = { time = event.time, events = {} }; batches[#batches + 1] = batch end
        batch.events[#batch.events + 1] = event
    end
    for _, batch in ipairs(batches) do
        batch.fire = function()
            if handler == nil then return end
            for _, event in ipairs(batch.events) do
                if event.control.alive ~= false then
                    local payload = { time = event.time, name = event.name, target = event.target, params = event.params }
                    local ok, message = pcall(handler, payload, event.control)
                    if not ok then printerr("[TweenTimeline] 事件 " .. event.name .. " 执行失败：" .. tostring(message)) end
                end
            end
        end
    end
    return batches
end
`.trim().split("\n");
}
