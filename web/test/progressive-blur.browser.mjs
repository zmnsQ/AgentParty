const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const output=process.env.QA_OUTPUT_DIR||'/tmp/agentcommons-progressive-blur', origin=process.env.QA_ORIGIN||'http://127.0.0.1:4183';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const cases=[
 {width:320,height:568,lang:'zh',theme:'doodle'},
 {width:390,height:650,lang:'zh',theme:'doodle'},
 {width:430,height:740,lang:'en',theme:'midnight'},
 {width:390,height:650,lang:'zh',theme:'midnight'},
 {width:1280,height:800,lang:'en',theme:'doodle',desktop:true}
], results=[];
const inspect=(page,sel,pseudo='::after')=>page.locator(sel).evaluate((el,p)=>{
 const s=getComputedStyle(el,p);return {blur:s.backdropFilter||s.webkitBackdropFilter,
 mask:s.maskImage||s.webkitMaskImage, pointer:s.pointerEvents,display:s.display};
},pseudo);
try {for(const c of cases) {
 const context=await browser.newContext({viewport:{width:c.width,height:c.height},screen:{width:c.width,height:c.height},isMobile:!c.desktop,hasTouch:!c.desktop});
 const page=await context.newPage(),errors=[],writes=[];
 page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET')writes.push(route.request().url());
  await route.fulfill({json:{clients:[],policy:{enabled:true,allow_write:true,allow_events:true},can_configure:true,mcp_endpoint:'https://example.test/api/channels/qa-chat/mcp',configuration:{}}});
 });
 try {
  await page.goto(origin+'/test/fixtures/chat-first.html?lang='+c.lang+'&theme='+c.theme,{waitUntil:'domcontentloaded',timeout:85000});
  await page.locator('.composer-input').waitFor({timeout:60000});
  const size=await page.evaluate(()=>{
   const r=(s)=>document.querySelector(s).getBoundingClientRect().height;
   return {stream:r('.stream'),root:r('#root'),composer:r('.composer'),overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  assert.equal(size.overflow,false);
  if(!c.desktop)assert.ok(size.stream/size.root>=.68,'Chat viewport stays >=68%');
  const top=await inspect(page,'.presence-bar'),bottom=await inspect(page,'.composer','::before');
  for(const part of [top,bottom]){
   assert.equal(part.pointer,'none','Blur edge must not catch clicks');
   assert.ok(part.mask.includes('gradient'),'Gradient mask absent: '+JSON.stringify(part));
   assert.ok(part.blur.includes('blur('),'Backdrop-filter absent: '+JSON.stringify(part));
  }
  await page.evaluate(()=>{document.querySelector('.stream').scrollTop=900;});
  if(c.width===390&&c.theme==='doodle')await page.screenshot({path:join(output,'chat-390-light.png')});
  if(c.width===430)await page.screenshot({path:join(output,'chat-430-dark.png')});
  if(c.desktop){
   assert.ok((await inspect(page,'.app-head')).mask.includes('gradient'));
   await page.locator('.agent-join-btn').click();
  }else{
   await page.locator('.mobile-channel-more').click();
   const sheet=await inspect(page,'.mobile-channel-menu-scrim','::before');
   assert.equal(sheet.pointer,'none');assert.ok(sheet.mask.includes('gradient'));
   if(c.width===390&&c.theme==='doodle')await page.screenshot({path:join(output,'menu-390.png')});
   await page.locator('.mobile-channel-menu-scrim').click({position:{x:8,y:8}});
   assert.equal(await page.locator('.mobile-channel-menu-overlay').isVisible(),false);
   await page.locator('.mobile-channel-more').click();
   await page.locator('.mobile-channel-menu-sheet .agent-join-btn').click();
   assert.equal(await page.locator('.mobile-channel-menu-overlay').isVisible(),false);
  }
  assert.equal(await page.locator('.agent-join-overlay').evaluate(el=>el.parentElement.tagName),'BODY');
  const modal=await inspect(page,'.agent-join-scrim','::before');
  assert.equal(modal.pointer,'none');assert.ok(modal.mask.includes('gradient'));
  await page.locator('.agent-join-close').click({trial:true});
  if(c.width===390&&c.theme==='doodle')await page.screenshot({path:join(output,'join-390.png')});
  await page.locator('.agent-join-close').click();
  assert.equal(await page.locator('.agent-join-overlay').count(),0);
  if(!c.desktop){
   await page.locator('.presence-mobile-summary').click();
   await page.locator('.presence-roster-overlay .channel-panel-close').click({trial:true});
   await page.locator('.presence-roster-overlay .channel-panel-close').click();
   await page.locator('.mobile-group-toggle').click();
   assert.ok((await inspect(page,'.mobile-groups-scrim','::before')).mask.includes('gradient'));
   await page.locator('.mobile-groups-scrim').click({position:{x:c.width-6,y:10}});
   assert.equal(await page.locator('.mobile-groups-overlay').count(),0);
  }
  await page.locator('.composer-input').fill('synthetic QA only');
  await page.locator('.composer-send').click();
  assert.equal(await page.locator('.app').getAttribute('data-sent'),'1');
  // Gradient backdrops never blur foreground text or consume hit targets.
  assert.equal(await page.locator('.msg-body').first().evaluate(el=>getComputedStyle(el).filter),'none');
  if(c.width===390&&c.theme==='midnight'){
   await page.emulateMedia({forcedColors:'active'});
   const reduced=await inspect(page,'.composer','::before');
   assert.equal(reduced.blur,'none','Forced colors disable optical blur');
   assert.equal(reduced.mask,'none','Forced colors do not require masks');
   await page.emulateMedia({forcedColors:'none'});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  results.push({...c,top,bottom,size,passed:true});
  console.log('PASS',JSON.stringify({width:c.width,theme:c.theme,streamPct:Math.round(size.stream/size.root*100),composerHeight:size.composer}));
 }catch(error){
  results.push({...c,passed:false,error:String(error)});
  await page.screenshot({path:join(output,'failed-'+c.width+'-'+c.theme+'.png')}).catch(()=>{});
  console.error('FAIL',JSON.stringify(c),String(error));throw error;
 }finally{await context.close();}
}}finally{await writeFile(join(output,'report.json'),JSON.stringify(results,null,2));await browser.close();}
