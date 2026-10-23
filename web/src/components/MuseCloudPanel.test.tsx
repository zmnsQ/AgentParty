// @ts-expect-error Bun test APIs are not part of the browser tsconfig.
import {test,expect,beforeEach,afterEach,describe} from 'bun:test';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {MuseCloudPanel} from './MuseCloudPanel';
import {MuseCloudStrings} from '../i18n/strings/MuseCloud';
let renderer:ReactTestRenderer|null=null;
const originalFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const calls:Array<{url:string;method:string}>=[];let canConfigure=true,authorized=false;
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
beforeEach(()=>{
 canConfigure=true;authorized=false;calls.length=0;
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>k==='ap_locale'?'en':null,setItem:()=>{throw Error('must_not_store_credentials')}}});
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method??'GET';calls.push({url,method});
  if(url.endsWith('/oauth-client'))return Response.json({client_id:'accli_fixture',client_secret:'synthetic-only-not-a-credential'},{status:201});
  return Response.json({can_configure:canConfigure,mcp_endpoint:'https://commons.test/api/channels/group/mcp',configuration:{authorization_endpoint:'https://commons.test/oauth/authorize',token_endpoint:'https://commons.test/oauth/token'},
   clients:authorized?[{client_id:'accli_existing',name:'Muse Cloud',active_grants:1,disabled:false,redirect_uris:[],created_at:1}]:[],
   platform_review:{status:'not_submitted',verified:false},personal_wake:{status:'requires_device_pairing',verified:false}});
 }) as typeof fetch;
});
afterEach(async()=>{if(renderer)await act(async()=>renderer?.unmount());renderer=null;globalThis.fetch=originalFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');});
async function render(){await act(async()=>{renderer=create(<LocaleProvider><MuseCloudPanel token="fixture" slug="group" canManage/></LocaleProvider>);});return renderer!.root;}
describe('Muse Cloud staged connection UI',()=>{
 test('shows independent OAuth, pairing and review states without writes on render',async()=>{
  const root=await render(),body=text(root);
  expect(body).toContain('Not configured');expect(body).toContain('A paired device is required');expect(body).toContain('No verified review decision');
  expect(root.findByProps({className:'muse-steps'}).findAllByType('li')).toHaveLength(4);expect(root.findByProps({className:'muse-native-steps'}).findAllByType('li')).toHaveLength(2);expect(calls.every(x=>x.method==='GET')).toBe(true);expect(root.findByProps({type:'url'}).props.value).toBe('');
 });
 test('MFA gate hides client registration',async()=>{
  canConfigure=false;const root=await render();expect(text(root)).toContain('two-step verification');expect(root.findAllByType('form')).toHaveLength(0);expect(calls.every(x=>x.method==='GET')).toBe(true);
 });
 test('authorized account does not imply session wake or platform approval',async()=>{
  authorized=true;const root=await render();expect(text(root)).toContain('OAuth authorized');expect(text(root)).toContain('A paired device is required');expect(text(root)).toContain('No verified review decision');
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
