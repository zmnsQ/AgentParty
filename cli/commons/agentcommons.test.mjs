import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {parseArgs,serverOrigin,profileName,brandedTools,clientCommand,VERSION} from './agentcommons.mjs';
const entry=fileURLToPath(new URL('./agentcommons.mjs',import.meta.url));
const secret='ap_'+'a'.repeat(48);
function run(args,env,input='') {return new Promise(resolve=>{const p=spawn(process.execPath,[entry,...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input);});}
async function fixture(fn) {
 const home=mkdtempSync(join(tmpdir(),'ac-cli-test-')),bin=join(home,'bin');mkdirSync(bin);
 const env={HOME:home,USERPROFILE:home,AGENT_COMMONS_HOME:join(home,'.agentcommons'),PATH:bin+':'+process.env.PATH,AC_TEST_LOG:join(home,'native.json')};
 for(const client of ['codex','codebuddy','claude']) {
  const p=join(bin,client);writeFileSync(p,`#!/usr/bin/env node\nconst fs=require('fs');const p=process.env.AC_TEST_LOG;const args=process.argv.slice(2);if(args[0]==='--version'){console.log('test-only');process.exit(0);}if(args[1]==='get'){if(!fs.existsSync(p)){if(process.argv[1].endsWith('codebuddy')){console.error('MCP server '+JSON.stringify(args[2])+' not found in any scope');process.exit(0);}process.exit(1);}const saved=JSON.parse(fs.readFileSync(p,'utf8'));if(args.includes('--json')){const split=saved.indexOf('--'),env=saved[saved.indexOf('--env')+1];console.log(JSON.stringify({transport:{command:saved[split+1],args:saved.slice(split+2),env:{AGENT_COMMONS_HOME:env.slice(env.indexOf('=')+1)}}}));}else console.log(JSON.stringify(saved));}else if(args[1]==='add'){fs.writeFileSync(p,JSON.stringify(args));}else if(args[1]==='remove'){if(fs.existsSync(p))fs.unlinkSync(p);}else process.exit(2);`);chmodSync(p,0o755);
 }
 const calls=[];let wrongIdentity=false;
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls.push({url:req.url,body:raw,auth:req.headers.authorization});res.setHeader('content-type','application/json');
  if(req.url==='/api/me')res.end(JSON.stringify({name:'qa-code',role:'agent',kind:'agent',channel_scope:wrongIdentity?'other':'qa'}));
  else {const q=JSON.parse(raw);const result=q.method==='initialize'?{protocolVersion:'2025-06-18',serverInfo:{name:'server',version:'test'},capabilities:{tools:{}}}:q.method==='tools/list'?{tools:[{name:'party_profile',description:'AgentParty identity',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},{name:'party_send_message',description:'Write',inputSchema:{type:'object'},annotations:{readOnlyHint:false}}]}:{content:[{type:'text',text:JSON.stringify({name:q.params.name,channel:'qa'})}]};res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 try{await fn({home,env,origin,calls,wrong:()=>{wrongIdentity=true;}});}finally{await new Promise(resolve=>server.close(resolve));rmSync(home,{recursive:true,force:true});}
}
const flags=(origin,client='codebuddy')=>['connect','--server',origin,'--allow-localhost','--channel','qa','--name','qa-code','--client',client,'--yes','--token-stdin'];
test('argument validation rejects token flags, duplicates and incomplete options',()=>{
 assert.throws(()=>parseArgs(['--token','secret']));assert.throws(()=>parseArgs(['--name','x','--name','y']));assert.throws(()=>parseArgs(['--server']));assert.equal(parseArgs(['--yes','--client','codex']).flags.client,'codex');
});
test('TLS origins reject paths, credentials, fragments and remote HTTP',()=>{
 for(const url of ['http://evil.test','https://a.test/path','https://u:p@a.test','https://a.test/?x=1','https://a.test/#x'])assert.throws(()=>serverOrigin(url));
 assert.equal(serverOrigin('https://a.test'),'https://a.test');assert.throws(()=>serverOrigin('http://localhost'));assert.equal(serverOrigin('http://localhost:123',true),'http://localhost:123');
});
test('profile identity includes server, group, name and client',()=>{
 const base={server:'https://a.test',channel:'one',name:'a.b',client:'codex'};const p=profileName(base);
 for(const change of [{server:'https://b.test'},{channel:'two'},{name:'a-b'},{client:'codebuddy'}])assert.notEqual(profileName({...base,...change}),p);
});
test('public tools use Commons branding while preserving security annotations',()=>{
 const t=brandedTools([{name:'party_profile',description:'AgentParty party_profile',annotations:{readOnlyHint:true}}])[0];assert.equal(t.name,'commons_profile');assert.equal(t.annotations.readOnlyHint,true);assert.equal(t.description,'Agent Commons commons_profile');
});
test('provider commands contain only profile names and executable paths, never credentials',()=>{
 for(const client of ['codex','codebuddy','claude']) {const args=clientCommand(client,'add','ac-fixture');assert.equal(args[0],client);assert.ok(args.includes('--'));assert.ok(!args.join(' ').includes(secret));}
});
test('dry-run does not read credentials, contact server or create files',()=>fixture(async f=>{
 const r=await run(flags(f.origin).concat('--dry-run'),f.env);assert.equal(r.code,0,r.err);assert.equal(f.calls.length,0);assert.equal(existsSync(f.env.AGENT_COMMONS_HOME),false);
}));
test('group mismatch fails before creating credentials or native MCP registration',()=>fixture(async f=>{
 f.wrong();const r=await run(flags(f.origin),f.env,secret);assert.equal(r.code,1);assert.match(r.err,/Identity mismatch/);assert.equal(existsSync(f.env.AC_TEST_LOG),false);assert.equal(existsSync(f.env.AGENT_COMMONS_HOME),false);assert.ok(!r.err.includes(secret));
}));
for(const client of ['codex','codebuddy','claude'])test(`${client}: complete secure setup, idempotence, diagnostics and scoped disconnect`,()=>fixture(async f=>{
 const first=await run(flags(f.origin,client),f.env,secret);assert.equal(first.code,0,first.err);const p=profileName({server:f.origin,channel:'qa',name:'qa-code',client});const path=join(f.env.AGENT_COMMONS_HOME,'profiles',p+'.json');
 assert.equal(statSync(path).mode&0o777,0o600);assert.ok(!readFileSync(f.env.AC_TEST_LOG,'utf8').includes(secret));assert.ok(!first.out.includes(secret)&&!first.err.includes(secret));
 assert.ok(f.calls.every(c=>c.url==='/api/me'||['initialize','tools/list'].includes(JSON.parse(c.body).method)));
 assert.equal((await run(flags(f.origin,client),f.env,secret)).code,0);
 const config=await run(['config','--profile',p],f.env);assert.ok(!config.out.includes(secret));assert.match(config.out,client==='codex'?/mcp_servers/:/mcpServers/);
 const doctor=await run(['doctor','--profile',p],f.env);assert.equal(doctor.code,0,doctor.err);assert.equal(JSON.parse(doctor.out).automaticWake,false);
 const removed=await run(['disconnect','--profile',p,'--yes'],f.env);assert.equal(removed.code,0,removed.err);assert.equal(existsSync(path),false);assert.equal(existsSync(f.env.AC_TEST_LOG),false);
}));
test('stdio initialize, tools/list and calls translate exactly; no diagnostics on stdout',()=>fixture(async f=>{
 assert.equal((await run(flags(f.origin),f.env,secret)).code,0);
 const p=profileName({server:f.origin,channel:'qa',name:'qa-code',client:'codebuddy'});
 const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'commons_profile',arguments:{}}},{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'unknown',arguments:{}}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
 const result=await run(['mcp','--profile',p],f.env,input);assert.equal(result.code,0,result.err);const lines=result.out.trim().split('\n').map(JSON.parse);assert.equal(lines.length,4);assert.equal(lines[0].result.serverInfo.name,'agent-commons');assert.equal(lines[1].result.tools[0].name,'commons_profile');assert.equal(JSON.parse(lines[2].result.content[0].text).name,'party_profile');assert.equal(lines[3].error.code,-32602);assert.ok(!result.out.includes(secret));
}));
test('configuration and list never reveal token; insecure file permissions fail closed',()=>fixture(async f=>{
 await run(flags(f.origin),f.env,secret);const p=profileName({server:f.origin,channel:'qa',name:'qa-code',client:'codebuddy'});
 const list=await run(['list'],f.env);assert.ok(!list.out.includes(secret));chmodSync(join(f.env.AGENT_COMMONS_HOME,'profiles',p+'.json'),0o644);assert.equal((await run(['doctor','--profile',p],f.env)).code,1);
}));
test('installer creates first-party command without touching party; re-install is safe',()=>fixture(async f=>{
 const legacy=join(f.home,'.local','bin','party');mkdirSync(dirname(legacy),{recursive:true});writeFileSync(legacy,'do not touch');
 const r=await run(['self-install'],f.env);assert.equal(r.code,0,r.err);assert.equal(readFileSync(legacy,'utf8'),'do not touch');assert.equal((await run(['self-install'],f.env)).code,0);
 assert.ok(readFileSync(join(f.home,'.local','bin','agentcommons'),'utf8').includes('Agent Commons managed launcher'));assert.ok(existsSync(join(f.home,'.local','share','agent-commons','agentcommons.mjs')));
}));
test('installer refuses an unmanaged same-name command',()=>fixture(async f=>{
 const p=join(f.home,'.local','bin','agentcommons');mkdirSync(dirname(p),{recursive:true});writeFileSync(p,'another program');const r=await run(['self-install'],f.env);assert.equal(r.code,1);assert.equal(readFileSync(p,'utf8'),'another program');
}));
test('version is independently branded and semantic',async()=>{assert.match(VERSION,/^\d+\.\d+\.\d+$/);const r=await run(['--help'],{});assert.match(r.out,/Agent Commons CLI/);assert.match(r.out,/zmnsQ/);assert.match(r.out,/leeguoo/);});

test('CodeBuddy variadic env flags cannot consume the MCP service name',()=>{
 const args=clientCommand('codebuddy','add','ac-fixture');assert.ok(args.indexOf('ac-fixture')<args.indexOf('--env'));
});
test('manual setup is diagnosed as manual, without requiring an installed provider',()=>fixture(async f=>{
 const r=await run(flags(f.origin,'codex').concat('--manual'),f.env,secret);assert.equal(r.code,0,r.err);
 const profile=profileName({server:f.origin,channel:'qa',name:'qa-code',client:'codex'});
 const report=await run(['doctor','--profile',profile],f.env);assert.equal(report.code,0,report.err);assert.equal(JSON.parse(report.out).nativeRegistration,'manual');
}));
test('install does not tighten permissions of an existing unrelated user bin directory',()=>fixture(async f=>{
 const dir=join(f.home,'.local','bin');mkdirSync(dir,{recursive:true});chmodSync(dir,0o755);
 assert.equal((await run(['self-install'],f.env)).code,0);assert.equal(statSync(dir).mode&0o777,0o755);
}));

test('entrypoint works through a symlinked parent directory like macOS /tmp',()=>fixture(async f=>{
 const link=join(f.home,'linked');symlinkSync(dirname(entry),link,'dir');
 const out=await new Promise(resolve=>{const p=spawn(process.execPath,[join(link,'agentcommons.mjs'),'--version'],{env:{...process.env,...f.env}});let text='';p.stdout.on('data',b=>text+=b);p.on('close',code=>resolve({code,text}));});assert.equal(out.code,0);assert.equal(out.text.trim(),VERSION);
}));

for (const tampered of [false,true])test(`download installer ${tampered?'refuses corrupted payload':'installs checksum-verified payload'}`,()=>fixture(async f=>{
 const root=dirname(dirname(dirname(entry)));const build=spawnSync(process.execPath,[join(root,'cli/commons/build.mjs')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const payload=join(root,'web/public/cli/agentcommons.mjs');const downloaded=join(f.home,'download.mjs');writeFileSync(downloaded,readFileSync(payload,'utf8')+(tampered?'\n// corruption':''));
 const curl=join(f.home,'bin/curl');writeFileSync(curl,'#!/usr/bin/env node\nconst fs=require("fs");const args=process.argv.slice(2);fs.copyFileSync(process.env.AC_DOWNLOAD_FIXTURE,args[args.indexOf("-o")+1]);');chmodSync(curl,0o755);
 const installed=spawnSync('sh',[join(root,'web/public/cli/install.sh')],{env:{...process.env,...f.env,AC_DOWNLOAD_FIXTURE:downloaded},encoding:'utf8'});
 if(tampered){assert.notEqual(installed.status,0);assert.equal(existsSync(join(f.home,'.local/share/agent-commons/agentcommons.mjs')),false);}
 else{assert.equal(installed.status,0,installed.stderr);assert.equal(readFileSync(join(f.home,'.local/share/agent-commons/agentcommons.mjs'),'utf8'),readFileSync(payload,'utf8'));}
}));
