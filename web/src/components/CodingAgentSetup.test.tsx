// @ts-expect-error Bun executes tests outside Vite globals.
import {afterEach,beforeEach,test,expect} from 'bun:test';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {CodingAgentSetup,codingConnectCommand} from './CodingAgentSetup';
let renderer:ReactTestRenderer|null=null;
const originals=new Map<string,PropertyDescriptor|undefined>();
const calls:Array<{url:string;init?:RequestInit}>=[];let locale='zh',status=201;
const token='ap_'+'z'.repeat(48);
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
function stub(key:string,value:unknown){if(!originals.has(key))originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
beforeEach(()=>{calls.length=0;locale='zh';status=201;stub('IS_REACT_ACT_ENVIRONMENT',true);stub('location',{origin:'https://commons.test'});stub('localStorage',{getItem:(key:string)=>key==='ap_locale'?locale:null,setItem(){}});stub('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),init});return Response.json({name:'test-codebuddy',token},{status});});});
afterEach(async()=>{if(renderer)await act(async()=>renderer?.unmount());renderer=null;for(const [key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}originals.clear();});
async function mount(){await act(async()=>{renderer=create(<LocaleProvider><CodingAgentSetup client="codebuddy" slug="test-group" token="human-fixture" namePrefix="test" onBack={()=>{}}/></LocaleProvider>);});const root=renderer!.root;await act(async()=>root.findByProps({className:'d-btn coding-local-mode'}).props.onClick());return root;}
test('CodeBuddy first-party guide never creates credentials on render',async()=>{const root=await mount();expect(calls).toHaveLength(0);expect(text(root)).toContain('Agent Commons');expect(text(root)).toContain('CodeBuddy');expect(text(root)).toContain('/cli/install.sh');expect(text(root)).not.toContain('leeguooooo/agentparty/main/install.sh');});
test('only an explicit create action mints an exact group-scoped identity',async()=>{const root=await mount();await act(async()=>root.findByProps({className:'d-btn d-btn--primary coding-create'}).props.onClick());expect(calls).toHaveLength(1);expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({name:'test-codebuddy',channel_scope:'test-group'});expect(root.findByProps({className:'coding-agent-token'}).props.type).toBe('password');});
test('generated commands never include credentials; Windows uses manual config',async()=>{const root=await mount();await act(async()=>root.findByProps({className:'d-btn d-btn--primary coding-create'}).props.onClick());let code=root.findAllByType('pre').map(x=>text(x)).join('\n');expect(code).toContain('agentcommons connect');expect(code).toContain('--client codebuddy');expect(code).not.toContain(token);expect(code).not.toContain('party join');await act(async()=>root.findAllByType('button').find(x=>text(x)==='Windows')!.props.onClick());code=root.findAllByType('pre').map(x=>text(x)).join('\n');expect(code).toContain('--manual');expect(code).toContain('/cli/install.ps1');expect(calls).toHaveLength(1);});
test('invalid names do not create credentials',async()=>{const root=await mount();await act(async()=>root.findByProps({className:'coding-agent-name'}).props.onChange({target:{value:'bad; command'}}));await act(async()=>root.findByProps({className:'d-btn d-btn--primary coding-create'}).props.onClick());expect(calls).toHaveLength(0);expect(root.findByProps({role:'alert'})).toBeTruthy();});
test('rapid duplicate clicks do not mint twice',async()=>{const root=await mount();const click=root.findByProps({className:'d-btn d-btn--primary coding-create'}).props.onClick;await act(async()=>{await Promise.all([click(),click()]);});expect(calls).toHaveLength(1);});
test('name conflicts give recovery guidance instead of rotating or creating another identity',async()=>{status=409;const root=await mount();await act(async()=>root.findByProps({className:'d-btn d-btn--primary coding-create'}).props.onClick());expect(root.findAllByProps({type:'password'})).toHaveLength(0);expect(text(root)).toContain('已有身份');expect(calls).toHaveLength(1);});
test('English preserves own branding and the tool-access vs wake distinction',async()=>{locale='en';const root=await mount();expect(text(root)).toContain('Agent Commons');expect(text(root)).toContain('Realtime notifications require');expect(text(root)).not.toContain('CodingAgentSetup.');expect(calls).toHaveLength(0);});
test('command builder rejects shell syntax and non-HTTPS origins',()=>{expect(()=>codingConnectCommand('http://example.test','group','test','codex')).toThrow();expect(()=>codingConnectCommand('https://example.test','group','bad;rm','codex')).toThrow();expect(codingConnectCommand('https://example.test','group','test','codex')).toContain('agentcommons connect');});

for(const origin of ['http://localhost:4177','http://example.test'])test(`insecure wizard blocks credential creation: ${origin}`,async()=>{
 stub('location',{origin});await act(async()=>{renderer=create(<LocaleProvider><CodingAgentSetup client="codebuddy" slug="test-group" token="human-fixture" namePrefix="test" onBack={()=>{}}/></LocaleProvider>);});const root=renderer!.root;expect(text(root)).toContain('HTTPS');expect(calls).toHaveLength(0);expect(root.findAllByProps({type:'password'})).toHaveLength(0);
});

test('direct MCP stays the default with a visible optional installer and no implicit credentials',async()=>{await act(async()=>{renderer=create(<LocaleProvider><CodingAgentSetup client="codebuddy" slug="test-group" token="human-fixture" namePrefix="test" onBack={()=>{}}/></LocaleProvider>);});const root=renderer!.root;expect(calls).toHaveLength(0);expect(text(root)).toContain('直接连接本群 MCP');expect(text(root)).toContain('--transport http');expect(text(root)).toContain('/cli/install.sh');expect(text(root)).toContain('安装 / 升级 agentcommons');expect(text(root)).toContain('直接 MCP 无需安装');expect(text(root)).not.toContain('原项目');expect(root.findAllByProps({type:'password'})).toHaveLength(0);});

for(const client of ['codex','codebuddy','claude','generic'] as const)test(`${client}: install is visible before local mode or credential creation`,async()=>{
 await act(async()=>{renderer=create(<LocaleProvider><CodingAgentSetup client={client} slug="test-group" token="human-fixture" namePrefix="test" onBack={()=>{}}/></LocaleProvider>);});
 const root=renderer!.root,install=root.findByProps({className:'coding-install'});
 expect(text(install)).toContain('https://commons.test/cli/install.sh');expect(text(install)).toContain('agentcommons --version');
 expect(root.findAllByProps({className:'coding-agent-name'})).toHaveLength(0);expect(calls).toHaveLength(0);
 await act(async()=>root.findAllByType('button').find(x=>text(x)==='Windows')!.props.onClick());
 expect(text(root.findByProps({className:'coding-install'}))).toContain('/cli/install.ps1');expect(calls).toHaveLength(0);
 await act(async()=>root.findByProps({className:'d-btn coding-local-mode'}).props.onClick());
 expect(text(root.findByProps({className:'coding-install'}))).toContain('/cli/install.ps1');expect(calls).toHaveLength(0);
});
test('English shows installation and upgrade without development-history copy',async()=>{
 locale='en';await act(async()=>{renderer=create(<LocaleProvider><CodingAgentSetup client="codex" slug="test-group" token="human-fixture" namePrefix="test" onBack={()=>{}}/></LocaleProvider>);});
 expect(text(renderer!.root)).toContain('Install / update agentcommons');expect(text(renderer!.root)).toContain('Copy installation command');expect(text(renderer!.root)).not.toContain('upstream');expect(calls).toHaveLength(0);
});
