// @ts-nocheck local fixture only
import {test,expect,beforeEach,afterEach} from 'bun:test';
import {act,create} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {McpReadiness} from './McpReadiness';
const saved=new Map();let renderer,calls,response;
const text=n=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
const node=(slug='a',token='fixture')=><LocaleProvider><McpReadiness slug={slug} token={token}/></LocaleProvider>;
function stub(k,v){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,value:v});}
beforeEach(()=>{calls=[];response={policy:{enabled:false,owner_mfa_enabled:false,allow_write:false,allow_events:false},can_manage:false};stub('IS_REACT_ACT_ENVIRONMENT',true);stub('location',{origin:'https://fixture.test'});stub('localStorage',{getItem:()=>null});stub('fetch',async(url,init)=>{calls.push({url,method:init?.method});return Response.json(response);});});
afterEach(async()=>{await act(async()=>renderer?.unmount());for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}saved.clear();});
test('default closed and MFA unmet are explicit, never silently enable or mint',async()=>{
 await act(async()=>{renderer=create(node());});expect(text(renderer.root)).toContain('disabled (returns 403)');expect(text(renderer.root)).toContain('not enabled (returns 403)');expect(text(renderer.root)).toContain('does not mean the Token is invalid');expect(calls).toHaveLength(1);expect(calls[0].method).toBe('GET');expect(calls[0].url).toContain('/channels/a/mcp-security');
});
test('readiness is not connected claim; recheck is read-only',async()=>{
 response.policy.enabled=true;response.policy.owner_mfa_enabled=true;await act(async()=>{renderer=create(node());});expect(text(renderer.root)).toContain('prerequisites are satisfied; verify');
 await act(async()=>renderer.root.findByType('button').props.onClick());expect(calls).toHaveLength(2);expect(calls.every(c=>c.method==='GET')).toBe(true);
});
test('network or malformed response is unknown, never ready',async()=>{
 response={};await act(async()=>{renderer=create(node());});expect(text(renderer.root)).toContain('Could not verify');expect(text(renderer.root)).not.toContain('prerequisites are satisfied');
});
test('late old-group status cannot overwrite current group',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);globalThis.fetch=async(url)=>String(url).includes('/a/')?pending:Response.json(response);
 await act(async()=>{renderer=create(node());});await act(async()=>renderer.update(node('b')));await act(async()=>resolve(Response.json({policy:{enabled:true,owner_mfa_enabled:true},can_manage:true})));
 expect(text(renderer.root)).toContain('disabled (returns 403)');expect(text(renderer.root)).not.toContain('prerequisites are satisfied');
});

test('owner can expand real settings and explicitly save; viewing never changes permissions',async()=>{
 response.can_manage=true;response.policy.owner_mfa_enabled=true;
 await act(async()=>{renderer=create(node());});
 await act(async()=>renderer.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
 const toggles=renderer.root.findAllByType('input').filter(n=>n.props.type==='checkbox');expect(toggles).toHaveLength(3);expect(toggles[0].props.checked).toBe(false);expect(calls.every(c=>c.method==='GET')).toBe(true);
 await act(async()=>toggles[0].props.onChange({target:{checked:true}}));expect(calls.every(c=>c.method==='GET')).toBe(true);
 const save=renderer.root.findAllByType('button').find(n=>text(n).includes('Save'));
 expect(save).toBeTruthy();await act(async()=>save.props.onClick());expect(calls.some(c=>c.method==='PUT')).toBe(true);
});
test('non-owner sees status without owner permission controls',async()=>{
 await act(async()=>{renderer=create(node());});await act(async()=>renderer.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
 expect(renderer.root.findAllByType('input').filter(n=>n.props.type==='checkbox')).toHaveLength(0);expect(calls.every(c=>c.method==='GET')).toBe(true);
});
