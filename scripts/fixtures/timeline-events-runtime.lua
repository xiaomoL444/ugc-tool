do
    local calls = {}
    local data = { schema=Lib.Schema, libVersion=Lib.Version, duration=2, tracks={}, events={
        {time=1,name="A",target="",params="42|false"},
        {time=0,name="Start",target="",params=""},
        {time=1,name="B",target="",params=""},
    }}
    local sequence = Lib.Create(root, data, {onEvent=function(event, target)
        assert(target == root)
        calls[#calls+1] = event.name
        if event.name == "A" then assert(event.params == "42|false"); event.params = "changed"; error("test callback failure") end
    end})
    assert(#calls == 0, "Create must never fire user events")
    data.events[1].name = "Mutated"
    for _, callback in ipairs(sequence.callbacks) do if callback[1] == 1 then callback[2]() end end
    assert(table.concat(calls, ",") == "A,B", "same-time callback failure must not skip the following event")
    for _, callback in ipairs(sequence.callbacks) do if callback[1] == 1 then callback[2]() end end
    assert(table.concat(calls, ",") == "A,B,A,B", "replay uses isolated parameters")
    local before = root.anchoredPositionX
    local bad = Lib.Create(root, {schema=Lib.Schema,duration=1,tracks={},events={{time=-1,name="Bad",target="",params=""}}})
    assert(#bad.items == 0 and root.anchoredPositionX == before)
    local logCount = #logs
    local newer = Lib.Create(root, {schema=Lib.Schema, libVersion="8.10",duration=1,tracks={}})
    assert(#newer.items == 0 and #logs == logCount + 1 and logs[#logs]:find("版本不匹配"))
    logCount = #logs
    Lib.Create(root, {schema=Lib.Schema, libVersion=Lib.Version .. ".0",duration=1,tracks={}})
    assert(#logs == logCount, "trailing zero version is compatible")
    print("PASS event-only runtime, grouped ordering, exception isolation, replay, validation and version gate")
end
