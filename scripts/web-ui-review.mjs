/** Reproducible browser checks against web-ui-fixture.ts only.
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node scripts/web-ui-review.mjs
 * Playwright is a review tool, not a production dependency. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out=resolve(process.env.QA_OUTPUT_DIR ?? 'docs/ui-review/2026-10-24');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',recordVideo:{dir:out+'/motion',size:{width:1440,height:1000}}});
const external=[],errors=[],writes=[],checks=[],motion={};let completed=false;
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.hostname==='127.0.0.1'&&u.port==='18950'){if(!['GET','HEAD'].includes(route.request().method())){writes.push(u.pathname);return route.fulfill({status:403,json:{error:{code:'synthetic_review_read_only'}}});}return route.continue();}
 external.push(u.origin);await route.abort();
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('ap_locale','zh');if(localStorage.getItem('local_ui_review_initialized')!=='1'){localStorage.setItem('ap_onboarded','1');localStorage.setItem('local_ui_review_initialized','1');}});
async function settle(){await page.waitForTimeout(380);}
async function shot(name){await settle();await page.screenshot({path:out+'/'+name+'.png'});}
async function noOverflow(label){assert.equal(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)>innerWidth+1),false,label);checks.push(label);}
async function openTools(){const mobile=page.locator('.mobile-channel-more');if(await mobile.isVisible()){if(await mobile.getAttribute('aria-expanded')==='false')await mobile.click();await page.locator('.mobile-channel-menu-overlay').waitFor({state:'visible'});return page.locator('.mobile-channel-menu-body');}const t=page.locator('.chan-toolstrip-toggle');if(await t.getAttribute('aria-expanded')==='false'){await t.click();await settle();}return page.locator('.chan-toolstrip-content');}
async function closeDialog(){await page.keyboard.press('Escape');await settle();}
try{
 await page.goto('http://127.0.0.1:18950/');await page.getByRole('link',{name:'使用 GitHub 登录'}).waitFor();
 assert.equal(await page.locator('.commons-brand img').getAttribute('src'),'/brand/mark.png');
 await shot('login-desktop');await page.setViewportSize({width:390,height:844});await shot('login-mobile');await noOverflow('login mobile has no page overflow');
 await page.locator('.browser-auth-advanced summary').click();assert.equal(await page.locator('#ap-token').isVisible(),true);await page.locator('.browser-auth-advanced summary').click();
 checks.push('GitHub remains primary; legacy credentials are discoverable');
 await page.route('**/api/auth/github/session',r=>r.fulfill({json:{configured:true,status:'mfa_required'}}));
 await page.reload();await page.getByRole('heading',{name:'二步验证'}).waitFor();await shot('mfa-mobile');await page.setViewportSize({width:1440,height:1000});await shot('mfa-desktop');await page.unroute('**/api/auth/github/session');
 checks.push('MFA remains a separate verification gate');
 await page.evaluate(()=>localStorage.setItem('ap_token','local-synthetic-review'));
 await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('.home-card').first().waitFor();await shot('home-desktop');
 await page.locator('.studio-search input').fill('不存在的群组');assert.equal(await page.locator('.home-card').count(),0);await shot('home-search-empty');await page.locator('.studio-search input').fill('');
 const toggle=page.locator('.workspace-nav-desktop');
 await toggle.click();motion.navigationTransitions=await page.locator('.workspace-shell').evaluate(el=>el.getAnimations().map(a=>({property:a.transitionProperty,duration:a.effect?.getTiming().duration})));
 await settle();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('.workspace-nav-body button').first().evaluate(el=>{el.focus();return document.activeElement===el}),false);
 await page.reload();await page.locator('.home-card').first().waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await shot('home-collapsed');
 checks.push('navigation collapses, excludes hidden controls from focus and survives reload');
 await toggle.click();await settle();await page.locator('.home-card').first().click();await page.locator('.msg-card').first().waitFor();await shot('chat-desktop');
 await page.locator('.composer-input').fill('保留草稿：你好，协作伙伴。');
 await openTools();assert.equal(await page.locator('.composer-input').inputValue(),'保留草稿：你好，协作伙伴。');
 motion.drawerTransitions=await page.locator('.animated-disclosure').evaluate(el=>({duration:getComputedStyle(el).transitionDuration,grid:getComputedStyle(el).gridTemplateRows}));
 await shot('tools-desktop');
 for(const [label,name] of [['任务','tasks'],['团队','team'],['协作空间','connections']]){
  await page.locator('.chan-toolstrip-content button').filter({hasText:label}).first().click();await page.locator('[role=dialog]').waitFor();await shot(name+'-desktop');
  for(let i=0;i<12;i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role=dialog]')),true);
  if(name==='tasks'){
   assert.equal(await page.locator('.task-card').count(),2);await page.setViewportSize({width:390,height:844});await shot('tasks-mobile');await noOverflow('tasks mobile has no page overflow');await page.setViewportSize({width:1440,height:1000});
  }
  if(name==='connections'){
   assert.equal(await page.locator('.commons-error').filter({hasText:'AbortError'}).count(),0);
   const overview=await page.locator('.connector-presence-overview').innerText();
   assert.match(overview,/OAuth 已授权/);assert.match(overview,/尚未订阅/);assert.match(overview,/未保持 WebSocket 长连接/);assert.doesNotMatch(overview,/已有事件订阅/);checks.push('OAuth authorization, event subscription and persistent socket presence stay distinct');
   for(const [tab,n] of [['共享文件','files'],['代码协作','repository'],['直连 Agent','direct-agents']]){await page.getByRole('tab',{name:tab}).click();await shot(n+'-desktop');}
   await page.getByRole('tab',{name:'代码协作'}).click();await page.locator('.commons-proposal-card').first().waitFor();await page.locator('.commons-proposal-card').first().click();await page.locator('.commons-review .commons-diff').waitFor();await page.locator('.commons-review .commons-diff').scrollIntoViewIfNeeded();await shot('proposal-desktop');
   await page.setViewportSize({width:390,height:844});await page.locator('.commons-review .commons-diff').scrollIntoViewIfNeeded();await shot('proposal-mobile');await noOverflow('proposal mobile has no page overflow');await page.setViewportSize({width:1440,height:1000});
   await page.getByRole('tab',{name:'连接与使用'}).click();await page.setViewportSize({width:390,height:844});await shot('connections-mobile');await noOverflow('connections mobile has no page overflow');await page.setViewportSize({width:1440,height:1000});
  }
  await closeDialog();
 }
 checks.push('tasks, team, connections, files, repository and direct agent panels render');
 await page.locator('.app-settings-btn').click();await shot('settings-desktop');await page.setViewportSize({width:390,height:844});await shot('settings-mobile');
 await page.getByRole('button',{name:'Studio · 温暖深色'}).click();await shot('settings-dark-mobile');await closeDialog();await page.locator('.composer-input').fill('');await shot('chat-dark-mobile');await noOverflow('chat mobile has no page overflow');
 const mobileTools=await openTools();await shot('tools-mobile');await mobileTools.locator('button').filter({hasText:'任务'}).first().click();await page.locator('.task-card').first().waitFor();assert.equal(await page.locator('.mobile-channel-menu-overlay').isVisible(),false);assert.equal(await page.locator('.task-card').count(),2);await closeDialog();checks.push('mobile more menu opens tasks and hands focus to the panel');
 await page.locator('.mobile-group-toggle').click();await page.locator('.mobile-groups-overlay').waitFor();await shot('navigation-mobile');await page.locator('.mobile-groups-content .chan-pill').filter({hasText:'产品与设计'}).click();await settle();assert.equal(await page.locator('.mobile-group-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.mobile-groups-overlay').count(),0);checks.push('mobile navigation closes after a group switch');
 await page.locator('.mobile-group-toggle').click();await page.locator('.mobile-drawer-actions button').filter({hasText:'设置'}).first().click();await page.locator('.settings-panel').waitFor();assert.equal(await page.locator('.mobile-groups-overlay').count(),0);await closeDialog();checks.push('mobile group drawer opens settings without leaving a second modal');
 await page.setViewportSize({width:1440,height:1000});await shot('chat-dark-desktop');
 await page.emulateMedia({reducedMotion:'reduce'});motion.reduced=await page.locator('.workspace-shell').evaluate(el=>({transition:getComputedStyle(el).transitionDuration,animation:getComputedStyle(el).animationName}));assert.equal(motion.reduced.transition,'0s');checks.push('reduced motion disables layout transitions');
 await page.locator('.app-logo').click();await shot('home-dark-desktop');
 await page.route('**/api/channels',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({channels:[]})}));
 await page.reload();await page.locator('.studio-empty-group').waitFor();await shot('home-empty');checks.push('empty workspace has a clear first action');
 await page.unroute('**/api/channels');
 await page.route('**/api/channels',async r=>{await new Promise(resolve=>setTimeout(resolve,900));await r.continue();});
 await page.reload();await page.locator('.studio-skeleton-card').first().waitFor();await page.screenshot({path:out+'/home-loading.png'});await page.locator('.home-card').first().waitFor();
 await page.unroute('**/api/channels');
 await page.route('**/api/channels',async r=>{const response=await r.fetch();const data=await response.json();data.channels[0].title='一起打磨工作区：长名称与 ContinuousCollaborationWorkspaceWithoutSpaces 的排版验证';await r.fulfill({json:data});});
 await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('.home-card').first().waitFor();await shot('home-long-title-mobile');await noOverflow('long group titles do not cause page overflow');
 await page.unroute('**/api/channels');
 await page.evaluate(()=>localStorage.removeItem('ap_onboarded'));await page.reload();await page.locator('.onboarding-overlay').waitFor();await shot('onboarding-mobile');await page.locator('.onboarding-close').click();checks.push('onboarding is scrollable and can be dismissed on mobile');
 await page.setViewportSize({width:1440,height:1000});
 await page.route('**/api/channels',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'fixture_unavailable'}})}));
 await page.evaluate(()=>localStorage.setItem('commons.navigation.collapsed','1'));await page.reload();await page.locator('.workspace-navigation-error').waitFor();await shot('groups-error-collapsed');checks.push('group loading failure stays visible with navigation collapsed');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);checks.push('no uncaught browser errors, external network requests or write requests');
 await writeFile(out+'/browser-results.json',JSON.stringify({checks,motion,errors,external,writes,viewport:[1440,1000,390,844]},null,2));
 console.log(JSON.stringify({checks,motion},null,2));completed=true;
}catch(error){await page.screenshot({path:out+'/failed-current-page.png'}).catch(()=>{});await writeFile(out+'/failed-results.json',JSON.stringify({error:String(error),checks,motion,errors,external,writes,url:page.url()},null,2));throw error;}finally{await context.close();if(completed&&page.video()){await page.video().saveAs(out+"/walkthrough.webm");await unlink(await page.video().path());}await browser.close();}
