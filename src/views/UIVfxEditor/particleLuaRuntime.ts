export const LUA_RUNTIME_SOURCE = String.raw`-- UIParticleRuntime v1. No engine particle system, file IO, or per-particle scripts.
local Runtime = {}
Runtime.Schema = "UGCTools.UIParticles@1"
local EPS = 1e-9
local function finite(n) return type(n) == "number" and n == n and n ~= math.huge and n ~= -math.huge end
local function lerp(a, b, t) return a + (b - a) * t end
local function randomFor(seed, ordinal)
    local state = (seed + ((ordinal + 1) % 2147483646) * 48271) % 2147483647
    if state < 1 then state = 1 end
    return function()
        state = (state * 16807) % 2147483647
        return (state - 1) / 2147483646
    end
end
local function curve(keys, t)
    if t <= keys[1].t then return keys[1].value end
    for i = 2, #keys do
        if t <= keys[i].t then
            return lerp(keys[i-1].value, keys[i].value, (t-keys[i-1].t)/(keys[i].t-keys[i-1].t))
        end
    end
    return keys[#keys].value
end
local function bezier(t, p0, p1, p2, p3)
    local u = 1-t
    local a, b, c, d = u*u*u, 3*u*u*t, 3*u*t*t, t*t*t
    return a*p0.x+b*p1.x+c*p2.x+d*p3.x, a*p0.y+b*p1.y+c*p2.y+d*p3.y
end
function Runtime.Sample(e, time)
    local frames = {}
    if not e.enabled or not finite(time) or time < e.delay then return frames end
    local elapsed = time - e.delay
    local continuous = e.rate > 0 and math.floor(elapsed*e.rate+EPS)+1 or 0
    if not e.loop then continuous = math.min(continuous,math.max(0,math.ceil(e.duration*e.rate-EPS))) end
    local bursts = (e.loop and math.floor(elapsed/e.duration)+1 or 1)*e.burst
    local last = continuous+bursts-1
    for ordinal = last,math.max(0,last-e.maxParticles+1),-1 do
        local rateBirth = continuous>0 and (continuous-1)/e.rate or -math.huge
        local burstBirth = bursts>0 and math.floor((bursts-1)/e.burst)*e.duration or -math.huge
        local fromRate = rateBirth >= burstBirth-EPS
        local birth = fromRate and rateBirth or burstBirth
        if fromRate then continuous=continuous-1 else bursts=bursts-1 end
        local age = elapsed-birth
        local random = randomFor(e.seed,ordinal)
        local function pick(r) return lerp(r.min,r.max,random()) end
        local life, speed, size = pick(e.lifetime),pick(e.speed),pick(e.size)
        local rotation, spin = pick(e.rotation),pick(e.spin)
        local direction = (e.angle+(random()-.5)*e.spread)*math.pi/180
        local shapeAngle, shapeRadius, boxX, boxY = random()*math.pi*2,random(),random(),random()
        if age >= -EPS and age < life then
            local start = {x=0,y=0}
            if e.shape == "circle" or e.shape == "ring" then
                local radius = e.radius * (e.shape == "ring" and 1 or math.sqrt(shapeRadius))
                start.x,start.y = math.cos(shapeAngle)*radius,math.sin(shapeAngle)*radius
            elseif e.shape == "box" then
                start.x,start.y = (boxX-.5)*e.width,(boxY-.5)*e.height
            end
            local t = math.max(0,age)/life
            local x,y
            if e.motion == "bezier" then x,y = bezier(t,start,e.control1,e.control2,e.target)
            else
                x = start.x+math.cos(direction)*speed*age+.5*e.gravity.x*age*age
                y = start.y+math.sin(direction)*speed*age+.5*e.gravity.y*age*age
            end
            frames[#frames+1] = {
                ordinal=ordinal,slot=ordinal%e.maxParticles,x=e.origin.x+x,y=e.origin.y+y,
                size=size*curve(e.sizeCurve,t),rotation=rotation+spin*age,
                color={r=lerp(e.startColor.r,e.endColor.r,t),g=lerp(e.startColor.g,e.endColor.g,t),
                    b=lerp(e.startColor.b,e.endColor.b,t),a=lerp(e.startColor.a,e.endColor.a,t)*curve(e.alphaCurve,t)}
            }
        end
    end
    for i=1,math.floor(#frames/2) do local j=#frames-i+1; frames[i],frames[j]=frames[j],frames[i] end
    return frames
end
local function validate(data)
    if type(data) ~= "table" or data.schema ~= Runtime.Schema or type(data.emitters) ~= "table"
        or #data.emitters < 1 or #data.emitters > 8 then error("无效的 UI 粒子数据版本或发射器数量") end
    local total = 0
    local function bound(n,lo,hi,integer)
        if not finite(n) or n < lo or n > hi or (integer and n%1 ~= 0) then error("粒子数据含有越界数值") end
    end
    local function point(p)
        if type(p) ~= "table" then error("粒子坐标无效") end
        bound(p.x,-5000,5000); bound(p.y,-5000,5000)
    end
    local function range(r,lo,hi)
        if type(r) ~= "table" then error("粒子随机范围无效") end
        bound(r.min,lo,hi); bound(r.max,lo,hi)
        if r.min > r.max then error("粒子随机范围颠倒") end
    end
    local function keys(k,maximum)
        if type(k) ~= "table" or #k < 2 or #k > 16 then error("粒子曲线无效") end
        for i=1,#k do
            bound(k[i].t,0,1); bound(k[i].value,0,maximum)
            if i>1 and k[i].t <= k[i-1].t then error("粒子曲线时间未严格递增") end
        end
        if k[1].t ~= 0 or k[#k].t ~= 1 then error("粒子曲线端点无效") end
    end
    for _,e in ipairs(data.emitters) do
        if type(e) ~= "table" or type(e.enabled) ~= "boolean" or type(e.loop) ~= "boolean" then error("发射器状态无效") end
        bound(e.maxParticles,1,512,true); total=total+e.maxParticles
        bound(e.seed,1,2147483646,true); bound(e.delay,0,60); bound(e.duration,.1,60)
        bound(e.rate,0,200); bound(e.burst,0,512,true)
        bound(e.angle,-360,360); bound(e.spread,0,360)
        bound(e.radius,0,2000); bound(e.width,0,4000); bound(e.height,0,4000)
        range(e.lifetime,.05,30); range(e.size,1,300); range(e.speed,0,2000)
        range(e.rotation,-360,360); range(e.spin,-720,720)
        point(e.origin); point(e.gravity); point(e.control1); point(e.control2); point(e.target)
        keys(e.sizeCurve,3); keys(e.alphaCurve,1)
        for _,color in ipairs({e.startColor,e.endColor}) do
            bound(color.r,0,255); bound(color.g,0,255); bound(color.b,0,255); bound(color.a,0,1)
        end
        if e.shape~="point" and e.shape~="circle" and e.shape~="ring" and e.shape~="box" then error("粒子形状无效") end
        if e.motion~="velocity" and e.motion~="bezier" then error("粒子运动类型无效") end
        if e.enabled then bound(e.imageId,1,2147483647,true) end
    end
    if total>1024 then error("粒子控件预算超过 1024") end
end
-- createImage(parent) is the version-specific factory. No guessing template IDs.
function Runtime.Create(root,data,createImage)
    validate(data)
    if not root or not root.alive or typeof(root)~="ClientUIContainerControl" then error("请将粒子脚本挂在有效的客户端容器控件上") end
    if type(createImage)~="function" then error("缺少图片控件创建函数") end
    local self={time=0,running=false,visible=true,destroyed=false,controls={},pools={},data=data,root=root}
    function self:Destroy()
        self.running=false; self.visible=false; self.destroyed=true
        local errors={}
        for i=#self.controls,1,-1 do
            local control=self.controls[i]
            local ok,message=pcall(function()
                if control.alive then game.DestroyClientUIControl(control) end
            end)
            if ok then table.remove(self.controls,i) else errors[#errors+1]=tostring(message) end
        end
        self.pools={}
        if #errors>0 then error("粒子清理失败："..table.concat(errors,"; ")) end
    end
    function self:Render()
        if self.destroyed then return end
        if not self.root.alive then self:Destroy(); return end
        for ei,e in ipairs(self.data.emitters) do
            local pool=self.pools[ei]
            if pool then
                local shown={}
                local frames=Runtime.Sample(e,self.time)
                for _,p in ipairs(frames) do
                    local image=pool[p.slot+1]
                    if not image.alive then error("粒子图片控件已失效") end
                    image:SetAnchoredPosition(p.x,p.y)
                    image:SetSizeDelta(p.size,p.size)
                    image:SetLocalRotation(0,0,p.rotation)
                    image.imageColor=Color.FromRGBA(p.color.r,p.color.g,p.color.b,p.color.a*255)
                    if image.visible~=self.visible then image:SetVisible(self.visible) end
                    shown[p.slot+1]=true
                end
                for slot,image in ipairs(pool) do
                    if not shown[slot] and image.alive and image.visible then image:SetVisible(false) end
                end
            end
        end
    end
    function self:Play() if not self.destroyed then self.running=true end end
    function self:Pause() self.running=false end
    function self:SetVisible(visible)
        if self.destroyed then return end
        self.visible=visible==true
        for _,image in ipairs(self.controls) do if image.alive then image:SetVisible(false) end end
        if self.visible then self:Render() end
    end
    function self:Seek(time)
        if self.destroyed then return end
        if not finite(time) or time<0 then error("粒子时间无效") end
        self.time=time; self:Render()
    end
    function self:Restart() self:Seek(0); self:Play() end
    function self:Update(dt)
        if self.destroyed or not self.running then return end
        if not finite(dt) or dt<0 then error("粒子更新时间无效") end
        self.time=self.time+dt; self:Render()
    end
    local ok,message=pcall(function()
        for ei,e in ipairs(data.emitters) do
            if e.enabled then
                local pool={}; self.pools[ei]=pool
                for slot=1,e.maxParticles do
                    local image=createImage(root)
                    if image==nil then error("图片控件实例化失败") end
                    self.controls[#self.controls+1]=image -- register immediately for rollback
                    if not image.alive or typeof(image)~="ClientUIImageControl" then error("创建模板的根控件必须是图片") end
                    image:SetVisible(false)
                    image.canControllerFocus=false
                    image:SetAnchorMin(.5,.5); image:SetAnchorMax(.5,.5); image:SetPivot(.5,.5)
                    image:SetLocalScale(1,1,1); image:SetLocalRotation(0,0,0)
                    image:SetImage(Enum.ImageSource.StaticReference,e.imageId)
                    image.imageType=Enum.ImageType.Basic
                    image.enableMask=false; image.enableSoftEdge=false; image:SetFillUnused()
                    if not image:SetAsLastSibling() then error("无法设置粒子层级") end
                    image:SetActive(true); pool[slot]=image
                end
            end
        end
        self:Render()
    end)
    if not ok then
        local cleaned,cleanup=pcall(function() self:Destroy() end)
        error(tostring(message)..(cleaned and "" or "; "..tostring(cleanup)))
    end
    return self
end
return Runtime`;


