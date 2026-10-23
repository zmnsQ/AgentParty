const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||"playwright");
import assert from "node:assert/strict";
import {writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";
const output=process.env.QA_OUTPUT_DIR||"./artifacts/mobile";
const origin=process.env.QA_ORIGIN||"http://127.0.0.1:4173";
await mkdir(output,{recursive:true});
const browser=await chromium.launch({args:["--no-sandbox","--disable-dev-shm-usage"]}),results=[];
const cases=[{width:320,lang:"zh",theme:"doodle"},{width:390,lang:"zh",theme:"doodle"},{width:430,lang:"en",theme:"midnight"},{width:390,lang:"en",theme:"midnight"},{width:980,screen:390,lang:"zh",theme:"doodle"},{width:1280,lang:"en",theme:"doodle",desktop:true}];
try{for(const item of cases){
 const context=await browser.newContext({viewport:{width:item.width,height:844},screen:{width:item.screen||item.width,height:844},isMobile:!item.desktop,hasTouch:!item.desktop});
 const page=await context.newPage(),errors=[],writes=[];page.setDefaultTimeout(10000);console.log("START",item.width);page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/api/**",async route=>{if(route.request().method()!=="GET")writes.push(route.request().method()+" "+new URL(route.request().url()).pathname);await route.fulfill({json:{clients:[],native_client_id:null,native_authorized:false,policy:{enabled:true,allow_write:true,allow_events:true},can_configure:true,mcp_endpoint:"https://example.test/api/channels/qa-mobile/mcp",configuration:{},personal_wake:{status:"requires_device_pairing"}}});});
 try{
  await page.goto(`${origin}/test/fixtures/mobile-interaction.html?lang=${item.lang}&theme=${item.theme}`);
  await page.locator(".agent-join-btn").waitFor({timeout:60000});console.log("LOADED",item.width);
  if(!item.desktop){
   await page.locator(".mobile-group-toggle").click();await page.locator(".mobile-groups-drawer .chan-pill").first().click();
   assert.equal(await page.locator(".mobile-groups-overlay").count(),0);
  }
  const geometry=await page.evaluate(()=>({width:innerWidth,screenWidth:screen.width,scroll:document.documentElement.scrollWidth,layout:getComputedStyle(document.querySelector(".app-shell")).display}));
  assert.ok(geometry.scroll<=geometry.width+1,"No page horizontal overflow");
  if(!item.desktop)assert.equal(geometry.layout,"flex","Phone uses one column even with desktop viewport");
  if(item.screen){const box=await page.locator(".agent-join-btn").boundingBox();assert.ok(box.height>=44*item.width/item.screen-1,"Desktop-mode phone targets retain physical touch size");await page.screenshot({path:join(output,"after-desktop-mode-phone.png")});}
  if(item.width===390&&item.lang==="zh")await page.screenshot({path:join(output,"after-chat-390.png")});
  // Regression stress: clipping/transforms on toolbar must never capture dialogs.
  await page.evaluate(()=>{const x=document.querySelector(".chan-toolstrip");x.style.transform="translateZ(0)";x.style.contain="paint";});
  await page.locator(".agent-join-btn").click();
  assert.equal(await page.locator(".agent-join-overlay").evaluate(e=>e.parentElement.tagName),"BODY");
  const close=page.locator(".agent-join-close");await close.click({trial:true});
  await page.locator("[data-coding-provider=codex]").click();await page.locator(".coding-advanced summary").click();await page.getByRole("button",{name:/打开已有连接的兼容向导|Open legacy connection guide/}).click();
  await page.locator(".agent-join-nameinput").fill("qa-codex");
  await page.locator(".agent-join-actions button").click({trial:true});
  await close.click();assert.equal(await page.locator(".agent-join-overlay").count(),0);
  await page.locator(".agent-join-btn").click();
  if(await page.locator("[data-provider=muse]").count()===0)await page.getByRole("button",{name:/返回|Back/}).click();
  await page.locator("[data-provider=muse]").click();
  assert.equal(await page.locator(".channel-panel-overlay").evaluate(e=>e.parentElement.tagName),"BODY");
  await page.locator(".muse-endpoint input").first().waitFor();assert.equal(await page.locator(".muse-endpoint input").first().inputValue(),"https://example.test/api/channels/qa-mobile/mcp");
  await page.locator(".muse-native-client summary").click();
  await page.getByRole("button",{name:/准备 Muse Client ID|Prepare Muse Client ID/}).click({trial:true});
  await page.locator(".muse-native-check summary").click();
  await page.locator(".muse-native-check textarea").scrollIntoViewIfNeeded();
  await page.locator(".channel-panel-close").click({trial:true});
  if(item.width===390&&item.lang==="zh")await page.screenshot({path:join(output,"after-muse-390.png")});
  await page.locator(".channel-panel-close").click();
  await page.locator("[data-test=settings]").click();await page.getByRole("tab",{name:"安全",exact:true}).click();
  assert.equal(await page.getByRole("tab",{name:"安全",exact:true}).getAttribute("aria-selected"),"true");
  await page.locator(".settings-close").click();
  if(!item.desktop){await page.setViewportSize({width:item.width,height:480});await page.locator(".composer-input").fill("keyboard-size smoke test");await page.locator(".composer-actions .d-btn--primary").click({trial:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[],"Opening or choosing a provider must not create tokens/clients");
  results.push({...item,...geometry,passed:true,verified:["drawer", "no page overflow", "portal", "coding flow", "Muse endpoint", "settings", "small height", "no implicit writes"]});console.log("PASS",JSON.stringify(results.at(-1)));
 }catch(error){console.error("ORIGINAL_ERROR",String(error));await page.screenshot({path:join(output,`failed-${item.width}.png`)}).catch(()=>{});results.push({...item,passed:false,error:String(error)});console.log("FAIL",item.width,String(error));throw error;}finally{await context.close();}
}}finally{await writeFile(join(output,"interactions.json"),JSON.stringify(results,null,2));await browser.close();}
