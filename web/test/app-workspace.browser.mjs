/** Launch only against the local TEST FIXTURE entry, never a real account. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.QA_ORIGIN||'http://127.0.0.1:4173';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Local fixture origin required');
const output=process.env.QA_OUTPUT_DIR||'/tmp/app-workspace-qa';await mkdir(output,{recursive:true});
const browser=await chromium.launch();const results=[];
try {for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
 const context=await browser.newContext({viewport,isMobile:viewport.width<900,hasTouch:viewport.width<900});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(`${origin}/test/app-workspace-preview.html`);
  await page.waitForURL('**/c/fixture-0',{timeout:30000});
  await page.locator('.stream #msg-3').waitFor();
  assert.equal(await page.locator('.stream article[data-prototype-message]').count(),3);
  if(viewport.width>=900){
   await page.locator('.prototype-agent-avatar').first().waitFor();
   assert.equal(await page.locator('.prototype-agent-avatar').count(),2,'Channel identities must reach real App sidebar');
   await page.locator('.chan-pill').filter({hasText:'产品讨论'}).click();
   await page.waitForURL('**/c/fixture-1');
   await page.locator('.stream #msg-3').waitFor();
  } else {
   assert.ok(await page.locator('.mobile-group-toggle').isVisible(),'Real WorkspaceShell mobile header');
  }
  const requests=await page.evaluate(()=>window.__APP_WORKSPACE_FIXTURE__.requests);
  assert.ok(requests.some(x=>x.endsWith('/identities')),'Real Channel must load identities');
  assert.ok(requests.some(x=>x.endsWith('/messages')),'Real Channel must load messages');
  const width=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(width<=viewport.width+1,'No page overflow');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${output}/app-${viewport.width}x${viewport.height}.png`});
  results.push({viewport,passed:true,requests});
 }catch(error){results.push({viewport,passed:false,error:String(error),errors});await page.screenshot({path:`${output}/failed-${viewport.width}.png`});throw error;}
 finally{await context.close();}
}}finally{await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));await browser.close();}
