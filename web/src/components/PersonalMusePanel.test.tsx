// @ts-expect-error Bun test APIs are not part of the browser tsconfig.
import {test,expect,beforeEach,afterEach} from 'bun:test';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {PersonalMusePanel} from './PersonalMusePanel';
let renderer:ReactTestRenderer|null=null;
const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let status=200,data:unknown;const calls:string[]=[];
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
beforeEach(()=>{
 status=200;data={enabled:false,configured:false,state:'unconfigured'};calls.length=0;
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>k==='ap_locale'?'en':null}});
 globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{calls.push(init?.method??'GET');return Response.json(data,{status});}) as typeof fetch;
});
afterEach(async()=>{if(renderer)await act(async()=>renderer?.unmount());renderer=null;globalThis.fetch=oldFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');});
async function render(canManage=true){await act(async()=>{renderer=create(<LocaleProvider><PersonalMusePanel token="fixture" slug="group" canManage={canManage}/></LocaleProvider>);});return renderer!.root;}
test('default disabled is not connected and only GET is used, including refresh',async()=>{
 const root=await render();expect(text(root)).toContain('Not enabled on this server');expect(text(root)).toContain('not an official Muse login integration');
 expect(root.findAllByType('input')).toHaveLength(0);expect(root.findAllByType('form')).toHaveLength(0);
 await act(async()=>root.findByType('button').props.onClick());expect(calls).toEqual(['GET','GET']);
});
test('missing endpoint explicitly means not enabled, not expired credentials',async()=>{status=404;const body=text(await render());expect(body).toContain('Not enabled on this server');expect(body).not.toContain('reconnect required');});
test('permissions and server errors never become ready',async()=>{status=403;expect(text(await render())).toContain('do not have permission');});
test('malformed and unknown status stays unknown',async()=>{data={enabled:true,configured:true,state:'online'};expect(text(await render())).toContain('Gateway status unknown');});
test('no manage permission sends no request',async()=>{await render(false);expect(calls).toHaveLength(0);});
for(const state of ['unconfigured','auth_required','ready_readonly','active','polling','reconnect_required','submission_unknown','disconnected']){
 test(`${state} preserves verification boundaries and never renders secret payloads`,async()=>{
  data={enabled:true,configured:true,state,last_checked_at:1234,reason:'SECRET_REASON',cookie:'SECRET_COOKIE',token:'SECRET_TOKEN',binding:{account_label:'My account note'}};
  const body=text(await render());expect(body).toContain('Actual Muse access, delivery and replies have not been independently verified');expect(body).not.toContain('SECRET_');expect(calls).toEqual(['GET']);
  if(state==='polling')expect(body).toContain('not a real-time event subscription');
  if(state==='submission_unknown')expect(body).toContain('check before any retry');
 });
}

test('an old group response cannot replace the current group state',async()=>{
 let finish:(response:Response)=>void=()=>{};
 globalThis.fetch=(async(input:RequestInfo|URL)=>String(input).includes('/group/')?await new Promise<Response>(resolve=>{finish=resolve;}):Response.json({enabled:false,configured:false,state:'unconfigured'})) as typeof fetch;
 const root=await render();
 await act(async()=>renderer!.update(<LocaleProvider><PersonalMusePanel token="fixture" slug="next-group" canManage/></LocaleProvider>));
 await act(async()=>finish(Response.json({enabled:true,configured:true,state:'active'})));
 expect(text(root)).toContain('Not enabled on this server');expect(text(root)).not.toContain('Connector reports: active');
});
async function fill(root:ReactTestInstance){for(const [name,value] of [['account_label','My account'],['sidechat_label','My dedicated chat'],['sidechat_id','chat_123']])await act(async()=>root.findByProps({name}).props.onChange({currentTarget:{value}}));}
test('enabled form is collapsed and explicit save is the only binding mutation',async()=>{
 data={enabled:true,configured:false,state:'unconfigured'};const root=await render();expect(root.findByType('details').props.open).toBeUndefined();expect(calls).toEqual(['GET']);
 expect(root.findAllByType('input').map(x=>x.props.name)).toEqual(['account_label','sidechat_label','sidechat_id']);await fill(root);
 const writes:unknown[]=[];globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{calls.push(init?.method??'GET');if(init?.method==='PUT'){writes.push(JSON.parse(String(init.body)));return Response.json({binding_id:'binding-1'});}return Response.json({enabled:true,configured:true,state:'reconnect_required',binding:{binding_id:'binding-1'}});}) as typeof fetch;
 await act(async()=>root.findByType('form').props.onSubmit({preventDefault(){}}));
 expect(writes).toEqual([{account_label:'My account',sidechat_label:'My dedicated chat',sidechat_id:'chat_123'}]);expect(calls.filter(x=>x==='PUT')).toHaveLength(1);expect(text(root)).toContain('Local binding saved and read back');expect(text(root)).toContain('Actual Muse access is still unverified');
});
test('MFA rejection never claims save success',async()=>{
 data={enabled:true,configured:false,state:'unconfigured'};const root=await render();await fill(root);status=403;
 await act(async()=>root.findByType('form').props.onSubmit({preventDefault(){}}));expect(text(root)).toContain('must complete two-step verification');expect(text(root)).not.toContain('Local binding saved and read back');
});
test('local unbind needs confirmation and readback and never revokes provider login',async()=>{
 data={enabled:true,configured:true,state:'reconnect_required',binding:{binding_id:'binding-1'}};const root=await render();
 await act(async()=>root.findAllByType('button').find(x=>text(x)==='Unbind locally')!.props.onClick());expect(calls).toEqual(['GET']);expect(text(root)).toContain('does not revoke your Muse login');
 globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{calls.push(init?.method??'GET');return Response.json(init?.method==='DELETE'?{removed:true}:{enabled:true,configured:false,state:'unconfigured',binding:null});}) as typeof fetch;
 await act(async()=>root.findAllByType('button').find(x=>text(x)==='Confirm local unbind')!.props.onClick());expect(calls.filter(x=>x==='DELETE')).toHaveLength(1);expect(text(root)).toContain('Local binding removed and read back');
});
test('uncertain save blocks blind retry and never claims success',async()=>{
 data={enabled:true,configured:false,state:'unconfigured'};const root=await render();await fill(root);
 globalThis.fetch=(async()=>{throw Error('network_lost');}) as typeof fetch;
 await act(async()=>root.findByType('form').props.onSubmit({preventDefault(){}}));expect(text(root)).toContain('Change outcome unknown');expect(root.findByProps({type:'submit'}).props.disabled).toBe(true);expect(text(root)).not.toContain('Local binding saved and read back');
});
