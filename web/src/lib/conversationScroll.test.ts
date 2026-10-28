// @ts-expect-error Bun test API.
import {expect,test} from 'bun:test';
import type {MsgFrame} from '@agentparty/shared';
import {stabilizeConversation,observeConversationGeometry,conversationContentKey,captureReadingAnchor,restoreReadingAnchor,teamThreadRenderKey,reconcileThreadIdentities} from './conversationScroll';
const message={seq:1,kind:'message',body:'Hello',sender:{name:'test',kind:'agent'}} as MsgFrame;
test('status refresh does not change conversation key; body streaming does',()=>{
 const initial=conversationContentKey([message]);
 expect(conversationContentKey([message,{...message,seq:2,kind:'status',body:'working'}])).toBe(initial);
 expect(conversationContentKey([{...message,note:'new receipt'}])).toBe(initial);
 expect(conversationContentKey([{...message,body:'Hello world'}])).not.toBe(initial);
 expect(conversationContentKey([message,{...message,seq:3}])).not.toBe(initial);
});
test('appending a team message preserves its DOM key and expanded state identity',()=>{
 const thread={key:'root::team',firstSeq:1,lastSeq:2};
 expect(teamThreadRenderKey({...thread,lastSeq:3})).toBe(teamThreadRenderKey(thread));
 expect(teamThreadRenderKey({...thread,firstSeq:9})).not.toBe(teamThreadRenderKey(thread));
});
test('status height changes above an up-scrolled reader keep the same visual anchor',()=>{
 const element={getBoundingClientRect:()=>({top:145})} as HTMLElement;
 const viewport={scrollTop:400,contains:(node:unknown)=>node===element,getBoundingClientRect:()=>({top:100})} as unknown as HTMLElement;
 expect(restoreReadingAnchor(viewport,{element,offset:20})).toBe(true);
 expect(viewport.scrollTop).toBe(425);
 expect(restoreReadingAnchor(viewport,{element,offset:45})).toBe(false);
});
test('removed anchor never changes scroll position',()=>{
 const viewport={scrollTop:400,contains:()=>false} as unknown as HTMLElement;
 expect(restoreReadingAnchor(viewport,{element:{} as HTMLElement,offset:20})).toBe(false);
 expect(viewport.scrollTop).toBe(400);
});

test('capture skips hidden elements and tracks the first actually visible message',()=>{
 const hidden={getBoundingClientRect:()=>({height:0,top:0,bottom:0})};
 const above={getBoundingClientRect:()=>({height:30,top:10,bottom:40})};
 const visible={getBoundingClientRect:()=>({height:50,top:80,bottom:130})};
 const viewport={getBoundingClientRect:()=>({top:100}),querySelectorAll:()=>[hidden,above,visible]} as unknown as HTMLElement;
 const anchor=captureReadingAnchor(viewport);
 expect(anchor?.element).toBe(visible);
 expect(anchor?.offset).toBe(-20);
});

test('prepend retains an expanded thread identity; separate runs never share keys',()=>{
 const old=reconcileThreadIdentities([{key:'team',firstSeq:5,messages:[{seq:5},{seq:6}]}],[]);
 const next=reconcileThreadIdentities([{key:'team',firstSeq:3,messages:[{seq:3},{seq:5},{seq:6},{seq:7}]},{key:'team',firstSeq:9,messages:[{seq:9},{seq:10}]}],old);
 expect(next[0]!.key).toBe(old[0]!.key);
 expect(next[1]!.key).not.toBe(next[0]!.key);
 expect(next).toHaveLength(2);
});

test('geometry observer watches both viewport and changing content and cleans up',()=>{
 const inner={};const watched:unknown[]=[];let disconnected=false;let removed=false;
 class Observer {constructor(readonly callback:()=>void){}observe(el:unknown){watched.push(el);}disconnect(){disconnected=true;}}
 const viewport={querySelector:()=>inner,addEventListener:()=>{},removeEventListener:()=>{removed=true;}} as unknown as HTMLElement;
 const cleanup=observeConversationGeometry(viewport,()=>{},Observer as unknown as typeof ResizeObserver);
 expect(watched).toEqual([viewport,inner]);cleanup();expect(disconnected).toBe(true);expect(removed).toBe(true);
});
test('repeated geometry notifications are idempotent at bottom and preserve an up-scrolled anchor',()=>{
 let top=800,writes=0,height=1000;
 const element={getBoundingClientRect:()=>({top:900-top,bottom:950-top,height:50})} as HTMLElement;
 const viewport={get scrollTop(){return top;},set scrollTop(value:number){top=value;writes++;},get scrollHeight(){return height;},clientHeight:200,contains:()=>true,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[element]} as unknown as HTMLElement;
 let anchor=stabilizeConversation(viewport,true,null);
 expect(writes).toBe(0);height=1040;
 anchor=stabilizeConversation(viewport,true,anchor);expect(top).toBe(840);
 stabilizeConversation(viewport,true,anchor);expect(writes).toBe(1);
 top=500;writes=0;anchor=captureReadingAnchor(viewport);height=1100;
 stabilizeConversation(viewport,false,anchor);expect(top).toBe(500);expect(writes).toBe(0);
});
