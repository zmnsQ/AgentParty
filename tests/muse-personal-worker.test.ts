// @ts-expect-error Bun pure-contract tests do not use the workerd test globals.
import {expect,test} from 'bun:test';
import {bridgeKey,personalStatus,verifyPersonalReport} from '../worker/src/collaboration/muse-personal';
const secret='a'.repeat(43),now=1770000000000,nonce='n'.repeat(20),slug='group-a';
async function sign(body:string,group=slug,ts=String(now)) {const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(`muse-personal-v1\n${group}\n${ts}\n${nonce}\n${body}`))),b=>b.toString(16).padStart(2,'0')).join('');}
test('personal bridge keys are explicit per group and malformed config fails closed',()=>{
 expect(bridgeKey(undefined,slug)).toBeNull();expect(bridgeKey('{',slug)).toBeNull();
 const json=JSON.stringify({[slug]:{secret,agent_name:'reporter'}});
 expect(bridgeKey(json,slug)?.agent_name).toBe('reporter');expect(bridgeKey(json,'other')).toBeNull();
 expect(bridgeKey(JSON.stringify({[slug]:{secret:'weak',agent_name:'reporter'}}),slug)).toBeNull();
});
test('heartbeat states never independently verify Muse account and expire',()=>{
 const row={channel_slug:slug,owner_account:'owner',binding_id:'id',account_label:'account',sidechat_label:'chat',last_checked_at:now,report_state:'ready_readonly',reason:'ready'};
 expect(personalStatus(false,row,now)).toMatchObject({configured:false,state:'unconfigured',binding:null});
 expect(personalStatus(true,null,now).state).toBe('unconfigured');
 expect(personalStatus(true,row,now)).toMatchObject({state:'ready_readonly',actual_account_verified:false,end_to_end_verified:false,evidence:'bridge_reported'});
 expect(personalStatus(true,row,now+120001).state).toBe('reconnect_required');
 expect(JSON.stringify(personalStatus(true,row,now))).not.toContain('owner');
});
test('HMAC binds body group nonce and time; malformed expired or forged reports fail',async()=>{
 const body='{"state":"polling"}',sig=await sign(body);
 expect(await verifyPersonalReport(secret,slug,String(now),nonce,body,sig,now)).toBe(true);
 for(const [group,raw,time,n,signature] of [['other',body,String(now),nonce,sig],[slug,body+' ',String(now),nonce,sig],[slug,body,String(now-61000),nonce,sig],[slug,body,String(now),'bad',sig],[slug,body,String(now),nonce,'0'.repeat(64)]])expect(await verifyPersonalReport(secret,group,time,n,raw,signature,now)).toBe(false);
});
import {Hono} from '../worker/node_modules/hono/dist/index.js';
import {registerMusePersonalRoutes} from '../worker/src/collaboration/muse-personal';
import type {AppContext} from '../worker/src/index';
import type {TokenIdentity} from '../worker/src/auth';
function fixture(identity:Partial<TokenIdentity>,allowOwner=false){
 const app=new Hono<AppContext>();
 registerMusePersonalRoutes(app,{access:async(c,mode)=>mode==='manage'&&!allowOwner?new Response('forbidden',{status:403}):({slug,channel:{slug,archived_at:null,owner_account:'owner'} as any,identity:{name:'reporter',role:'agent',kind:'agent',hash:'hash',account:'owner',channel_scope:slug,...identity} as TokenIdentity})});
 return app;
}
test('owner status is private; disabled mutations and unscoped reports fail before database',async()=>{
 const base=`https://test/api/channels/${slug}/bridges/muse-personal`,bindings={MUSE_PERSONAL_BRIDGE_ENABLED:'true',MUSE_PERSONAL_BRIDGE_KEYS:JSON.stringify({[slug]:{secret,agent_name:'reporter'}})} as any;
 expect((await fixture({}).request(base,{},bindings)).status).toBe(403);
 const owner=fixture({kind:'human'},true);
 const r=await owner.request(base,{},{} as any);expect(await r.json()).toMatchObject({enabled:false,configured:false,state:'unconfigured'});
 for(const method of ['PUT','DELETE'])expect((await owner.request(base,{method},{} as any)).status).toBe(503);
 for(const identity of [{channel_scope:undefined},{channel_scope:'other'},{kind:'human' as const},{name:'other'},{role:'readonly' as const},{account:'previous-owner'}])expect((await fixture(identity).request(base+'/report',{method:'POST'},bindings)).status).toBe(403);
 expect((await fixture({}).request(base+'/report',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},bindings)).status).toBe(401);
});
import {Database} from 'bun:sqlite';
import {readFileSync} from 'node:fs';
function database(){
 const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE channels(slug TEXT PRIMARY KEY);');db.exec(readFileSync(new URL('../worker/migrations/0055_muse_personal_bridge.sql',import.meta.url),'utf8'));db.run('INSERT INTO channels VALUES(?)',slug);
 const prepare=(sql:string)=>{let values:any[]=[];const stmt={bind(...v:any[]){values=v;return stmt;},async first(){return db.query(sql).get(...values);},async run(){const r=db.query(sql).run(...values);return {meta:{changes:r.changes}};},sql,get values(){return values;}};return stmt;};
 return {db,prepare,async batch(stmts:ReturnType<typeof prepare>[]){return db.transaction(()=>stmts.map(s=>{const r=db.query(s.sql).run(...s.values);return {meta:{changes:r.changes}};}))();}};
}
test('real SQL report replay rollback, changed binding and owner isolation',async()=>{
 const DB=database();const base=`https://test/api/channels/${slug}/bridges/muse-personal/report`;
 DB.db.run('INSERT INTO muse_personal_bindings(channel_slug,owner_account,binding_id,account_label,sidechat_label,sidechat_id) VALUES(?,?,?,?,?,?)',slug,'owner','binding-1','label','sidechat','session-1');
 const env={DB,MUSE_PERSONAL_BRIDGE_ENABLED:'true',MUSE_PERSONAL_BRIDGE_KEYS:JSON.stringify({[slug]:{secret,agent_name:'reporter'}})} as any;
 const send=async(app:ReturnType<typeof fixture>,id:string,nonce:string,time:number)=>{const raw=JSON.stringify({binding_id:id,state:'polling',reason:'ready'}),ts=String(time);const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(`muse-personal-v1\n${slug}\n${ts}\n${nonce}\n${raw}`))),b=>b.toString(16).padStart(2,'0')).join('');return app.request(base,{method:'POST',headers:{'content-type':'application/json','x-muse-timestamp':ts,'x-muse-nonce':nonce,'x-muse-signature':sig},body:raw},env);};
 const app=fixture({}),ts=Date.now();
 expect((await send(app,'binding-1','nonce-repeat-0001',ts)).status).toBe(200);
 expect((await send(app,'binding-1','nonce-repeat-0001',ts+1)).status).toBe(409);
 expect(DB.db.query('SELECT last_checked_at FROM muse_personal_bindings').get()).toEqual({last_checked_at:ts});
 expect((await send(app,'old-binding','nonce-another-0001',ts+2)).status).toBe(409);
 expect((await send(fixture({account:'foreign'}),'binding-1','nonce-another-0002',ts+2)).status).toBe(403);
 expect(DB.db.query('SELECT COUNT(*) as n FROM muse_personal_report_nonces').get()).toEqual({n:1});
 DB.db.close();
});
test('MFA binding is owner-local, excludes private session from status and deleting is local only',async()=>{
 const DB=database();DB.db.exec("CREATE TABLE browser_sessions(id TEXT,account TEXT,stage TEXT,revoked_at INTEGER,expires_at INTEGER,auth_version INTEGER);CREATE TABLE browser_account_security(account TEXT,version INTEGER,enabled INTEGER);");
 DB.db.run("INSERT INTO browser_sessions VALUES('browser','owner','ready',NULL,?,0)",Date.now()+3600_000);DB.db.run("INSERT INTO browser_account_security VALUES('owner',0,1)");
 const bindings={DB,MUSE_PERSONAL_BRIDGE_ENABLED:'true',MUSE_PERSONAL_BRIDGE_KEYS:JSON.stringify({[slug]:{secret,agent_name:'reporter'}})} as any;
 const base=`https://test/api/channels/${slug}/bridges/muse-personal`,payload={account_label:'My account',sidechat_label:'Group sidechat',sidechat_id:'private-session-id'};
 const owner=fixture({kind:'human',role:'human',account:'owner',browserSessionId:'browser'},true);
 const put=(app:ReturnType<typeof fixture>,data:any)=>app.request(base,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)},bindings);
 expect((await put(fixture({kind:'human',role:'human'},true),payload)).status).toBe(403);
 expect((await put(owner,{...payload,cookie:'forbidden'})).status).toBe(400);
 expect((await put(owner,payload)).status).toBe(200);
 const status=await(await owner.request(base,{},bindings)).text();expect(status).not.toContain('private-session-id');expect(JSON.parse(status)).toMatchObject({state:'reconnect_required',actual_account_verified:false});
 DB.db.run("INSERT INTO channels VALUES('group-b')");expect(()=>DB.db.run('INSERT INTO muse_personal_bindings(channel_slug,owner_account,binding_id,account_label,sidechat_label,sidechat_id) VALUES(?,?,?,?,?,?)','group-b','owner','other','label','chat','private-session-id')).toThrow();
 const removed=await owner.request(base,{method:'DELETE'},bindings);expect(await removed.json()).toMatchObject({state:'local_disconnected',provider_session_revoked:false});
 expect((await(await owner.request(base,{},bindings)).json()).configured).toBe(false);DB.db.close();
});
