// @ts-expect-error Bun test APIs are not part of the browser tsconfig.
import {test,expect,beforeEach,afterEach,describe} from 'bun:test';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {MuseCloudPanel} from './MuseCloudPanel';
import {MuseCloudStrings} from '../i18n/strings/MuseCloud';
let renderer:ReactTestRenderer|null=null;
const originalFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const calls:Array<{url:string;method:string}>=[];let canConfigure=true,authorized=false;let oauthStatus:string|undefined;
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
beforeEach(()=>{
 canConfigure=true;authorized=false;oauthStatus=undefined;calls.length=0;
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>k==='ap_locale'?'en':null,setItem:()=>{throw Error('must_not_store_credentials')}}});
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method??'GET';calls.push({url,method});
  if(url.endsWith('/oauth-client'))return Response.json({client_id:'accli_fixture',client_secret:'synthetic-only-not-a-credential'},{status:201});
  return Response.json({native_oauth:oauthStatus?{status:oauthStatus,checked_at:1,client_verified:false}:undefined,can_configure:canConfigure,mcp_endpoint:'https://commons.test/api/channels/group/mcp',configuration:{authorization_endpoint:'https://commons.test/oauth/authorize',token_endpoint:'https://commons.test/oauth/token'},
   clients:authorized?[{client_id:'accli_existing',name:'Muse Cloud',active_grants:1,disabled:false,redirect_uris:[],created_at:1}]:[],
   platform_review:{status:'not_submitted',verified:false},personal_wake:{status:'requires_device_pairing',verified:false}});
 }) as typeof fetch;
});
afterEach(async()=>{if(renderer)await act(async()=>renderer?.unmount());renderer=null;globalThis.fetch=originalFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');});
async function render(mode:'mcp'|'gadget'|null='mcp'){await act(async()=>{renderer=create(<LocaleProvider><MuseCloudPanel token="fixture" slug="group" canManage/></LocaleProvider>);});if(mode)await act(async()=>renderer!.root.findAllByProps({className:'muse-method'})[mode==='mcp'?0:1]!.props.onClick());return renderer!.root;}
describe('Muse Cloud staged connection UI',()=>{
 test('shows independent OAuth, pairing and review states without writes on render',async()=>{
  const root=await render(),body=text(root);
  expect(body).toContain('Not configured');expect(body).toContain('not this website signing in to control your personal Muse');
  expect(root.findByProps({className:'muse-steps'}).findAllByType('li')).toHaveLength(3);expect(root.findByProps({className:'muse-native-steps'}).findAllByType('li')).toHaveLength(2);expect(calls.every(x=>x.method==='GET')).toBe(true);expect(root.findByProps({type:'url'}).props.value).toBe('');
 });
 test('first screen makes the three routes distinct without URLs, credentials or write actions',async()=>{
  const root=await render(null),body=text(root);
  expect(root.findAllByProps({className:'muse-method'})).toHaveLength(3);
  expect(body).toContain('MCP · Let Muse use group tools');expect(body).toContain('Gadget · Relay tasks through a paired device');
  expect(body).toContain('This is not web sign-in to Muse');expect(body).toContain('Requires:');
  expect(root.findAllByType('input')).toHaveLength(0);expect(root.findAllByType('a')).toHaveLength(0);expect(calls.every(x=>x.method==='GET')).toBe(true);
 });
 test('personal gateway is opt-in to view and only requests read-only status',async()=>{
  const root=await render(null);
  expect(calls.some(x=>x.url.endsWith('/bridges/muse-personal'))).toBe(false);
  await act(async()=>root.findAllByProps({className:'muse-method'})[2]!.props.onClick());
  expect(calls.filter(x=>x.url.endsWith('/bridges/muse-personal'))).toHaveLength(1);
  expect(calls.every(x=>x.method==='GET')).toBe(true);
  expect(text(root)).toContain('Real account testing is deferred');
  expect(root.findAllByType('input')).toHaveLength(0);
 });
 test('Gadget steps disclose prerequisites and keep repository references in advanced details',async()=>{
  const root=await render('gadget'),primary=root.findByProps({className:'muse-gadget-primary'}),body=text(primary);
  expect(body).toContain('This is not web authorization');expect(body).toContain('Stop here if none is available');expect(body).toContain('not marked online');
  expect(primary.findByType('details').props.open).toBeUndefined();expect(text(primary.findByType('summary'))).toContain('not a connect button');
  expect(primary.findAllByType('li')).toHaveLength(4);expect(root.findAllByType('input')).toHaveLength(0);expect(root.findAllByType('form')).toHaveLength(0);
  expect(root.findAllByProps({className:'muse-legacy'})).toHaveLength(0);expect(calls.every(x=>x.method==='GET')).toBe(true);
 });
 test('switching methods returns to chooser without configuration mutations',async()=>{
  const root=await render('gadget');await act(async()=>root.findByProps({className:'d-btn muse-method-back'}).props.onClick());
  expect(root.findAllByProps({className:'muse-method'})).toHaveLength(3);expect(root.findAllByProps({className:'muse-gadget-primary'})).toHaveLength(0);
  await act(async()=>root.findAllByProps({className:'muse-method'})[0]!.props.onClick());expect(root.findAllByProps({type:'url'})).toHaveLength(1);expect(calls.every(x=>x.method==='GET')).toBe(true);
 });
 test('MFA gate hides client registration',async()=>{
  canConfigure=false;const root=await render();expect(text(root)).toContain('two-step verification');expect(root.findAllByType('form')).toHaveLength(0);expect(calls.every(x=>x.method==='GET')).toBe(true);
 });
 test('authorized account does not imply session wake or platform approval',async()=>{
  authorized=true;const root=await render();expect(text(root)).toContain('Authorization saved · current usability unverified');expect(text(root)).toContain('immediate wake-ups are not guaranteed');
 });
 test('expired access is not presented as working and recovery does not mutate credentials',async()=>{
  authorized=true;oauthStatus='refresh_required';const root=await render();
  expect(text(root)).toContain('Access expired · client refresh required');
  expect(text(root)).toContain('cannot repair the Muse app');
  expect(text(root)).toContain('Do not bypass it');
  expect(calls.every(x=>x.method==='GET')).toBe(true);
 });
 test('server-valid access explicitly leaves the Muse client unverified',async()=>{
  authorized=true;oauthStatus='access_valid';expect(text(await render())).toContain('Server credential valid · client unverified');
 });
 test('only explicit submission creates a client and one-time value can be dismissed',async()=>{
  const root=await render();await act(async()=>root.findByProps({type:'url'}).props.onChange({target:{value:'https://platform.muse.ai/callback/fixture'}}));
  await act(async()=>root.findByType('form').props.onSubmit({preventDefault(){}}));
  expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);expect(root.findByProps({type:'password'}).props.value).toBe('synthetic-only-not-a-credential');
  expect(text(root)).not.toContain('synthetic-only-not-a-credential');
  const close=root.findAllByType('button').find(x=>text(x).includes('I have saved it securely'))!;
  await act(async()=>close.props.onClick());expect(root.findAllByProps({type:'password'})).toHaveLength(0);
 });
 test('EN and ZH dictionaries have matching keys',()=>expect(Object.keys(MuseCloudStrings.en).sort()).toEqual(Object.keys(MuseCloudStrings.zh).sort()));
});
