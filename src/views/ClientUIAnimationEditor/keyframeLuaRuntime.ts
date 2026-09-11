import { controlDefinitions } from "./controlRegistry";
import { baseTweenableFields } from "./tweenRegistry";

/** Inserted after the existing Decode/Ease/CollectColors helpers, before Create. */
export function buildKeyframeRuntimeLuaLines(): string[] {
  const fields = new Map<string, "number" | "color">(baseTweenableFields.map((field) => [field.fieldKey, field.valueKind]));
  for (const control of controlDefinitions) {
    for (const field of control.fields) if (field.tweenable) fields.set(field.key, field.kind === "color" ? "color" : "number");
  }
  fields.set("groupAlpha", "number");
  return [
    "-- @8 原生关键帧；不借助虚拟 Clip 或额外运行库。",
    "local KeyframeFields = {",
    ...[...fields].map(([key, kind]) => `    ${key} = "${kind}",`),
    "}",
    ...`
local function KeyframeValue(value, kind)
    if kind == "number" then return IsNumber(value) end
    if type(value) ~= "table" or #value ~= 4 then return false end
    for index = 1, 4 do
        local channel = value[index]
        if not IsNumber(channel) or channel < 0 or channel > 255 or channel % 1 ~= 0 then return false end
    end
    return true
end

local function ResolveKeyframeValue(value, relative, previous)
    if relative then
        if not IsNumber(previous) then error("增量关键帧无法读取基础数值") end
        value = previous + value
        if not IsNumber(value) then error("关键帧增量计算溢出") end
    end
    return value
end

local function CreateKeyframes(root, data)
    local sequence = game.TweenSequence()
    local createdTweens, initials, originals = {}, {}, {}
    local function RestoreInitials()
        for _, entry in ipairs(initials) do entry[1][entry[2]] = entry[3] end
    end
    local ok, message = pcall(function()
        if root == nil then error("根控件不能为空") end
        if type(data.tracks) ~= "table" or not IsNumber(data.duration) or data.duration < 0 then error("无效的 @8 Data") end
        local controls, lanes, claimed = {}, {}, {}
        -- 先解析、检查所有轨道，快照所有基础属性和颜色；此阶段不写入控件。
        for trackIndex, row in ipairs(data.tracks) do
            if type(row) ~= "table" or #row ~= 3 or type(row[1]) ~= "string" or type(row[2]) ~= "string"
                or type(row[3]) ~= "table" or #row[3] == 0 then error("无效的关键帧轨道：" .. trackIndex) end
            local field, kind = row[2], KeyframeFields[row[2]]
            if kind == nil then error("未知 Tweenable 字段：" .. field) end
            local control = GetControl(root, row[1], controls)
            if control == nil then error("找不到关键帧控件：" .. row[1]) end
            local isGroup = field == "groupAlpha"
            local targets, baseline = {}, nil
            if isGroup then
                CollectColors(control, targets, {})
                baseline = 255
                if #targets == 0 then printerr("[TweenTimeline] 组透明度没有可控制的颜色：" .. row[1]) end
            else
                baseline = control[field]
                if kind == "number" and not IsNumber(baseline) then error("控件没有可读取的数值字段：" .. row[1] .. "/" .. field) end
                if kind == "color" then
                    local r, g, b, a = Color.ToRGBA(baseline)
                    if not IsNumber(r) or not IsNumber(g) or not IsNumber(b) or not IsNumber(a) then error("控件颜色字段无效：" .. field) end
                end
                targets[1] = { control, field }
            end
            for _, target in ipairs(targets) do
                local owned = claimed[target[1]] or {}
                if owned[target[2]] then error("重复轨道或组透明度与颜色轨道冲突：" .. row[1] .. "/" .. field) end
                owned[target[2]], claimed[target[1]] = true, owned
                originals[#originals + 1] = { target[1], target[2], target[1][target[2]] }
            end
            local rawKeys = {}
            for keyIndex, key in ipairs(row[3]) do
                if type(key) ~= "table" or not IsNumber(key[1]) or key[1] < 0 or not KeyframeValue(key[2], kind)
                    or (key[3] ~= nil and type(key[3]) ~= "boolean") or Ease[key[4]] == nil
                    or (key[5] ~= "tween" and key[5] ~= "step")
                    or (key[6] ~= nil and not KeyframeValue(key[6], kind))
                    or (key[7] ~= nil and type(key[7]) ~= "boolean")
                    or (key[7] == true and key[6] == nil)
                    or ((key[3] == true or key[7] == true) and not IsRelativeField(field)) then
                    error("关键帧格式或增量字段无效：" .. trackIndex .. "/" .. keyIndex)
                end
                if isGroup and (key[2] < 0 or key[2] > 255 or (key[6] ~= nil and (key[6] < 0 or key[6] > 255))) then error("组透明度超出 0–255") end
                rawKeys[#rawKeys + 1] = key
            end
            table.sort(rawKeys, function(a, b) return a[1] < b[1] end)
            local keys, previous, previousTime = {}, baseline, nil
            for _, key in ipairs(rawKeys) do
                if previousTime ~= nil and key[1] - previousTime <= 0.000001 then error("同一轨道存在重复时间关键帧") end
                local value = ResolveKeyframeValue(key[2], key[3], previous)
                local incoming = value
                if key[6] ~= nil then incoming = ResolveKeyframeValue(key[6], key[7], previous) end
                keys[#keys + 1] = { time = key[1], value = value, incoming = incoming, ease = key[4], interpolation = key[5] }
                previous, previousTime = value, key[1]
            end
            lanes[#lanes + 1] = { targets = targets, keys = keys, isGroup = isGroup }
        end
        -- 确定每个真实字段的首值；构造后和 Restart 的 0 秒统一恢复同一状态。
        for _, lane in ipairs(lanes) do
            for _, target in ipairs(lane.targets) do
                local first = lane.isGroup and GroupColor(target, lane.keys[1].value) or Decode(lane.keys[1].value)
                initials[#initials + 1] = { target[1], target[2], first }
            end
        end
        -- 文档未细化同一时刻回调/Tween 的内部顺序：0 秒恢复、边界跳变与 Restart 待游戏内验证。
        sequence:InsertCallback(0, RestoreInitials)
        local lastTime = data.duration
        for _, lane in ipairs(lanes) do
            for _, target in ipairs(lane.targets) do
                for keyIndex, key in ipairs(lane.keys) do
                    local value = lane.isGroup and GroupColor(target, key.value) or Decode(key.value)
                    -- 每个首/尾/孤立帧都写值；step 段仅通过关键帧回调跳变。
                    sequence:InsertCallback(key.time, function() target[1][target[2]] = value end)
                    lastTime = math.max(lastTime, key.time)
                    local nextKey = lane.keys[keyIndex + 1]
                    if nextKey ~= nil and key.interpolation == "tween" then
                        local to = lane.isGroup and GroupColor(target, nextKey.incoming) or Decode(nextKey.incoming)
                        target[1][target[2]] = value
                        local tween = game.Tween(target[1], { [target[2]] = to }, nextKey.time - key.time)
                        createdTweens[#createdTweens + 1] = tween
                        tween:SetEase(Ease[key.ease]):SetRelative(false)
                        sequence:Insert(key.time, tween)
                    end
                end
            end
        end
        sequence:InsertCallback(lastTime, function() end)
        RestoreInitials()
    end)
    if not ok then
        -- 构造失败时按创建逆序释放资源，不遗留已经创建的 Tween。
        for index = #createdTweens, 1, -1 do pcall(function() createdTweens[index]:Kill(false) end) end
        pcall(function() sequence:Kill(false) end)
        for _, entry in ipairs(originals) do pcall(function() entry[1][entry[2]] = entry[3] end) end
        printerr("[TweenTimeline] 无法创建关键帧序列：" .. tostring(message))
        return game.TweenSequence()
    end
    -- 成功后由返回的 sequence 统一持有；调用方在销毁时 sequence:Kill(false)。
    return sequence
end
`.trim().split("\n"),
    "",
  ];
}
