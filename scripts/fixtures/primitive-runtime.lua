-- API mock verification, not a game-device pass.
local created, destroyed, failImage, wrongTemplate = {}, {}, nil, false
local paths = {}
local function target(name)
    local control = { alive = true, kind = "ClientUIContainerControl", name = name, children = {}, active = true, visible = true, canControllerFocus = false }
    function control:SetVisible(value) self.visible = value end
    return control
end
local root = target("root")
for _, group in ipairs(data.groups) do paths[group.path] = target(group.path) end
function root:FindChild(path) return paths[path] end
function typeof(control) return control.kind end
Enum = { ImageSource = { StaticReference = 7 }, ImageType = { Basic = 10, Stretch = 11 } }
Color = { FromRGBA = function(r, g, b, a) return { r, g, b, a } end }
game = {}
function game.InstantiateClientUIControl(index, parent)
    assert(index == 987654 and parent.kind == "ClientUIContainerControl")
    local properties = { alive = true, parent = parent, kind = wrongTemplate and "ClientUIContainerControl" or "ClientUIImageControl" }
    local image = setmetatable({}, {
        __index = properties,
        __newindex = function(_, key, value)
            assert(key ~= "imageId" and key ~= "imageSource", "read-only image identity")
            properties[key] = value
        end,
    })
    function image:SetImage(source, id)
        assert(source == Enum.ImageSource.StaticReference)
        if failImage == #created then error("injected SetImage failure") end
        properties.imageSource, properties.imageId = source, id
    end
    function image:SetVisible(value) self.visible = value end
    function image:SetActive(value) self.active = value end
    function image:SetAnchorMin(x, y) self.anchorMinX, self.anchorMinY = x, y end
    function image:SetAnchorMax(x, y) self.anchorMaxX, self.anchorMaxY = x, y end
    function image:SetPivot(x, y) self.pivotX, self.pivotY = x, y end
    function image:SetLocalScale(x, y, z) self.localScaleX, self.localScaleY, self.localScaleZ = x, y, z end
    function image:SetAnchoredPosition(x, y) self.anchoredPositionX, self.anchoredPositionY = x, y end
    function image:SetSizeDelta(x, y) self.sizeDeltaX, self.sizeDeltaY = x, y end
    function image:SetLocalRotation(x, y, z) self.localRotationX, self.localRotationY, self.localRotationZ = x, y, z end
    function image:SetFillUnused() self.fillUnused = true end
    function image:SetAsLastSibling()
        local siblings = self.parent.children
        for i, child in ipairs(siblings) do if child == self then table.remove(siblings, i); break end end
        siblings[#siblings + 1] = self
        return true
    end
    created[#created + 1] = image
    parent.children[#parent.children + 1] = image
    return image
end
function game.DestroyClientUIControl(image)
    assert(image.alive)
    image.alive = false
    destroyed[#destroyed + 1] = image
    for index, child in ipairs(image.parent.children) do
        if child == image then table.remove(image.parent.children, index); break end
    end
end

local collection = lib.create(root, data, 987654)
assert(#created == 6 and #collection.controls == 6)
local first = collection.controls[1]
assert(first.imageId == 100002 and first.imageType == Enum.ImageType.Basic)
assert(first.anchoredPositionX == 30 and first.anchoredPositionY == -15)
assert(first.sizeDeltaX == 60 and first.sizeDeltaY == 30)
assert(first.localRotationZ == -30 and first.localRotationX == 0 and first.localRotationY == 0)
assert(first.imageColor[4] == 128 and collection.controls[2].imageColor[4] == 0)
assert(first.anchorMinX == 0.5 and first.anchorMaxY == 0.5 and first.pivotX == 0.5)
assert(first.localScaleX == 1 and first.localScaleZ == 1)
assert(first.fillUnused and not first.enableMask and not first.enableSoftEdge and not first.canControllerFocus)
assert(first.visible and first.active and first.parent.visible == false and first.parent.active == true, "hidden container must stay active")
assert(first.parent.canControllerFocus == true and collection.controls[4].parent.visible == true, "restore per-container focus and default visibility")
assert(first.parent.children[1] == first and first.parent.children[3].imageId == 100003)
assert(first.parent.children[2].imageId == 100001)

local missingPath = data.groups[2].path
local savedTarget = paths[missingPath]
paths[missingPath] = nil
local ok, message = pcall(lib.create, root, data, 987654)
assert(not ok and #created == 6 and first.alive, "preflight failure must not affect existing collection")
paths[missingPath] = savedTarget
data.groups[2].elements[1][11] = 256
assert(not pcall(lib.create, root, data, 987654) and #created == 6)
data.groups[2].elements[1][11] = 128
failImage = #created + 2
ok = pcall(lib.create, root, data, 987654)
assert(not ok and #destroyed == 2 and first.alive, "partial failed creation must be rolled back")
assert(destroyed[1] == created[8] and destroyed[2] == created[7], "reverse cleanup")
failImage = nil
wrongTemplate = true
assert(not pcall(lib.create, root, data, 987654) and not created[#created].alive)
wrongTemplate = false
local replacement = lib.create(root, data, 987654)
assert(not first.alive and #replacement.controls == 6 and #collection.controls == 0, "repeated create replaces old images")
collection:destroy()
assert(replacement.controls[1].alive, "old collection cleanup must not destroy replacement")
local count = #destroyed
replacement:destroy()
assert(#destroyed == count + 6 and #replacement.controls == 0)
replacement:destroy()
assert(#destroyed == count + 6, "cleanup must be idempotent")
for _, parent in pairs(paths) do assert(#parent.children == 0) end
local beforeInvalid = #created
for _, bad in ipairs({-1, 3, 0.5, "1", 100002}) do
    data.groups[1].elements[1][1] = bad
    assert(not pcall(lib.create, root, data, 987654) and #created == beforeInvalid, "invalid compact shape type must be rejected")
end
data.groups[1].elements[1][1] = 1
for _, bad in ipairs({-1, 2, 0.5, "Basic"}) do
    data.groups[1].elements[1][2] = bad
    assert(not pcall(lib.create, root, data, 987654) and #created == beforeInvalid, "invalid compact image mode must be rejected")
end
data.groups[1].elements[1][2] = 1
local stretched = lib.create(root, data, 987654)
assert(stretched.controls[1].imageType == Enum.ImageType.Stretch, "mode 1 must decode to Stretch")
stretched:destroy()
data.groups[1].elements[1][2] = 0
data.v = 99
assert(not pcall(lib.create, root, data, 987654), "unknown data versions must be rejected")
data.v = 3
local legacy = lib.create(root, dofile('legacy.lua'), 987654)
assert(legacy.controls[1].imageId == 100002 and legacy.controls[1].imageType == Enum.ImageType.Basic)
assert(legacy.controls[1].imageColor[4] == 128, "old Data must still decode identically")
legacy:destroy()
local v2 = lib.create(root, dofile('v2.lua'), 987654)
assert(v2.controls[1].imageId == 100002 and not v2.controls[1].parent.visible, 'v2 remains compatible and preserves current container state')
v2:destroy()
local hiddenTarget = paths[data.groups[1].path]
hiddenTarget.visible = true
local defaultSetVisible = savedTarget.SetVisible
savedTarget.SetVisible = function(self, visible) if visible then error('injected visibility failure') end; self.visible = visible end
savedTarget.visible = false
assert(not pcall(lib.create, root, data, 987654), 'state application failure must abort creation')
assert(hiddenTarget.visible == true and savedTarget.visible == false, 'failed state application restores all prior container visibility')
for _, parent in pairs(paths) do assert(#parent.children == 0, 'state application failure cleans up images') end
savedTarget.SetVisible = defaultSetVisible
local large = lib.create(root, dofile('large.lua'), 987654)
assert(#large.controls == 800, "400 elements per target must load and instantiate")
large:destroy()
print("PASS Lua 5.3 runtime: compact types/modes, legacy compatibility, paths, layout, SetImage, alpha, stacking, preflight, rollback, replacement, cleanup and 800 images")
