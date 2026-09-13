-- Models scalar Euler getters that either retain angles or normalize to [0,360).
-- Native capture timing is undocumented: check construction and deferred startup.
do
    local originalTween, logCount = game.Tween, #logs
    local deferred = false
    function game.Tween(control, values, duration)
        local tween = originalTween(control, values, duration)
        if deferred then tween.from = {} end
        function tween:Sample(progress)
            for field, goal in pairs(self.values) do
                if self.from[field] == nil then self.from[field] = self.control[field] end
                local start = self.from[field]
                local delta = self.relative and goal or (goal - start)
                self.control[field] = start + delta * progress
            end
        end
        return tween
    end
    local function angleNear(actual, expected)
        assert(math.abs((actual - expected + 180) % 360 - 180) < 0.00001,
            tostring(actual) .. " differs from " .. tostring(expected))
    end
    local function callbacks(sequence, time)
        for _, entry in ipairs(sequence.callbacks) do if entry[1] == time then entry[2]() end end
    end
    local cases = {{-116.46,-136.46},{-136.46,-116.46},{350,370},{10,-10},{0,720},{0,-720},{-180,180}}
    local checks = 0
    for _, normalized in ipairs({false,true}) do
        local stored = {}
        local control = setmetatable({kind="ClientUIContainerControl"}, {
            __index = function(_, field) return stored[field] or 0 end,
            __newindex = function(_, field, value) stored[field] = normalized and value % 360 or value end,
        })
        for _, captureLater in ipairs({false,true}) do
            deferred = captureLater
            for _, field in ipairs({"localRotationX","localRotationY","localRotationZ"}) do
                for version = 3,8 do
                    for _, endpoints in ipairs(cases) do
                        local from, to = endpoints[1], endpoints[2]
                        local row = {"",field,0,2,"Linear",from,to}
                        if version == 8 then row = {"",field,{{0,from,false,"Linear","tween"},{2,to,false,"Linear","step"}}} end
                        local data = {schema="ClientUIAnimationEditor.TweenTimeline@" .. version,duration=2,tracks={row}}
                        local sequence = Lib.Create(control, data)
                        assert(#sequence.items == 1 and #logs == logCount)
                        local tween = sequence.items[1][2]
                        assert(tween.relative == true and tween.values[field] == to - from)
                        angleNear(control[field], from)
                        for replay = 1,2 do
                            callbacks(sequence, 0)
                            if deferred then tween.from = {} end
                            for _, progress in ipairs({0,0.13,0.37,0.61,0.9,1}) do
                                tween:Sample(progress)
                                angleNear(control[field], from + (to - from) * progress)
                            end
                            callbacks(sequence, 2)
                            angleNear(control[field], to)
                        end
                        assert((version == 8 and row[3][1][2] or row[6]) == from)
                        checks = checks + 1
                    end
                end
                -- Incoming endpoint can differ from the exact key, followed by a step.
                local sequence = Lib.Create(control, {schema=Lib.Schema,duration=4,tracks={{"",field,{
                    {0,-116,false,"Linear","tween"},
                    {1,45,false,"Linear","step",-136,false},
                    {2,-200,false,"Linear","tween"},
                    {4,-180,false,"Linear","step"},
                }}}})
                assert(#sequence.items == 2)
                callbacks(sequence, 0)
                sequence.items[1][2]:Sample(0.5)
                angleNear(control[field], -126)
                sequence.items[1][2]:Sample(1)
                angleNear(control[field], -136)
                callbacks(sequence, 1)
                angleNear(control[field], 45)
                callbacks(sequence, 2)
                sequence.items[2][2]:Sample(0.5)
                angleNear(control[field], -190)
                callbacks(sequence, 4)
                angleNear(control[field], -180)
            end
        end
    end
    -- Invalid deltas must not reach Tween; @8 restores originals after failure.
    for version = 3,8 do
        local control = {localRotationZ=23}
        local row = {"","localRotationZ",0,1,"Linear",-1e308,1e308}
        if version == 8 then row = {"","localRotationZ",{{0,-1e308,false,"Linear","tween"},{1,1e308,false,"Linear","step"}}} end
        local sequence = Lib.Create(control,{schema="ClientUIAnimationEditor.TweenTimeline@"..version,duration=1,tracks={row}})
        assert(#sequence.items == 0 and control.localRotationZ == 23 and #logs == logCount + 1)
        table.remove(logs)
    end
    game.Tween = originalTween
    print("PASS rotation interpolation: " .. checks .. " cases, incoming jumps, step, replay, overflow (API mocks; engine verification pending)")
end
