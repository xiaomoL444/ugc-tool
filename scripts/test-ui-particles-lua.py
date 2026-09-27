"""Actual Lua 5.3 numerical parity + mocked client UI lifecycle contract."""
import json
import math
import sys
from lupa.lua53 import LuaRuntime

payload = json.load(sys.stdin)
lua = LuaRuntime(unpack_returned_tuples=True)
runtime = lua.execute(payload["runtime"])
lua.globals().Runtime = runtime
lua.globals().DATA = lua.eval(payload["project"])

def compare(actual, expected, path="frame"):
    if isinstance(expected, dict):
        for key, value in expected.items():
            compare(actual[key], value, path + "." + key)
    elif isinstance(expected, (int, float)):
        assert math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8), (path, actual, expected)
    else:
        assert actual == expected, (path, actual, expected)

for case in payload["cases"]:
    actual = runtime.Sample(lua.eval(case["emitter"]), case["time"])
    assert len(actual) == len(case["expected"]), (case["time"], len(actual), len(case["expected"]))
    for i, expected in enumerate(case["expected"], 1):
        compare(actual[i], expected)
assert lua.eval(payload["text"]) == payload["expectedText"]
print("PASS Lua 5.3 numerical parity and UTF-8/control-character serialization")

mock = r'''
created={}; deleted={}; errors={}; failAt=nil; badTypeAt=nil; destroyFailure=nil
function typeof(object) return object.kind end
Enum={ImageSource={StaticReference=1},ImageType={Basic=1}}
Color={FromRGBA=function(r,g,b,a) return {r=r,g=g,b=b,a=a} end}
root={alive=true,kind="ClientUIContainerControl"}
script={object=root}
function printerr(message) errors[#errors+1]=message end
function factory(parent)
    assert(parent==root)
    local id=#created+1
    if failAt==id then error("injected factory failure") end
    local image={alive=true,visible=true,id=id,kind=(badTypeAt==id and "ClientUIButtonControl" or "ClientUIImageControl")}
    created[id]=image
    function image:SetVisible(v) self.visible=v end
    function image:SetActive(v) self.active=v end
    function image:SetAnchorMin(x,y) self.anchorMin={x,y} end
    function image:SetAnchorMax(x,y) self.anchorMax={x,y} end
    function image:SetPivot(x,y) self.pivot={x,y} end
    function image:SetLocalScale(x,y,z) self.scale={x,y,z} end
    function image:SetLocalRotation(x,y,z) self.rotation=z end
    function image:SetAnchoredPosition(x,y) self.position={x,y} end
    function image:SetSizeDelta(w,h) self.size={w,h} end
    function image:SetImage(source,id) self.imageId=id end
    function image:SetFillUnused() self.fillUnused=true end
    function image:SetAsLastSibling() return true end
    return image
end
game={
    InstantiateClientUIControl=function(index,parent) assert(index==7); return factory(parent) end,
    DestroyClientUIControl=function(image)
        if image.id==destroyFailure then error("injected cleanup failure") end
        image.alive=false; deleted[#deleted+1]=image.id
    end
}
'''
lua.execute(mock)
lua.execute(r'''
local player=Runtime.Create(root,DATA,factory)
assert(#created==5 and #player.controls==5)
player:Play(); player:Update(.5)
assert(player.time==.5 and #created==5)
local visible=0
for _,image in ipairs(created) do
    if image.visible then visible=visible+1; assert(image.imageColor.a>=0 and image.imageColor.a<=255) end
    assert(image.imageId==100002 and image.scale[1]==1)
end
assert(visible>0)
player:Pause(); player:Update(1); assert(player.time==.5)
player:SetVisible(false); for _,image in ipairs(created) do assert(not image.visible) end
player:Seek(.75); for _,image in ipairs(created) do assert(not image.visible) end
player:SetVisible(true); player:Restart(); assert(player.time==0 and player.running)
player:Destroy(); player:Destroy(); assert(#deleted==5 and not player.running)
for i=1,5 do assert(deleted[i]==6-i) end
''')
for setup in ("failAt=3", "badTypeAt=3"):
    lua.execute(mock)
    lua.execute(setup)
    lua.execute(r'''
local ok=pcall(function() Runtime.Create(root,DATA,factory) end)
assert(not ok and #created>0 and #deleted==#created)
for _,image in ipairs(created) do assert(not image.alive) end
''')
lua.execute(mock)
lua.execute(r'''
local player=Runtime.Create(root,DATA,factory)
destroyFailure=3
assert(not pcall(function() player:Destroy() end))
assert(#deleted==4 and #player.controls==1 and player.controls[1].id==3)
destroyFailure=nil; player:Destroy(); assert(#deleted==5 and #player.controls==0)
''')
print("PASS Lua pool reuse, visibility, reverse cleanup, rollback and cleanup retry")

for source, level in ((payload["host"], False), (payload["levelHost"], True)):
    lua.execute(mock)
    lua.execute(source)
    lua.execute("OnEnable(); OnStart(); OnStart(); assert(#created==5)")
    update = "OnLevelUpdate" if level else "OnUpdate"
    inactive_update = "OnUpdate" if level else "OnLevelUpdate"
    lua.execute(inactive_update + "(.5); assert(created[1].size~=nil)")
    lua.execute(update + "(.5)")
    lua.execute(r'''
local x=created[1].position[1]
OnDisable(); OnUpdate(10); OnLevelUpdate(10)
for _,image in ipairs(created) do assert(not image.visible) end
assert(created[1].position[1]==x)
OnEnable(); SeekParticles(.75); PauseParticles(); OnDisable(); OnEnable()
local x2=created[1].position[1]
OnUpdate(1); OnLevelUpdate(1); assert(created[1].position[1]==x2)
RestartParticles(); OnDestroy(); OnDestroy()
assert(#deleted==5 and #errors==0)
''')
lua.execute(mock)
lua.execute(payload["unconfigured"])
lua.execute("OnStart(); OnUpdate(.1); OnDestroy(); assert(#created==0 and #errors==1)")
print("PASS exported host lifecycle, time source selection and missing-template handling")

