import { PRIMITIVE_PROJECT_SCHEMA, PRIMITIVE_PROJECT_VERSION } from "./primitiveLuaExporter";

/** API source: the user's 2026.8.13 client UI API document. */
export function buildPrimitiveImageLibLua() {
  return { fileName: "PrimitiveImageLib.lua", code: `-- 独立图元图片运行库 v3；兼容 v1/v2 Data，不依赖动画或 Tween 运行库。
-- local collection = PrimitiveImageLib.create(rootControl, data, imagePrefabIndex)
-- Data 中 path="" 表示 rootControl 自身；其他路径相对于 rootControl 查找。
-- collection:destroy() 仅销毁本库创建的图片。相同 root 再次 create 会替换之前的集合。
-- imagePrefabIndex 是图片控件模板索引，不是图片素材 ID 或运行时控件 ID。
local PrimitiveImageLib = {}
PrimitiveImageLib.Schema = "${PRIMITIVE_PROJECT_SCHEMA}"
PrimitiveImageLib.Version = ${PRIMITIVE_PROJECT_VERSION}
local Instances = setmetatable({}, { __mode = "k" })
-- 紧凑 Data：图形 0矩形/1椭圆/2三角形；图片模式 0Basic/1Stretch。
local ImageIds = { [0] = 100001, [1] = 100002, [2] = 100003 }
local ImageTypes = { [0] = "Basic", [1] = "Stretch" }
local LegacyImageIds = { [100001] = true, [100002] = true, [100003] = true }
local Columns = { "imageId", "imageType", "x", "y", "width", "height", "rotation", "r", "g", "b", "a" }

local function DecodeType(row, compact)
    if compact then return ImageIds[row[1]], ImageTypes[row[2]] end
    return LegacyImageIds[row[1]] and row[1], (row[2] == "Basic" or row[2] == "Stretch") and row[2]
end

local function Number(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function Array(value)
    if type(value) ~= "table" then return false end
    local count = 0
    for key in pairs(value) do
        if not Number(key) or key < 1 or key % 1 ~= 0 then return false end
        count = count + 1
    end
    for index = 1, count do if value[index] == nil then return false end end
    return true
end

local Runtime = {}
function Runtime.destroy(controls)
    local errors = {}
    for index = #controls, 1, -1 do
        local control = controls[index]
        local ok, message = pcall(function()
            if control.alive then
                control:SetVisible(false)
                game.DestroyClientUIControl(control)
            end
        end)
        if ok then table.remove(controls, index) else errors[#errors + 1] = tostring(message) end
    end
    if #errors > 0 then error("[PrimitiveImageLib] 图片清理失败：" .. table.concat(errors, "; "), 0) end
end

function Runtime.create(parent, row, imagePrefabIndex, controls, index, compact)
    local image = game.InstantiateClientUIControl(imagePrefabIndex, parent)
    if image == nil then error("图片控件实例化失败，请检查图片模板索引") end
    controls[#controls + 1] = image -- 创建后立即登记；后续任意设置失败都可回收。
    if not image.alive or typeof(image) ~= "ClientUIImageControl" then error("指定模板的根控件必须是图片控件") end
    image:SetVisible(false)
    image.name = "Primitive_" .. index
    image.canControllerFocus = false
    image:SetAnchorMin(0.5, 0.5)
    image:SetAnchorMax(0.5, 0.5)
    image:SetPivot(0.5, 0.5)
    image:SetLocalScale(1, 1, 1)
    image:SetAnchoredPosition(row[3], row[4])
    image:SetSizeDelta(row[5], row[6])
    image:SetLocalRotation(0, 0, row[7])
    local imageId, imageType = DecodeType(row, compact)
    image:SetImage(Enum.ImageSource.StaticReference, imageId)
    image.imageType = Enum.ImageType[imageType]
    image.imageColor = Color.FromRGBA(row[8], row[9], row[10], row[11])
    image.enableMask = false
    image.enableSoftEdge = false
    image:SetFillUnused()
    if not image:SetAsLastSibling() then error("无法设置图元图片层级") end
    image:SetActive(true)
end

local function Prepare(root, data, imagePrefabIndex)
    if root == nil or not root.alive or type(root.FindChild) ~= "function" then error("请传入有效的根控件") end
    if not Number(imagePrefabIndex) or imagePrefabIndex < 1 or imagePrefabIndex % 1 ~= 0 then error("请传入图片控件模板索引") end
    if type(data) ~= "table" or not Array(data.groups) or #data.groups == 0 then error("无效的图元项目 Data") end
    local compact = data.v == 2 or data.v == PrimitiveImageLib.Version
    local legacy = data.v == nil and data.schema == "UGCTools.PrimitiveProject@1"
    if not compact and not legacy then error("不支持的图元项目版本，请更新 PrimitiveImageLib") end
    if legacy then
        if not Array(data.columns) or #data.columns ~= #Columns then error("无效的图元字段顺序") end
        for index, name in ipairs(Columns) do if data.columns[index] ~= name then error("不支持的图元字段顺序") end end
    end
    local targets, used = {}, {}
    for _, group in ipairs(data.groups) do
        if type(group) ~= "table" or type(group.path) ~= "string" or not Array(group.elements) or #group.elements == 0 then error("无效的图元容器数据") end
        if (group.visible ~= nil and type(group.visible) ~= "boolean") or (group.focus ~= nil and type(group.focus) ~= "boolean") then error("无效的图元容器显示状态") end
        local target = root
        if group.path ~= "" then target = root:FindChild(group.path) end
        if target == nil or not target.alive or typeof(target) ~= "ClientUIContainerControl" then error("未找到图元容器：" .. group.path) end
        if used[target] then error("图元容器路径重复：" .. group.path) end
        used[target] = true
        for _, row in ipairs(group.elements) do
            if not Array(row) or #row ~= #Columns then error("无效的图元字段数量：" .. group.path) end
            local imageId, imageType = DecodeType(row, compact)
            if not imageId or not imageType then error("无效的图片类型或图形类型：" .. group.path) end
            for index = 3, #Columns do if not Number(row[index]) then error("图元包含无效数值：" .. group.path) end end
            if row[5] <= 0 or row[6] <= 0 then error("图元大小必须为正数：" .. group.path) end
            for index = 8, 11 do
                if row[index] < 0 or row[index] > 255 or row[index] % 1 ~= 0 then error("图元颜色必须为 0–255 整数：" .. group.path) end
            end
        end
        targets[#targets + 1] = { control = target, group = group, compact = compact,
            applyState = data.v == PrimitiveImageLib.Version, visible = target.visible, focus = target.canControllerFocus }
    end
    return targets
end

function PrimitiveImageLib.create(root, data, imagePrefabIndex)
    -- 先检查全部路径和数据；无效输入不会影响已有图片。
    local targets = Prepare(root, data, imagePrefabIndex)
    local collection = { controls = {} }
    function collection:destroy()
        Runtime.destroy(self.controls)
        if Instances[root] == self then Instances[root] = nil end
    end
    local ok, message = pcall(function()
        for _, entry in ipairs(targets) do
            for index, row in ipairs(entry.group.elements) do
                Runtime.create(entry.control, row, imagePrefabIndex, collection.controls, index, entry.compact)
            end
        end
        -- 空容器的显隐与激活是独立状态；隐藏嘴型仍保持原有激活状态。
        for _, entry in ipairs(targets) do
            if entry.applyState then
                entry.changed = true
                entry.control:SetVisible(entry.group.visible ~= false)
                entry.control.canControllerFocus = entry.group.focus == true
            end
        end
        -- 初始化完整集合后再显示。只替换由同一库实例管理的旧图片。
        for _, image in ipairs(collection.controls) do image:SetVisible(true) end
    end)
    if not ok then
        for index = #targets, 1, -1 do
            local entry = targets[index]
            if entry.changed then
                pcall(function()
                    if entry.control.alive then
                        entry.control:SetVisible(entry.visible)
                        entry.control.canControllerFocus = entry.focus
                    end
                end)
            end
        end
        local cleaned, cleanupMessage = pcall(function() collection:destroy() end)
        error("[PrimitiveImageLib] 创建失败：" .. tostring(message) .. (cleaned and "" or "; " .. tostring(cleanupMessage)), 0)
    end
    local previous = Instances[root]
    if previous ~= nil then
        local cleaned, cleanupMessage = pcall(function() previous:destroy() end)
        if not cleaned then
            pcall(function() collection:destroy() end)
            error(cleanupMessage, 0)
        end
    end
    Instances[root] = collection
    return collection
end

return PrimitiveImageLib
` };
}
