// @ts-expect-error Bun test API
import {test,expect} from 'bun:test';
import {restorePanelScrollWhenReady} from './panelScrollRestore';
function harness(){
 let key='team',element:HTMLElement|null=null,timeout:(()=>void)|null=null;
 const events=new Map<string,()=>void>();const callbacks:Array<()=>void>=[];let disconnects=0,cleared=0,done=0,writes=0,top=0,height=100;
 const node={isConnected:true,children:[{}],closest:()=>null,get scrollTop(){return top;},set scrollTop(v:number){writes++;top=v;},get scrollHeight(){return height;},clientHeight:100} as unknown as HTMLElement;
 class Observer{constructor(fn:()=>void){callbacks.push(fn);}observe(){}disconnect(){disconnects++;}}
 const root={body:{},querySelector:()=>element,addEventListener:(name:string,fn:()=>void)=>events.set(name,fn),removeEventListener:(name:string)=>events.delete(name)} as unknown as Document;
 const stop=restorePanelScrollWhenReady({request:{key:'team',selector:'.panel',top:240},currentKey:()=>key,root,mutation:Observer as unknown as typeof MutationObserver,resize:Observer as unknown as typeof ResizeObserver,schedule:fn=>{timeout=fn;return 1 as unknown as ReturnType<typeof setTimeout>;},unschedule:()=>{cleared++;},onDone:()=>{done++;}});
 return {stop,mount:()=>{element=node;callbacks[1]!();},grow:(value:number)=>{height=value;callbacks[0]!();},switchTarget:()=>{key='tasks';callbacks[1]!();},input:()=>events.get('wheel')?.(),expire:()=>timeout?.(),stats:()=>({writes,top,done,disconnects,cleared,listeners:events.size}),tick:()=>callbacks.forEach(fn=>fn())};
}
test('waits for delayed mount and sufficient async height without a premature clamped write',()=>{
 const h=harness();expect(h.stats().writes).toBe(0);h.mount();expect(h.stats().done).toBe(0);
 h.grow(200);expect(h.stats().writes).toBe(0);h.grow(500);
 expect(h.stats()).toEqual({writes:1,top:240,done:1,disconnects:3,cleared:1,listeners:0});
 h.tick();expect(h.stats().writes).toBe(1);
});
test('changed destination cancels pending position and never scrolls another panel',()=>{
 const h=harness();h.switchTarget();h.mount();h.grow(900);expect(h.stats().writes).toBe(0);expect(h.stats().done).toBe(1);
});
test('close or user input cancels observers; later content cannot override the reader',()=>{
 for(const cancel of ['stop','input'] as const){const h=harness();h.mount();h[cancel]();h.grow(900);expect(h.stats().writes).toBe(0);expect(h.stats().listeners).toBe(0);}
});
test('unavailable content expires one bounded restoration without leaving listeners',()=>{
 const h=harness();h.expire();h.mount();h.grow(900);expect(h.stats().writes).toBe(0);expect(h.stats().done).toBe(1);expect(h.stats().listeners).toBe(0);
});
