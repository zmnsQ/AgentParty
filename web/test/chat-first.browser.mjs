const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||"playwright");
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";import {join} from "node:path";
const output=process.env.QA_OUTPUT_DIR||"./artifacts/chat-first",origin=process.env.QA_ORIGIN||"http://127.0.0.1:4175";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({args:["--no-sandbox","--disable-dev-shm-usage"]}),results=[];
const cases=[{width:320,height:568,lang:"zh",theme:"doodle"},{width:390,height:650,lang:"zh",theme:"doodle"},{width:430,height:740,lang:"en",theme:"midnight"},{width:390,height:650,lang:"en",theme:"midnight"},{width:980,height:1633,screen:390,lang:"zh",theme:"doodle"},{width:1280,height:800,desktop:true,lang:"en",theme:"doodle"}];
try{for(const item of cases){
 const context=await browser.newContext({viewport:{width:item.width,height:item.height},screen:{width:item.screen||item.width,height:item.height},isMobile:!item.desktop,hasTouch:!item.desktop});
 const page=await context.newPage(),errors=[],writes=[];page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(90000);page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/**",async route=>{if(route.request().method()!=="GET")writes.push(route.request().method());await route.fulfill({json:{clients:[],native_client_id:null,native_authorized:false,policy:{enabled:true,allow_write:true,allow_events:true},can_configure:true,mcp_endpoint:"https://example.test/api/channels/qa-chat/mcp",configuration:{},personal_wake:{status:"requires_device_pairing"}}});});
 try{
  await page.goto(`${origin}/test/fixtures/chat-first.html?lang=${item.lang}&theme=${item.theme}`,{waitUntil:"domcontentloaded"});
  await page.locator(".composer-input").waitFor({timeout:60000});await page.waitForTimeout(150);
  const measure=()=>page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};return {viewport:{width:innerWidth,height:innerHeight},root:rect("#root"),stream:rect(".stream"),composer:rect(".composer"),input:rect(".composer-input"),overflow:document.documentElement.scrollWidth>innerWidth+1};});
  const geometry=await measure();assert.equal(geometry.overflow,false,"No page horizontal overflow");
  const ratio=geometry.stream.height/geometry.root.height;
  if(!item.desktop){
   assert.ok(ratio>=.68,`Messages must use >=68% of available viewport, got ${ratio}`);
   const scale=Number(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--ac-layout-scale")))||1;
   assert.ok(geometry.composer.height/scale<=72,`Empty real composer is compact: ${geometry.composer.height/scale}`);
   assert.equal(await page.locator(".composer-input").getAttribute("rows"),"1");
   assert.equal(await page.locator(".composer-secondary-actions").isVisible(),false);
   await page.locator(".mobile-channel-more").click();await page.locator(".mobile-channel-menu-sheet .agent-join-btn").click();
   assert.equal(await page.locator(".mobile-channel-menu-overlay").isVisible(),false);
  }else await page.locator(".agent-join-btn").click();
  await page.locator(".agent-join-overlay").waitFor();assert.equal(await page.locator(".agent-join-overlay").evaluate(e=>e.parentElement.tagName),"BODY");
  await page.locator("[data-coding-provider=codex]").click();await page.locator(".coding-advanced summary").click();await page.getByRole("button",{name:/打开已有连接的兼容向导|Open legacy connection guide/}).click();await page.locator(".agent-join-nameinput").fill("qa-only");await page.locator(".agent-join-actions button").click({trial:true});await page.locator(".agent-join-close").click();
  if(!item.desktop)await page.locator(".mobile-channel-more").click();await page.locator(".agent-join-btn").click();
  if(!await page.locator("[data-provider=muse]").count())await page.getByRole("button",{name:/返回|Back|重新选择/}).click();
  await page.locator("[data-provider=muse]").click();await page.locator(".muse-endpoint input").first().waitFor();await page.locator(".channel-panel-close").click();
  if(!item.desktop){
   await page.locator(".mobile-channel-more").click();await page.locator(".mobile-channel-menu-sheet").getByRole("button",{name:"任务",exact:true}).click();await page.locator(".channel-panel-close").click();
   await page.locator(".presence-mobile-summary").click();await page.locator(".presence-roster-card").getByRole("button",{name:"Host 0 · 1 项告警"}).click();assert.equal(await page.locator(".presence-roster-overlay").count(),0);await page.locator(".channel-panel-close").click();
   await page.locator(".mobile-group-toggle").click();await page.locator(".mobile-groups-drawer [data-test=settings]").click();await page.getByRole("tab",{name:"我的 Agent",exact:true}).click();await page.locator(".settings-close").click();
   await page.locator(".composer-more").click();await page.locator(".composer-paste").click();assert.equal(await page.locator(".composer-input").inputValue(),"synthetic pasted text");
   assert.equal(await page.locator(".composer-secondary-actions").isVisible(),false);
   await page.locator(".composer-more").click();const choose=page.waitForEvent("filechooser");await page.locator(".composer-attach").click();await (await choose).setFiles({name:"fixture.txt",mimeType:"text/plain",buffer:Buffer.from("synthetic")});assert.equal(await page.locator(".app").getAttribute("data-picked"),"1");
  }
  await page.locator(".composer-input").fill("test message");await page.locator(".composer-send").click();assert.equal(await page.locator(".app").getAttribute("data-sent"),"1");assert.equal(await page.locator(".composer-input").inputValue(),"");
  await page.locator(".composer-input").fill("@qa");await page.locator(".mention-item").first().click();assert.ok((await page.locator(".composer-input").inputValue()).includes("@qa-helper"));
  await page.locator(".composer-input").fill(Array(20).fill("A long draft line").join("\n"));
  const long=await measure();// Desktop keeps its existing 40vh draft cap; phones have the stricter chat-first budget.
  assert.ok(long.stream.height>(item.desktop?40:geometry.root.height*.45),"Long draft still leaves a usable message scroll region");
  await page.locator(".composer-input").fill("");await page.locator(".composer-input").blur();
  await page.evaluate(()=>{document.querySelector(".stream").scrollTop=0;});
  await page.screenshot({path:join(output,`chat-${item.width}-${item.lang}-${item.theme}.png`)});
  if(!item.desktop){await page.locator(".mobile-channel-more").click();await page.screenshot({path:join(output,`menu-${item.width}-${item.lang}.png`)});await page.locator(".mobile-channel-menu-sheet>header button").click();await page.setViewportSize({width:item.width,height:Math.round(400*(item.screen?item.width/item.screen:1))});await page.locator(".composer-input").fill("short viewport");await page.locator(".composer-send").click({trial:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[],"Opening navigation does not create tokens or grants");
  const result={...item,messagePercent:Math.round(ratio*1000)/10,geometry,passed:true};results.push(result);console.log("PASS",JSON.stringify({...item,messagePercent:result.messagePercent,composerHeight:geometry.composer.height}));
 }catch(error){console.error("FAIL",item,String(error));await page.screenshot({path:join(output,`failed-${item.width}.png`)}).catch(()=>{});results.push({...item,passed:false,error:String(error)});throw error;}finally{await context.close();}
}}finally{await writeFile(join(output,"results.json"),JSON.stringify(results,null,2));await browser.close();}
