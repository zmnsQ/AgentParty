// @ts-nocheck Bun fixture only.
import {test,expect,beforeEach,afterEach} from 'bun:test';
import {act,create} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {DirectMcpSetup} from './DirectMcpSetup';
import {ManualMcpSetup} from './ManualMcpSetup';
let renderer,calls,copies,pending;const originals=new Map();
const secret='ap_fixture_agent_only';
function stub(key,value){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});}
const text=n=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
const manual=(props={})=><LocaleProvider><ManualMcpSetup endpoint="https://commons.test/api/channels/group/mcp" slug="group" token="human-fixture" namePrefix="test" onBack={()=>{}} {...props}/></LocaleProvider>;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
beforeEach(()=>{calls=[];copies=[];pending=null;stub('IS_REACT_ACT_ENVIRONMENT',true);stub('localStorage',{getItem:()=>null,setItem(){}});stub('location',{origin:'https://commons.test'});stub('navigator',{clipboard:{writeText:async value=>{copies.push(value);}}});stub('fetch',async(url,init)=>{if(String(url).endsWith('/mcp-security'))return Response.json({policy:{enabled:false,owner_mfa_enabled:false},can_manage:false});calls.push({url:String(url),init});return pending?pending.promise:Response.json({name:'test-mcp',token:secret});});});
afterEach(async()=>{await act(async()=>renderer?.unmount());renderer=null;for(const [k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}originals.clear();});
const createButton=()=>renderer.root.findAllByType('button').find(b=>text(b)==='Create group Agent Token');
async function mount(){await act(async()=>{renderer=create(manual());});}
test('explicit group agent creation separates URL, token and header; no human secret displayed/copied',async()=>{
 await mount();expect(calls).toHaveLength(0);await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(1);
 expect(JSON.parse(calls[0].init.body)).toEqual({name:'test-mcp',channel_scope:'group'});
 expect(calls[0].init.headers.authorization).toBe('Bearer human-fixture');
 const url=renderer.root.findByProps({'aria-label':'MCP server URL'});expect(text(url)).toBe('https://commons.test/api/channels/group/mcp');expect(text(url)).not.toContain(secret);
 for(const label of ['MCP server URL','Agent Token','Authorization header'])await act(async()=>renderer.root.findByProps({'aria-label':`Copy ${label}`}).props.onClick());
 expect(copies).toEqual(['https://commons.test/api/channels/group/mcp',secret,`Authorization: Bearer ${secret}`]);
 expect(text(renderer.root)).not.toContain('human-fixture');expect(text(renderer.root)).toContain('not an MCP-only key');expect(text(renderer.root)).toContain('not the created credential');
});
test('same-turn repeat and unknown result never blindly retry creation',async()=>{
 pending=deferred();await mount();const click=createButton().props.onClick;
 await act(async()=>{click();click();});expect(calls).toHaveLength(1);
 await act(async()=>pending.reject(new Error('timeout')));expect(text(renderer.root)).toContain('Creation outcome unknown');
 await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(1);
});
test('late credential after scope change, including ABA, is not revealed',async()=>{
 pending=deferred();await mount();await act(async()=>createButton().props.onClick());
 await act(async()=>renderer.update(manual({token:'different'})));await act(async()=>renderer.update(manual()));
 await act(async()=>pending.resolve(Response.json({name:'test-mcp',token:secret})));
 expect(text(renderer.root)).not.toContain(secret);expect(renderer.root.findAllByProps({'aria-label':'Agent Token'})).toHaveLength(0);
});
test('OAuth default and manual branch return preserve local connector, discard revealed token',async()=>{
 const node=<LocaleProvider><DirectMcpSetup server="https://commons.test" slug="group" token="human-fixture" namePrefix="test" client="generic" os="unix" onOsChange={()=>{}} onBack={()=>{}} onLocal={()=>{}}/></LocaleProvider>;
 await act(async()=>{renderer=create(node);});expect(calls).toHaveLength(0);expect(text(renderer.root)).toContain('Sign in and approve this group');
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Manual Token / header').props.onClick());
 expect(text(renderer.root)).not.toContain('Sign in and approve this group');await act(async()=>createButton().props.onClick());
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Back to authorization methods').props.onClick());
 expect(text(renderer.root)).not.toContain(secret);expect(text(renderer.root)).toContain('Sign in and approve this group');expect(text(renderer.root)).toContain('Configure local connector');
});
test('unmount ignores late creation and copy completion',async()=>{
 pending=deferred();await mount();await act(async()=>createButton().props.onClick());await act(async()=>renderer.unmount());renderer=null;
 await act(async()=>pending.resolve(Response.json({name:'test-mcp',token:secret})));expect(calls).toHaveLength(1);expect(copies).toEqual([]);
});
test('copy completion after leaving scope does not show success in replacement view',async()=>{
 await mount();await act(async()=>createButton().props.onClick());const copy=deferred();
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:()=>copy.promise}}});
 await act(async()=>renderer.root.findByProps({'aria-label':'Copy Agent Token'}).props.onClick());
 await act(async()=>renderer.update(manual({token:'replacement'})));await act(async()=>copy.resolve());
 expect(text(renderer.root)).not.toContain('Copied.');expect(text(renderer.root)).not.toContain(secret);
});
test('returning to manual branch after unknown attempt does not silently permit another create',async()=>{
 pending=deferred();await act(async()=>{renderer=create(<LocaleProvider><DirectMcpSetup server="https://commons.test" slug="group" token="human-fixture" client="generic" os="unix" onOsChange={()=>{}} onBack={()=>{}} onLocal={()=>{}}/></LocaleProvider>);});
 const choose=()=>renderer.root.findAllByType('button').find(b=>text(b)==='Manual Token / header').props.onClick();
 await act(async()=>choose());await act(async()=>createButton().props.onClick());await act(async()=>pending.reject(new Error('timeout')));
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Back to authorization methods').props.onClick());await act(async()=>choose());
 expect(createButton().props.disabled).toBe(true);await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(1);
 expect(text(renderer.root)).toContain('already attempted');
});
test('unsafe endpoint cannot create credentials',async()=>{
 await act(async()=>{renderer=create(manual({endpoint:'http://commons.test/api/channels/group/mcp?t=bad'}));});
 expect(createButton().props.disabled).toBe(true);await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(0);
});
test('late clipboard rejection after exit never falls back to DOM with cleared secret',async()=>{
 await mount();await act(async()=>createButton().props.onClick());const copy=deferred();let fallbacks=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:()=>copy.promise}}});
 stub('document',{createElement(){fallbacks++;throw Error('must not create secret textarea');},execCommand(){fallbacks++;}});
 await act(async()=>renderer.root.findByProps({'aria-label':'Copy Agent Token'}).props.onClick());
 await act(async()=>renderer.unmount());renderer=null;
 await act(async()=>copy.reject(new Error('clipboard denied')));expect(fallbacks).toBe(0);
});
test('endpoint is available before creation and confirmed validation rejection permits correction',async()=>{
 await mount();expect(text(renderer.root.findByProps({'aria-label':'MCP server URL'}))).toBe('https://commons.test/api/channels/group/mcp');expect(calls).toHaveLength(0);
 globalThis.fetch=async()=>Response.json({error:'invalid'},{status:400});await act(async()=>createButton().props.onClick());expect(createButton().props.disabled).toBe(false);
 await act(async()=>renderer.root.findByType('input').props.onChange({target:{value:'corrected'}}));
 globalThis.fetch=async()=>Response.json({name:'corrected',token:secret});await act(async()=>createButton().props.onClick());expect(text(renderer.root)).toContain('Created corrected');
});
test('generic OAuth guide uses platform settings rather than a coding-only /mcp command',async()=>{
 await act(async()=>{renderer=create(<LocaleProvider><DirectMcpSetup server="https://commons.test" slug="group" token="human-fixture" client="generic" os="unix" onOsChange={()=>{}} onBack={()=>{}} onLocal={()=>{}}/></LocaleProvider>);});
 expect(renderer.root.findAllByProps({'aria-label':'Client authorization entry'})).toHaveLength(0);
 expect(text(renderer.root)).toContain('No coding client or local connector is required');expect(text(renderer.root)).toContain('platform’s MCP server settings');
});
test('token refresh clears reveal scope but retains unknown creation lock for this group',async()=>{
 const view=token=><LocaleProvider><DirectMcpSetup server="https://commons.test" slug="group" token={token} client="generic" os="unix" onOsChange={()=>{}} onBack={()=>{}} onLocal={()=>{}}/></LocaleProvider>;
 pending=deferred();await act(async()=>{renderer=create(view('human-a'));});
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Manual Token / header').props.onClick());
 await act(async()=>createButton().props.onClick());await act(async()=>pending.reject(new Error('timeout')));
 await act(async()=>renderer.update(view('human-renewed')));expect(createButton().props.disabled).toBe(true);
 await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(1);expect(text(renderer.root)).not.toContain(secret);
});

test('verified same-account refresh preserves revealed token and complete parseable JSON; copy failure keeps it',async()=>{
 const view=(token='human-a',accountKey='verified-owner',slug='group')=><LocaleProvider><DirectMcpSetup server="https://commons.test" slug={slug} accountKey={accountKey} token={token} client="generic" os="unix" onOsChange={()=>{}} onBack={()=>{}} onLocal={()=>{}}/></LocaleProvider>;
 await act(async()=>{renderer=create(view());});
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Manual Token / header').props.onClick());
 await act(async()=>createButton().props.onClick());
 for(const token of ['human-a','renewed-1','renewed-2'])await act(async()=>renderer.update(view(token)));
 expect(text(renderer.root)).toContain(secret);expect(calls).toHaveLength(1);
 const config=JSON.parse(text(renderer.root.findByProps({'aria-label':'Complete MCP JSON configuration'})));
 expect(config).toEqual({mcpServers:{'agentcommons-group':{type:'http',url:'https://commons.test/api/channels/group/mcp',headers:{Authorization:`Bearer ${secret}`}}}});
 await act(async()=>renderer.root.findByProps({'aria-label':'Copy Complete MCP JSON configuration'}).props.onClick());expect(JSON.parse(copies[0])).toEqual(config);
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
 await act(async()=>renderer.root.findByProps({'aria-label':'Copy Complete MCP JSON configuration'}).props.onClick());expect(text(renderer.root)).toContain('Copy failed');expect(text(renderer.root)).toContain(secret);
 await act(async()=>renderer.update(view('other-auth','other-owner')));expect(text(renderer.root)).not.toContain(secret);
});
test('same verified owner renews during pending creation without dropping response or creating twice',async()=>{
 pending=deferred();await act(async()=>{renderer=create(manual({accountKey:'owner'}));});await act(async()=>createButton().props.onClick());
 await act(async()=>renderer.update(manual({accountKey:'owner',token:'renewed'})));const busyButton=renderer.root.findAllByType('button').find(b=>text(b).startsWith('Creating, please wait'));expect(busyButton.props.disabled).toBe(true);
 await act(async()=>busyButton.props.onClick());expect(calls).toHaveLength(1);
 await act(async()=>pending.resolve(Response.json({name:'test-mcp',token:secret})));expect(text(renderer.root)).toContain(secret);
});
test('verified owner or actual group change clears reveal and rejects stale ABA response',async()=>{
 pending=deferred();await act(async()=>{renderer=create(manual({accountKey:'owner'}));});await act(async()=>createButton().props.onClick());
 await act(async()=>renderer.update(manual({accountKey:'other'})));await act(async()=>renderer.update(manual({accountKey:'owner'})));
 await act(async()=>pending.resolve(Response.json({name:'test-mcp',token:secret})));expect(text(renderer.root)).not.toContain(secret);
 pending=null;await act(async()=>createButton().props.onClick());expect(text(renderer.root)).toContain(secret);
 await act(async()=>renderer.update(manual({accountKey:'owner',slug:'elsewhere',endpoint:'https://commons.test/api/channels/elsewhere/mcp'})));expect(text(renderer.root)).not.toContain(secret);
});

test('complete JSON safely escapes credential bytes; leaving and returning never restores a prior secret',async()=>{
 const fixture='ap_fixture_"quoted\\value';globalThis.fetch=async()=>Response.json({name:'test-mcp',token:fixture});
 const view=(server='https://commons.test')=><LocaleProvider><DirectMcpSetup server={server} slug="group" accountKey="owner" token="human" client="generic" os="unix" onOsChange={()=>{}} onBack={()=>{}} onLocal={()=>{}}/></LocaleProvider>;
 await act(async()=>{renderer=create(view());});const select=()=>renderer.root.findAllByType('button').find(b=>text(b)==='Manual Token / header').props.onClick();
 await act(async()=>select());await act(async()=>createButton().props.onClick());
 const json=text(renderer.root.findByProps({'aria-label':'Complete MCP JSON configuration'}));expect(JSON.parse(json).mcpServers['agentcommons-group'].headers.Authorization).toBe(`Bearer ${fixture}`);
 await act(async()=>renderer.update(view('https://another.test')));expect(renderer.root.findAllByProps({'aria-label':'Agent Token'})).toHaveLength(0);
 await act(async()=>renderer.update(view()));expect(renderer.root.findAllByProps({'aria-label':'Agent Token'})).toHaveLength(0);
});
test('removed identity is not presented as an authorization or token expiry problem',async()=>{
 pending={promise:Promise.resolve(Response.json({error:{code:'participant_removed',message:'participant was removed from this channel'}},{status:403}))};
 await mount();await act(async()=>createButton().props.onClick());
 expect(text(renderer.root)).toContain('Creating or rotating tokens cannot restore membership');
 expect(renderer.root.findAllByProps({'aria-label':'Agent Token'})).toHaveLength(0);
 expect(copies).toHaveLength(0);expect(calls.filter(c=>c.url.endsWith("/api/agents"))).toHaveLength(1);
});

test('known name conflict unlocks edit and permits exactly one explicit renamed attempt',async()=>{
 pending={promise:Promise.resolve(Response.json({error:{code:'conflict',message:'token name already exists'}},{status:409}))};
 await mount();await act(async()=>renderer.root.findByType('input').props.onChange({target:{value:'  renamed-agent  '}}));
 await act(async()=>{createButton().props.onClick();createButton().props.onClick();});
 expect(calls).toHaveLength(1);expect(JSON.parse(calls[0].init.body).name).toBe('renamed-agent');
 expect(text(renderer.root)).toContain('This name already exists');
 expect(renderer.root.findByType('input').props.disabled).toBe(false);expect(createButton().props.disabled).toBe(false);
 pending=null;await act(async()=>renderer.root.findByType('input').props.onChange({target:{value:'different-agent'}}));
 await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(2);expect(JSON.parse(calls[1].init.body).name).toBe('different-agent');expect(text(renderer.root)).toContain(secret);
});
test('invalid edited name stays editable with an explicit error and never sends',async()=>{
 await mount();await act(async()=>renderer.root.findByType('input').props.onChange({target:{value:'bad/name'}}));
 await act(async()=>createButton().props.onClick());expect(calls).toHaveLength(0);expect(text(renderer.root)).toContain('Use 1–64');expect(createButton().props.disabled).toBe(false);
});
test('request deadline exits pending into explicit unknown state without resubmitting',async()=>{
 let expire;const nativeTimer=globalThis.setTimeout;stub('setTimeout',(cb,ms,...args)=>ms===30000?(expire=cb,999):nativeTimer(cb,ms,...args));
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/mcp-security'))return Response.json({policy:{enabled:true,owner_mfa_enabled:true},can_manage:false});calls.push({url:String(url),init});return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('deadline','AbortError'))));};
 await mount();await act(async()=>createButton().props.onClick());expect(text(renderer.root)).toContain('up to 30 seconds');
 await act(async()=>expire());expect(text(renderer.root)).toContain('Creation outcome unknown');expect(text(renderer.root)).not.toContain('up to 30 seconds');expect(createButton().props.disabled).toBe(true);expect(calls).toHaveLength(1);expect(copies).toHaveLength(0);
});

test('removed creation offers precise inline restoration; a new credential still needs another explicit click',async()=>{
 let state={name:'test-mcp',owner:'fixture-owner',channel_scope:'group',created_at:1,credential_revoked:true,access_status:'removed',can_restore:true,removal_epoch:'epoch-1'},attempts=0,confirmed=false;
 stub('window',{confirm:message=>{expect(message).toContain('test-mcp');expect(message).toContain('group');confirmed=true;return true;}});
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});if(String(url).endsWith('/mcp-security'))return Response.json({policy:{enabled:true,owner_mfa_enabled:true},can_manage:false});
 if(String(url).endsWith('/access'))return Response.json(state);
 if(String(url).endsWith('/restore')){state={...state,access_status:'active',can_restore:false};return Response.json({restored:true});}
 attempts++;return attempts===1?Response.json({error:{code:'participant_removed'}},{status:403}):Response.json({name:'test-mcp',token:secret});};
 await mount();await act(async()=>createButton().props.onClick());expect(attempts).toBe(1);expect(createButton().props.disabled).toBe(true);
 const restore=()=>renderer.root.findAllByType('button').find(b=>text(b)==='Re-add this Agent');expect(restore()).toBeTruthy();
 await act(async()=>restore().props.onClick());expect(confirmed).toBe(true);expect(attempts).toBe(1);expect(createButton().props.disabled).toBe(false);expect(text(renderer.root)).toContain('Identity restored');
 await act(async()=>createButton().props.onClick());expect(attempts).toBe(2);expect(text(renderer.root)).toContain(secret);
});
test('removed creation by nonmoderator shows guidance without a restore button',async()=>{
 globalThis.fetch=async(url)=>String(url).endsWith('/access')?Response.json({name:'test-mcp',owner:'owner',channel_scope:'group',created_at:1,access_status:'removed',can_restore:false}):String(url).endsWith('/mcp-security')?Response.json({policy:{enabled:false,owner_mfa_enabled:false},can_manage:false}):Response.json({error:{code:'participant_removed'}},{status:403});
 await mount();await act(async()=>createButton().props.onClick());expect(text(renderer.root)).toContain('Ask a group moderator');expect(renderer.root.findAllByType('button').some(b=>text(b)==='Re-add this Agent')).toBe(false);
});
