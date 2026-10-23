import {env,SELF} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {api,createChannel,seedToken,uniq} from './helpers';
import {enableMcpFixture,browserOwnerFixture} from './mcp-test-helpers';
import {sha256Hex} from '../src/auth';
import {validMuseRedirect,museReviewManifest} from '../src/collaboration/muse-connector';
const ROOT='https://commons.test',REDIRECT='https://platform.muse.ai/oauth/callback/test-fixture';
async function setup(){
 const account=uniq('muse-owner'),human=await seedToken('human',uniq('owner'),{owner:account});
 const slug=await createChannel(human.token);await enableMcpFixture(slug,account);
 const token=await browserOwnerFixture(account,true);
 const cookie=crypto.randomUUID().replaceAll('-','').repeat(2),sid=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO browser_sessions(id,cookie_hash,account,stage,auth_version,created_at,expires_at) VALUES(?,?,?,'ready',0,?,?)")
  .bind(sid,await sha256Hex(cookie),account,Date.now(),Date.now()+3600_000).run();
 return {slug,account,token,cookie:'__Host-ap_session='+cookie,path:`/api/channels/${slug}/bridges/muse`};
}
async function register(c:Awaited<ReturnType<typeof setup>>){
 const r=await api(c.path+'/oauth-client',c.token,{method:'POST',body:JSON.stringify({redirect_uri:REDIRECT})});
 expect(r.status).toBe(201);return await r.json() as {client_id:string;client_secret:string};
}
async function consent(c:Awaited<ReturnType<typeof setup>>,clientId:string){
 const verifier='v'.repeat(48),bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const q=new URLSearchParams({client_id:clientId,redirect_uri:REDIRECT,response_type:'code',code_challenge:challenge,
  code_challenge_method:'S256',state:'fixture-state',scope:'group.read group.write'});
 const r=await SELF.fetch('http://commons.test/oauth/authorize?'+q,{headers:{cookie:c.cookie},redirect:'manual'});
 expect(r.status).toBe(200);const text=await r.text();
 const get=(name:string)=>text.match(new RegExp('name="'+name+'" value="([^"]+)"'))![1]!;
 const result=await SELF.fetch('http://commons.test/oauth/authorize',{method:'POST',redirect:'manual',
  headers:{origin:ROOT,cookie:c.cookie,'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({request_id:get('request_id'),nonce:get('nonce'),decision:'approve'}).toString()});
 expect(result.status).toBe(302);return {code:new URL(result.headers.get('location')!).searchParams.get('code')!,verifier};
}
async function exchange(client:{client_id:string;client_secret:string},code:string,verifier:string,kind='basic'){
 const form=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:REDIRECT,code_verifier:verifier});
 const headers:Record<string,string>={'content-type':'application/x-www-form-urlencoded'};
 if(kind==='basic')headers.authorization='Basic '+btoa(client.client_id+':'+client.client_secret);
 else {form.set('client_id',client.client_id);if(kind==='post')form.set('client_secret',client.client_secret);}
 return SELF.fetch('http://commons.test/oauth/token',{method:'POST',headers,body:form.toString()});
}
describe('Muse Cloud private connector setup and OAuth',()=>{
 it('rejects lookalike domains, public IP callbacks, insecure URLs and root paths',()=>{
  for(const s of ['https://evil.test/callback','https://muse.ai.evil.test/callback','https://evil-muse.ai/callback',
   'http://muse.ai/callback','https://127.0.0.1/callback','https://user@muse.ai/callback','https://muse.ai/',
   'https://muse.ai:8443/callback','https://muse.ai/callback#fragment','https://muse.ai/callback?token=secret'])expect(validMuseRedirect(s)).toBe(false);
  expect(validMuseRedirect(REDIRECT)).toBe(true);expect(validMuseRedirect('https://muse.ai/connector/oauth')).toBe(true);
 });
 it('only a verified MFA human owner may create a client and the secret is never listed again',async()=>{
  const c=await setup();const noMfa=await browserOwnerFixture(c.account,false);
  expect((await api(c.path+'/oauth-client',noMfa,{method:'POST',body:JSON.stringify({redirect_uri:REDIRECT})})).status).toBe(403);
  const ready=await browserOwnerFixture(c.account,true);c.token=ready;const client=await register(c);
  expect(client.client_secret).toMatch(/^acs_[a-f0-9]{64}$/);
  const row=await env.DB.prepare('SELECT secret_hash FROM connector_oauth_private_clients WHERE client_id=?')
   .bind(client.client_id).first<{secret_hash:string}>();expect(row?.secret_hash).toBe(await sha256Hex(client.client_secret));
  const listing=await (await api(c.path,c.token)).text();expect(listing).not.toContain(client.client_secret);expect(listing).not.toContain('secret_hash');
  expect(JSON.parse(listing)).toMatchObject({platform_review:{status:'not_submitted',verified:false},personal_wake:{verified:false}});
  const foreign=await seedToken('human',uniq('other'),{owner:uniq('other-account')});
  expect((await api(c.path,foreign.token)).status).toBe(403);
 });
 it.each(['basic','post'])('exchanges a real scoped authorization using client_secret_%s and S256, then revokes it',async(kind)=>{
  const c=await setup(),client=await register(c),approved=await consent(c,client.client_id);
  expect((await exchange(client,approved.code,approved.verifier,'none')).status).toBe(401);
  expect((await exchange({...client,client_secret:'acs_'+'0'.repeat(64)},approved.code,approved.verifier,kind)).status).toBe(401);
  const success=await exchange(client,approved.code,approved.verifier,kind);expect(success.status).toBe(200);
  const tokens=await success.json() as {access_token:string;refresh_token:string;resource:string};
  expect(tokens.resource).toBe(ROOT+`/api/channels/${c.slug}/mcp`);
  const list=await api(`/api/channels/${c.slug}/agents`,c.token);const agents=await list.json() as {agents:Array<{oauth?:{provider:string}}>};
  expect(agents.agents.some(a=>a.oauth?.provider==='muse')).toBe(true);
  expect((await exchange(client,approved.code,approved.verifier,kind)).status).toBe(400);
  const revoke=await api(c.path+'/oauth-client/'+client.client_id,c.token,{method:'DELETE'});expect(revoke.status).toBe(200);
  const read=await api(`/api/channels/${c.slug}/mcp`,tokens.access_token,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  expect(read.status).toBe(401);
  const refresh=await SELF.fetch('http://commons.test/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'refresh_token',client_id:client.client_id,client_secret:client.client_secret,refresh_token:tokens.refresh_token}).toString()});
  expect(refresh.status).toBe(401);
 });
 it('cannot use a client provisioned for one group to authorize another group',async()=>{
  const c=await setup(),client=await register(c);const other=await setup();
  const q=new URLSearchParams({client_id:client.client_id,redirect_uri:REDIRECT,response_type:'code',
   code_challenge:'x'.repeat(43),code_challenge_method:'S256',state:'fixture',scope:'group.read',resource:ROOT+`/api/channels/${other.slug}/mcp`});
  const r=await SELF.fetch('http://commons.test/oauth/authorize?'+q,{headers:{cookie:c.cookie},redirect:'manual'});expect(r.status).toBe(400);
 });
 it('exports honest review requirements with sensitive writes and no credentials',()=>{
  const data=museReviewManifest(ROOT,'demo');expect(data.review_status).toBe('not_submitted');
  expect(data.permissions.find(x=>x.name==='party_send_message')?.classification).toBe('sensitive_write');
  expect(data.authentication.read_only_available).toBe(true);
  expect(data.required_submission_materials).toContain('Support and security contacts');
  expect(JSON.stringify(data)).not.toContain('acs_');
 });
});
