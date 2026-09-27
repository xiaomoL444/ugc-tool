/* Run with PARTICLE_PLAYWRIGHT pointing to Playwright; local server defaults to :8088. */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {chromium}=require(process.env.PARTICLE_PLAYWRIGHT || "playwright");
(async()=>{
 const browser=await chromium.launch({channel:process.env.PARTICLE_BROWSER || "msedge",headless:true});
 const page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true});
 const output=path.resolve(__dirname,"../node_modules/.cache/ui-particle-qa");fs.mkdirSync(output,{recursive:true});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const panel=page.getByRole("dialog",{name:"工作区与编辑文件",exact:true});
 async function open(){if(!await panel.isVisible())await page.getByRole("button",{name:"管理工作区和编辑文件",exact:true}).click();}
 async function nameDialog(title,name){
  const dialog=page.getByRole("dialog",{name:title,exact:true});
  await dialog.getByRole("textbox",{name:"名称",exact:true}).fill(name);
  await dialog.getByRole("button",{name:"确认",exact:true}).click();
  await dialog.waitFor({state:"hidden"});
 }
 async function field(value){const input=page.getByRole("spinbutton",{name:"每秒发射",exact:true});await input.fill(String(value));await input.press("Tab");}
 async function selectFile(name){await panel.locator(".document-row").filter({has:page.getByText(name,{exact:true})}).click();await panel.waitFor({state:"hidden"});}
 async function selectWorkspace(name){await panel.getByRole("group",{name:"工作区列表",exact:true}).getByRole("button",{name,exact:true}).click();await page.waitForFunction(value=>Array.from(document.querySelectorAll(".workspace-list button")).some(el=>el.textContent.trim()===value && el.getAttribute("aria-pressed")==="true"),name);}
 async function expectRate(value){assert.equal(Number(await page.getByRole("spinbutton",{name:"每秒发射",exact:true}).inputValue()),value);}
 async function remove(title){const dialog=page.getByRole("dialog",{name:title,exact:true});await dialog.getByRole("button",{name:"移至回收站",exact:true}).click();await dialog.waitFor({state:"hidden"});}
 try {
  await page.goto(process.env.PARTICLE_URL || "http://127.0.0.1:8088/UIVfxEditor",{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  await page.locator(".project-name").getByRole("button",{name:"重命名",exact:true}).click();
  await nameDialog("重命名特效文件","星光 A");
  await field(17.5);await open();
  assert.equal(await panel.getByRole("button",{name:"导入 GIA",exact:true}).count(),0);
  await panel.getByRole("button",{name:"新建文件",exact:true}).click();
  await nameDialog("新建特效文件","汇聚 B");
  await expectRate(28);await field(36);
  await open();await selectFile("星光 A");await expectRate(17.5);
  await open();await selectFile("汇聚 B");await expectRate(36);
  console.log("PASS switch-before-debounce flushes the correct file; files preserve separate particle data");

  await open();await panel.getByRole("button",{name:"新建工作区",exact:true}).click();
  await nameDialog("新建工作区","收集特效");
  assert.equal(await panel.locator(".document-row").count(),0);
  await panel.getByRole("button",{name:"新建文件",exact:true}).click();
  await nameDialog("新建特效文件","星光 A");
  await field(63);
  await open();await selectWorkspace("默认工作区");await selectFile("星光 A");await expectRate(17.5);
  await open();await selectWorkspace("收集特效");await selectFile("星光 A");await expectRate(63);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"暂停预览",exact:true}).click();
  assert.match(await page.locator(".current-file").innerText(),/收集特效/);
  assert.equal(await page.getByRole("textbox",{name:"工程名称",exact:true}).inputValue(),"星光 A");
  await expectRate(63);
  console.log("PASS workspace isolation, same file names, and restoring last selection after reload");

  await open();await panel.getByRole("complementary",{name:"工作区管理",exact:true}).getByRole("button",{name:"重命名",exact:true}).click();
  const rename=page.getByRole("dialog",{name:"重命名工作区",exact:true});
  await rename.getByRole("textbox",{name:"名称",exact:true}).fill("非法/名称");
  await rename.getByRole("button",{name:"确认",exact:true}).click();
  await rename.getByRole("alert").waitFor();
  await nameDialog("重命名工作区","收藏特效");
  await panel.getByRole("button",{name:"关闭工作区面板",exact:true}).click();
  await expectRate(63);
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"导出 JSON",exact:true}).click();
  const file=await download;await file.saveAs(path.join(output,"workspace-import.json"));
  await page.locator("input[type=file]").setInputFiles(path.join(output,"workspace-import.json"));
  await page.waitForFunction(()=>document.querySelector(".current-file span")?.textContent==="星光 A (2)");
  await expectRate(63);
  await open();assert.equal(await panel.locator(".document-row").count(),2);
  await page.screenshot({path:path.join(output,"particle-workspaces.png"),fullPage:true});
  await panel.getByRole("button",{name:"删除文件",exact:true}).click();await remove("删除特效文件");
  assert.equal(await panel.locator(".document-row").count(),1);
  await panel.getByRole("button",{name:"关闭工作区面板",exact:true}).click();
  await page.getByRole("button",{name:"已移至回收站 · 撤销删除",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".current-file span")?.textContent==="星光 A (2)");
  await expectRate(63);
  console.log("PASS invalid-name protection, rename, non-destructive import and file recycle/restore");

  await open();await panel.getByRole("button",{name:"删除工作区",exact:true}).click();await remove("删除工作区");
  assert.equal(await panel.getByRole("group",{name:"工作区列表",exact:true}).getByRole("button",{name:"收藏特效",exact:true}).count(),0);
  await panel.getByRole("button",{name:"关闭工作区面板",exact:true}).click();
  await page.getByRole("button",{name:"已移至回收站 · 撤销删除",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".current-file strong")?.textContent==="收藏特效");
  await expectRate(63);
  await page.screenshot({path:path.join(output,"particle-workspace-toolbar.png"),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("PASS workspace recycle/restore and no page errors");
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});


