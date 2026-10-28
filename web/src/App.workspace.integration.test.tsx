// @ts-expect-error Bun test runner only.
import {afterEach,expect,mock,test} from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {installWorkspaceFixture} from '../test/app-workspace-fixture';
import {LocaleProvider} from './i18n/locale';
import {SettingsPanel} from './components/SettingsPanel';
import {OnboardingGuide} from './components/OnboardingGuide';
import {ChannelList} from './components/ChannelList';
// This is an App boundary test, not a full Channel rendering test. The browser
// fixture separately imports the real Channel. Capture the production props.
let channelProps:any=null;
mock.module('./pages/Channel',()=>({ChannelPage:(props:any)=>{channelProps=props;return <div data-test-channel={props.slug}/>;}}));
mock.module('dompurify',()=>({default:{addHook(){},sanitize:(s:string)=>s}}));
const {App}=await import('./App');
let renderer:ReactTestRenderer|null=null;
const originals=new Map<string,PropertyDescriptor|undefined>();
function put(k:string,v:unknown){if(!originals.has(k))originals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
afterEach(async()=>{if(renderer)await act(async()=>renderer?.unmount());renderer=null;channelProps=null;for(const[k,d]of originals){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}originals.clear();});
async function mount(agent=false){
 const events=new EventTarget();const location={pathname:'/',search:'',origin:'http://localhost:4173',href:'http://localhost:4173/'};
 put('window',globalThis);put('location',location);put('IS_REACT_ACT_ENVIRONMENT',true);
 put('history',{pushState:(_a:unknown,_b:unknown,url:string)=>{location.pathname=url;location.href=location.origin+url;},replaceState:(_a:unknown,_b:unknown,url:string)=>{location.pathname=url;location.href=location.origin+url;}});
 put('addEventListener',events.addEventListener.bind(events));put('removeEventListener',events.removeEventListener.bind(events));
 put('innerWidth',1440);put('innerHeight',900);put('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 put('navigator',{platform:'test'});
 put('document',{documentElement:{dataset:{},style:{}},visibilityState:'visible',addEventListener(){},removeEventListener(){},querySelector:()=>null});
 for(const key of ['fetch','localStorage','sessionStorage','WebSocket','EventSource','__APP_WORKSPACE_FIXTURE__'])if(!originals.has(key))originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
 installWorkspaceFixture('midnight');
 if(agent){const fixtureFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const response=await fixtureFetch(input,init);if(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin).pathname==='/api/me'){return new Response(JSON.stringify({...await response.json(),kind:'agent',role:'agent',name:'agent-fixture',handle:'owner-handle',nickname:'agent-nick',preferred_display:'agent-nick'}),{headers:{'Content-Type':'application/json'}});}return response;};}
 await act(async()=>{renderer=create(<LocaleProvider><App/></LocaleProvider>);await new Promise(r=>setTimeout(r,20));});
 for(let i=0;i<10&&!channelProps;i++)await act(async()=>{await new Promise(r=>setTimeout(r,5));});
 expect(channelProps).not.toBeNull();
}
test('real App root chooses an authorized channel and wires roster through production sidebar',async()=>{
 await mount();expect(location.pathname).toBe('/c/fixture-0');expect(channelProps.slug).toBe('fixture-0');
 await act(async()=>channelProps.onAgentRoster('fixture-0',[{name:'agent-real',display:'Actual roster'}]));
 expect(renderer!.root.findByType(ChannelList).props.agents).toEqual([{name:'agent-real',display:'Actual roster'}]);
 await act(async()=>channelProps.onAgentRoster('foreign-group',[{name:'wrong'}]));
 expect(renderer!.root.findByType(ChannelList).props.agents).toEqual([{name:'agent-real',display:'Actual roster'}]);
});
test('real App scopes sidebar agent actions and roster to active group after navigation',async()=>{
 await mount();
 expect(renderer!.root.findAllByProps({className:'app-head prototype-rail'})).toHaveLength(0);
 expect(renderer!.root.findAllByProps({className:'workspace-account-controls'})).toHaveLength(1);
 await act(async()=>renderer!.root.findByType(ChannelList).props.onAgentSelect('agent-real'));
 expect(channelProps.workspaceAction?.panel).toBe('team');
 expect(channelProps.workspaceAction?.agent).toBe('agent-real');
 expect(channelProps.workspaceAction?.slug).toBe('fixture-0');
 const previous=channelProps.onAgentRoster;
 await act(async()=>renderer!.root.findByType(ChannelList).props.onOpen('fixture-1'));
 expect(channelProps.slug).toBe('fixture-1');expect(channelProps.workspaceAction).toBeUndefined();
 await act(async()=>renderer!.root.findByType(ChannelList).props.onAgentSelect('next-agent'));
 expect(channelProps.workspaceAction?.slug).toBe('fixture-1');expect(channelProps.workspaceAction?.agent).toBe('next-agent');
 expect(renderer!.root.findByType(ChannelList).props.agents).toEqual([]);
 await act(async()=>previous('fixture-0',[{name:'stale'}]));
 expect(renderer!.root.findByType(ChannelList).props.agents).toEqual([]);
});


test('account rename refreshes channel names and help returns to its settings origin',async()=>{
 await mount();
 const settings=renderer!.root.findAllByType('button').find(button=>button.props['aria-label']==='个人中心');
 const fallback=renderer!.root.findAllByType('button').find(button=>button.props.className==='prototype-rail-account');
 await act(async()=> (settings??fallback)!.props.onClick({currentTarget:null}));
 const panel=renderer!.root.findByType(SettingsPanel);
 const before=channelProps.identityRevision;
 await act(async()=>panel.props.onHandleSaved('fresh-name'));
 expect(channelProps.identityRevision).toBe(before+1);
 expect(renderer!.root.findByProps({className:'app-me-name'}).children).toEqual(['fresh-name']);
 expect(renderer!.root.findByType(SettingsPanel).props.me.preferred_display).toBe('fresh-name');
 await act(async()=>renderer!.root.findByType(SettingsPanel).props.onShowOnboarding());
 expect(renderer!.root.findAllByType(SettingsPanel)).toHaveLength(0);
 expect(renderer!.root.findByType(OnboardingGuide).props.onBack).toBeDefined();
 await act(async()=>renderer!.root.findByType(OnboardingGuide).props.onBack());
 expect(renderer!.root.findByType(SettingsPanel).props.initialSection).toBe('help');
 expect(channelProps.slug).toBe('fixture-0');
});


test('agent nickname save updates its preferred label without rewriting legacy owner handle',async()=>{
 await mount(true);
 const button=renderer!.root.findAllByType('button').find(button=>button.props.className==='prototype-rail-account');
 await act(async()=>button!.props.onClick({currentTarget:null}));
 await act(async()=>renderer!.root.findByType(SettingsPanel).props.onHandleSaved('agent-renamed'));
 const me=renderer!.root.findByType(SettingsPanel).props.me;
 expect(me.nickname).toBe('agent-renamed');expect(me.preferred_display).toBe('agent-renamed');
 expect(me.handle).toBe('owner-handle');
 expect(renderer!.root.findByProps({className:'app-me-name'}).children).toEqual(['agent-renamed']);
});
