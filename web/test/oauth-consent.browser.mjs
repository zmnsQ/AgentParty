// Native form interaction using the actual server-rendered OAuth document.
// Network is fulfilled in memory: no real account, consent or external callback.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";
import {renderOAuthConsent,renderOAuthGroupChoice} from "../../worker/src/collaboration/oauth-pages.ts";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||"playwright");
const output=process.env.QA_OUTPUT_DIR||"./artifacts/mobile";await mkdir(output,{recursive:true});
const css=await readFile(new URL("../public/commons-consent.css",import.meta.url),"utf8");
const browser=await chromium.launch({args:["--no-sandbox","--disable-dev-shm-usage"]}),results=[];
try{for(const width of [320,390,430]){
 const page=await browser.newPage({viewport:{width,height:640},isMobile:true,hasTouch:true}),posts=[];
 const presentation={locale:width===430?"en":"zh",theme:width===430?"midnight":"doodle"};
 const resource="https://qa.example/api/channels/qa-group/mcp";
 const params={client_id:"accli_"+"a".repeat(64),redirect_uri:"https://agent.meta.ai/api/hatch/oauth/callback",response_type:"code",scope:"group.read group.write",state:"opaque+state/value=",code_challenge:"c".repeat(43),code_challenge_method:"S256"};
 const consent={id:"request_"+"a".repeat(64),nonce:"b".repeat(64),clientName:"Muse native MCP",group:"qa-group",groupTitle:"移动端授权测试",scopes:["group.read","group.write","group.events"],account:"synthetic-owner",login:"synthetic-owner",redirectUri:params.redirect_uri};
 await page.route("https://qa.example/commons-consent.css*",route=>route.fulfill({contentType:"text/css",body:css}));
 await page.route("https://qa.example/oauth/authorize**",async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==="POST"){
   assert.equal(request.headers().origin,"https://qa.example");
   const form=new URLSearchParams(request.postData());assert.equal(form.get("decision"),"approve");assert.equal(form.get("nonce"),consent.nonce);posts.push("approve");
   await route.fulfill({contentType:"text/html",body:"<p id=qa-complete>Native form submitted</p>"});return;
  }
  const selected=url.searchParams.get("resource");
  if(selected){assert.equal(selected,resource);assert.equal(url.searchParams.get("state"),params.state);}
  const response=selected?renderOAuthConsent(consent,presentation):renderOAuthGroupChoice({clientName:consent.clientName,params,groups:[{slug:"qa-group",title:consent.groupTitle,resource}]},presentation);
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 await page.goto("https://qa.example/oauth/authorize");
 await page.locator(".oauth-group-select").selectOption(resource);
 await page.locator(".oauth-button-primary").click();
 await page.locator('button[value="approve"]').scrollIntoViewIfNeeded();
 if(width===390)await page.screenshot({path:join(output,"after-consent-390.png")});
 await page.locator('button[value="approve"]').click();await page.locator("#qa-complete").waitFor();
 assert.deepEqual(posts,["approve"]);results.push({width,...presentation,nativeGroupSelection:true,nativeApproveClick:true,sameOriginPost:true});await page.close();
}}finally{await writeFile(join(output,"consent-browser.json"),JSON.stringify(results,null,2));await browser.close();}
console.log("CONSENT_BROWSER_PASS",JSON.stringify(results));
