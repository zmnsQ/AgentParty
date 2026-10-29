// @ts-nocheck isolated synthetic fixtures, never production credentials
import {test,expect,beforeEach,afterEach} from 'bun:test';
import {act,create} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {RemovedAgentAccess} from './RemovedAgentAccess';
const saved=new Map();let renderer,calls,confirmed,restored,response,wait;
const agent={name:'fixture-agent',owner:'fixture-owner',channel_scope:'a',created_at:1,access_status:'removed',can_restore:true,removal_epoch:'epoch-1'};
const text=n=>n.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
const node=(a=agent,slug='a')=><LocaleProvider><RemovedAgentAccess agent={a} token="fixture" slug={slug} onRestored={()=>{restored++;}}/></LocaleProvider>;
function stub(k,v){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,value:v});}
beforeEach(()=>{calls=[];confirmed=true;restored=0;response=200;wait=null;stub('IS_REACT_ACT_ENVIRONMENT',true);stub('location',{origin:'https://fixture.test'});stub('localStorage',{getItem:()=>null});stub('window',{confirm:()=>confirmed});stub('fetch',async(url,init)=>{calls.push({url,init});if(wait)await wait;return Response.json({}, {status:response});});});
afterEach(async()=>{await act(async()=>renderer?.unmount());for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}saved.clear();});
test('no automatic recovery; nonmoderator has no action',async()=>{await act(async()=>{renderer=create(node({...agent,can_restore:false}));});expect(calls).toHaveLength(0);expect(renderer.root.findAllByType('button')).toHaveLength(0);expect(text(renderer.root)).toContain('Regenerating a token does not restore membership');});
test('cancel does not restore; explicit confirmation sends precise existing member route',async()=>{await act(async()=>{renderer=create(node());});confirmed=false;await act(async()=>renderer.root.findByType('button').props.onClick());expect(calls).toHaveLength(0);confirmed=true;await act(async()=>renderer.root.findByType('button').props.onClick());expect(calls).toHaveLength(1);expect(calls[0].url).toContain('/channels/a/agents/fixture-agent/restore');expect(calls[0].init.method).toBe('POST');expect(JSON.parse(calls[0].init.body)).toEqual({removal_epoch:'epoch-1'});expect(restored).toBe(1);});
test('failure does not fabricate membership',async()=>{response=403;await act(async()=>{renderer=create(node());});await act(async()=>renderer.root.findByType('button').props.onClick());expect(restored).toBe(0);expect(text(renderer.root)).toContain('not confirmed');});
test('double click is locked and old group result cannot refresh new group',async()=>{let release;wait=new Promise(r=>release=r);await act(async()=>{renderer=create(node());});await act(async()=>{const click=renderer.root.findByType('button').props.onClick;click();click();});expect(calls).toHaveLength(1);await act(async()=>renderer.update(node({...agent,channel_scope:'b'},'b')));await act(async()=>release());expect(restored).toBe(0);});
