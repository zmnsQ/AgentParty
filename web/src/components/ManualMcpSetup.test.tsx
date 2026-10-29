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
beforeEach(()=>{calls=[];copies=[];pending=null;stub('IS_REACT_ACT_ENVIRONMENT',true);stub('localStorage',{getItem:()=>null,setItem(){}});stub('location',{origin:'https://commons.test'});stub('navigator',{clipboard:{writeText:async value=>{copies.push(value);}}});stub('fetch',async(url,init)=>{calls.push({url:String(url),init});return pending?pending.promise:Response.json({name:'test-mcp',token:secret});});});
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
