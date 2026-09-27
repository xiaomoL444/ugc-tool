/* Local browser integration: npm run serve -- --port 8088, then
 * PARTICLE_PLAYWRIGHT=<playwright module path> node scripts/test-ui-particles-browser.cjs
 * Uses an isolated headless Edge context; never touches the user's browser profile.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const JSZip=require("jszip");
const {chromium}=require(process.env.PARTICLE_PLAYWRIGHT || "playwright");
const output=path.resolve(__dirname,"../node_modules/.cache/ui-particle-qa");
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:process.env.PARTICLE_BROWSER || "msedge",headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage();
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 try {
  const loaded=page.waitForResponse(r=>r.url().includes("/sprite/100002.png"),{timeout:60000});
  await page.goto(process.env.PARTICLE_URL || "http://127.0.0.1:8088/UIVfxEditor",{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  await (await loaded).finished();
  const timeline=page.getByRole("slider",{name:"预览时间",exact:true});
  await timeline.fill("1.2");
  assert.ok(await page.locator(".particle-layer image").count()>0);
  const frame=await page.locator(".particle-layer > g").evaluateAll(nodes=>nodes.map(n=>n.getAttribute("transform")));
  await timeline.fill("4.2"); await timeline.fill("1.2");
  assert.deepEqual(await page.locator(".particle-layer > g").evaluateAll(nodes=>nodes.map(n=>n.getAttribute("transform"))),frame);
  console.log("PASS loaded OSS sprites, pause and deterministic seeking");

  await page.getByRole("button",{name:"打开图片库 ↗",exact:true}).click();
  const library=page.getByRole("dialog",{name:"图片资源库",exact:true});
  await library.getByRole("textbox",{name:"搜索图片资源",exact:true}).fill("100001");
  await library.getByRole("button",{name:"选择图片 100001",exact:true}).click();
  assert.ok((await page.locator(".image-card").innerText()).includes("#100001"));
  await page.getByRole("button",{name:"打开图片库 ↗",exact:true}).click();
  await library.getByRole("textbox",{name:"搜索图片资源",exact:true}).fill("100002");
  await library.getByRole("button",{name:"选择图片 100002",exact:true}).click();
  console.log("PASS shared image library search and resource selection");

  await page.getByRole("button",{name:/金币汇聚/}).click();
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  await timeline.fill("1.1");
  const control=page.locator(".drag-handle circle").first();
  const before=Number(await page.getByRole("spinbutton",{name:"P1 X",exact:true}).inputValue());
  const box=await control.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2-20,{steps:5});await page.mouse.up();
  assert.ok(Number(await page.getByRole("spinbutton",{name:"P1 X",exact:true}).inputValue())>before);
  await page.locator(".inspector-scroll").evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const curve=page.locator(".curve-editor").first(),graph=curve.locator("svg");
  const oldCount=await graph.locator("circle").count(),gb=await graph.boundingBox();
  await graph.dblclick({position:{x:gb.width*.48,y:gb.height*.55}});
  assert.equal(await graph.locator("circle").count(),oldCount+1);
  await curve.getByRole("button",{name:"删除点",exact:true}).click();
  assert.equal(await graph.locator("circle").count(),oldCount);
  console.log("PASS Bezier handle drag and lifetime key insertion/deletion");

  await page.getByRole("button",{name:"添加发射器",exact:true}).click();
  assert.equal(await page.locator(".emitter-row").count(),2);
  await page.getByRole("button",{name:"复制",exact:true}).click();
  assert.equal(await page.locator(".emitter-row").count(),3);
  await page.getByRole("button",{name:"发射器上移",exact:true}).click();
  await page.getByRole("button",{name:"删除",exact:true}).click();
  assert.equal(await page.locator(".emitter-row").count(),2);
  await page.getByRole("button",{name:"撤回替换",exact:true}).click();
  assert.equal(await page.locator(".emitter-row").count(),3);
  console.log("PASS emitter add/duplicate/reorder/delete and recovery");

  const save=page.waitForEvent("download");
  await page.getByRole("button",{name:"导出 JSON",exact:true}).click();
  const jsonFile=await save;
  await jsonFile.saveAs(path.join(output,"roundtrip.json"));
  const data=JSON.parse(fs.readFileSync(path.join(output,"roundtrip.json"),"utf8"));
  assert.equal(data.emitters.length,3);
  await page.locator("input[type=file]").setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from('{"schema":"bad"}')});
  assert.ok((await page.getByRole("status").innerText()).includes("导入失败"));
  assert.equal(await page.locator(".emitter-row").count(),3);
  data.name="浏览器回归工程";
  await page.locator("input[type=file]").setInputFiles({name:"valid.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(data))});
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  assert.equal(await page.getByRole("textbox",{name:"工程名称",exact:true}).inputValue(),data.name);
  await page.locator(".project-name").getByRole("button",{name:"重命名",exact:true}).click();
  const renameDialog=page.getByRole("dialog",{name:"重命名特效文件",exact:true});
  await renameDialog.getByRole("textbox",{name:"名称",exact:true}).fill("自动保存回归");
  await renameDialog.getByRole("button",{name:"确认",exact:true}).click();
  await renameDialog.waitFor({state:"hidden"});
  // Wait for the debounced autosave, then prove it via a real reload (no storage inspection).
  await page.waitForTimeout(600);
  await page.reload({waitUntil:"domcontentloaded"});
  assert.equal(await page.getByRole("textbox",{name:"工程名称",exact:true}).inputValue(),"自动保存回归");
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  console.log("PASS JSON download/import, invalid import isolation and autosave reload");

  await page.getByRole("button",{name:"导出 Lua ↗",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"导出千星 UI 粒子",exact:true});
  await dialog.getByRole("spinbutton",{name:"图片控件模板索引",exact:true}).fill("7");
  const bundle=page.waitForEvent("download");
  await dialog.getByRole("button",{name:"下载接入包 ZIP ↗",exact:true}).click();
  const zipFile=await bundle;await zipFile.saveAs(path.join(output,"export.zip"));
  const zip=await JSZip.loadAsync(fs.readFileSync(path.join(output,"export.zip")));
  assert.deepEqual(Object.keys(zip.files).sort(),["ParticleEffect.lua","project.json","接入说明.md"].sort());
  assert.match(await zip.file("ParticleEffect.lua").async("string"),/IMAGE_CONTROL_TEMPLATE_INDEX = 7/);
  await dialog.getByRole("button",{name:"关闭导出",exact:true}).click();
  await page.getByRole("button",{name:"打开图片库 ↗",exact:true}).click();
  await library.getByRole("button",{name:"不使用图片",exact:true}).click();
  await page.getByRole("button",{name:"导出 Lua ↗",exact:true}).click();
  assert.ok(await dialog.getByRole("button",{name:"下载接入包 ZIP ↗",exact:true}).isDisabled());
  await dialog.getByRole("button",{name:"关闭导出",exact:true}).click();
  console.log("PASS ZIP content, configured template and missing-resource export guard");

  await page.getByRole("button",{name:/金币汇聚/}).click();
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  await timeline.fill("1.2");
  await page.getByRole("button",{name:"关闭提示",exact:true}).click();
  await page.screenshot({path:path.join(output,"bezier-editor.png"),fullPage:true});
  await page.setViewportSize({width:1024,height:768});
  assert.equal(await page.locator(".particle-editor").evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.screenshot({path:path.join(output,"compact-editor.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator(".particle-editor").evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.screenshot({path:path.join(output,"mobile-editor.png"),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("PASS desktop/compact/mobile layouts and no page errors");
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

