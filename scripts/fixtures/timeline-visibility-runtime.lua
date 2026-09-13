-- A read-only visible property: any direct assignment fails this fixture.
local function visibleControl(initial)
    local state = initial
    local control = { alive = true, calls = {}, active = true }
    function control:SetVisible(value)
        assert(type(value) == "boolean")
        self.calls[#self.calls + 1] = value
        state = value
    end
    return setmetatable(control, {
        __index = function(_, field) if field == "visible" then return state end end,
        __newindex = function(target, field, value)
            assert(field ~= "visible", "visible must only be changed through SetVisible")
            rawset(target, field, value)
        end,
    })
end
local function runAt(sequence, time)
    for _, callback in ipairs(sequence.callbacks) do if callback[1] == time then callback[2]() end end
end
local logsBeforeVisibility = #logs
local parent, child = visibleControl(true), visibleControl(false)
function parent:FindChild(path) assert(path == "Child"); return child end
local visibilityData = { schema = Lib.Schema, duration = 5, tracks = {
    { "", "visible", {{2, false, false, "Linear", "step"}, {4, true, false, "Linear", "step"}} },
    { "Child", "visible", {{3, true, false, "Linear", "step"}} },
} }
local visibility = Lib.Create(parent, visibilityData)
assert(#logs == logsBeforeVisibility and #visibility.items == 0)
assert(parent.visible == true and child.visible == false)
runAt(visibility, 0)
assert(parent.visible == true and child.visible == false)
runAt(visibility, 2)
assert(parent.visible == false and child.visible == false)
runAt(visibility, 3)
assert(parent.visible == false and child.visible == true)
runAt(visibility, 4)
assert(parent.visible == true and child.visible == true)
runAt(visibility, 0) -- Restart restores original values, including false.
assert(parent.visible == true and child.visible == false)
assert(parent.active == true and child.active == true)

local zero = Lib.Create(child, {schema = Lib.Schema, duration = 1, tracks = {
    {"", "visible", {{0, false, false, "Linear", "step"}, {1, true, false, "Linear", "step"}}},
}})
assert(child.visible == false and #zero.items == 0)
runAt(zero, 1); assert(child.visible == true)
runAt(zero, 0); assert(child.visible == false)
child.alive = false
local calls = #child.calls
runAt(zero, 1); assert(#child.calls == calls)
child.alive = true

-- A malformed lane cannot partially change another control's visibility.
local before = parent.visible
local invalidVisibility = Lib.Create(parent, {schema = Lib.Schema, duration = 5, tracks = {
    visibilityData.tracks[1], {"Child", "visible", {{0, true, false, "Linear", "tween"}}},
}})
assert(#invalidVisibility.items == 0 and parent.visible == before and #logs == logsBeforeVisibility + 1)
print("PASS visibility callbacks: booleans, paths, setup, exact boundaries, restart and read-only state")
