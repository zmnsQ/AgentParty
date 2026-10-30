// @ts-nocheck synthetic UI fixtures only; no real credentials or model calls.
import {test,expect,beforeEach,afterEach} from 'bun:test';
import {act,create} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {RemovedAgentAccess} from './RemovedAgentAccess';
const saved=new Map();let renderer,calls,confirmed,restored,response,wait,current,loseResponse,failReadback,confirms;
const agent={name:'fixture-agent',owner:'fixture-owner',channel_scope:'a',created_at:1,access_status:'removed',can_restore:true,removal_epoch:'epoch-1'};
const text=n=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
const node=(a=agent,slug='a')=><LocaleProvider><RemovedAgentAccess agent={a} token="fixture" slug={slug} onRestored={()=>{restored++;}}/></LocaleProvider>;
function stub(k,v){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,value:v});}
const writes=()=>calls.filter(c=>c.init?.method==='POST');
beforeEach(()=>{calls=[];confirms=[];confirmed=true;restored=0;response=200;wait=null;current={...agent};loseResponse=false;failReadback=false;
 stub('IS_REACT_ACT_ENVIRONMENT',true);stub('location',{origin:'https://fixture.test'});stub('localStorage',{getItem:()=>null});stub('window',{confirm:s=>{confirms.push(s);return confirmed;}});
 stub('fetch',async(url,init)=>{calls.push({url,init});if(String(url).endsWith('/access')){if(failReadback&&writes().length)throw Error('offline');return Response.json(current);}
 if(wait)await wait;if(response===200)current={...current,access_status:'active',can_restore:false,removal_epoch:null};if(loseResponse)throw Error('lost response');return Response.json({}, {status:response});});});
afterEach(async()=>{await act(async()=>renderer?.unmount());renderer=null;for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}saved.clear();});
test('nonmoderator has clear guidance and no restore action',async()=>{await act(async()=>{renderer=create(node({...agent,can_restore:false}));});expect(calls).toHaveLength(0);expect(renderer.root.findAllByType('button')).toHaveLength(0);expect(text(renderer.root)).toContain('Ask a group moderator');});
test('cancel sends only readback; confirm names exact identity, owner and group and restores once',async()=>{
 await act(async()=>{renderer=create(node());});confirmed=false;await act(async()=>renderer.root.findByType('button').props.onClick());expect(writes()).toHaveLength(0);
 confirmed=true;await act(async()=>renderer.root.findByType('button').props.onClick());expect(writes()).toHaveLength(1);
 expect(confirms.at(-1)).toContain('fixture-agent');expect(confirms.at(-1)).toContain('fixture-owner');expect(confirms.at(-1)).toContain('group a');
 expect(writes()[0].url).toContain('/channels/a/agents/fixture-agent/restore');expect(JSON.parse(writes()[0].init.body)).toEqual({removal_epoch:'epoch-1',owner:'fixture-owner'});expect(restored).toBe(1);
 expect(calls.filter(c=>c.url.endsWith('/access'))).toHaveLength(3);
});
test('a refused write is read back and never fabricates restored membership',async()=>{response=403;await act(async()=>{renderer=create(node());});await act(async()=>renderer.root.findByType('button').props.onClick());expect(restored).toBe(0);expect(text(renderer.root)).toContain('Readback still shows removal');expect(writes()).toHaveLength(1);});
test('duplicate clicks lock and old group result never refreshes another group',async()=>{let release;wait=new Promise(r=>release=r);await act(async()=>{renderer=create(node());});await act(async()=>{const click=renderer.root.findByType('button').props.onClick;click();click();});expect(writes()).toHaveLength(1);await act(async()=>renderer.update(node({...agent,channel_scope:'b'},'b')));await act(async()=>release());expect(restored).toBe(0);});
test('lost successful write response is resolved by readback without a second write',async()=>{loseResponse=true;await act(async()=>{renderer=create(node());});await act(async()=>renderer.root.findByType('button').props.onClick());expect(restored).toBe(1);expect(writes()).toHaveLength(1);});
test('unknown outcome permits only readback on next click, never a blind second write',async()=>{response=403;loseResponse=true;failReadback=true;await act(async()=>{renderer=create(node());});await act(async()=>renderer.root.findByType('button').props.onClick());expect(text(renderer.root)).toContain('status is unknown');expect(writes()).toHaveLength(1);
 failReadback=false;await act(async()=>renderer.root.findByType('button').props.onClick());expect(writes()).toHaveLength(1);expect(restored).toBe(0);expect(text(renderer.root)).toContain('still removed');
});
test('preflight owner change blocks restoring a different identity',async()=>{current={...agent,owner:'other-owner'};await act(async()=>{renderer=create(node());});await act(async()=>renderer.root.findByType('button').props.onClick());expect(writes()).toHaveLength(0);expect(restored).toBe(0);});
