import {pinToBottom} from './scrollPin';
import type {MsgFrame} from '@agentparty/shared';
/** Presence, receipts and status refreshes are not new conversational content. */
export function conversationContentKey(messages:readonly MsgFrame[]):string {
 return JSON.stringify(messages.filter(message=>message.kind!=='status').map(message=>[
  message.seq,message.body,message.retracted??false,message.attachments??[],
 ]));
}
export interface ReadingAnchor {element:HTMLElement;offset:number;}
export function captureReadingAnchor(viewport:HTMLElement):ReadingAnchor|null {
 const top=viewport.getBoundingClientRect().top;
 for(const element of viewport.querySelectorAll<HTMLElement>('.msg-card, .team-thread')) {
  const rect=element.getBoundingClientRect();
  if(rect.height>0&&rect.bottom>top+1)return {element,offset:rect.top-top};
 }
 return null;
}
export function restoreReadingAnchor(viewport:HTMLElement,anchor:ReadingAnchor|null):boolean {
 if(!anchor||!viewport.contains(anchor.element))return false;
 const delta=anchor.element.getBoundingClientRect().top-viewport.getBoundingClientRect().top-anchor.offset;
 if(Math.abs(delta)<.5)return false;
 viewport.scrollTop+=delta;
 return true;
}
/** First sequence identifies a contiguous thread; appending must not remount it. */
export function teamThreadRenderKey(thread:{key:string;firstSeq:number}):string {
 return `${thread.key}:${thread.firstSeq}`;
}
export interface ThreadRenderIdentity {team:string;key:string;sequences:ReadonlySet<number>;}
/** Retain a segment's identity on either append or prepend; never share keys
 * between separate contiguous runs of the same team. Only current runs retained. */
export function reconcileThreadIdentities(
 threads:readonly {key:string;firstSeq:number;messages:readonly {seq:number}[]}[],
 previous:readonly ThreadRenderIdentity[],
):ThreadRenderIdentity[] {
 const used=new Set<string>();
 return threads.map(thread=>{
  const sequences=new Set(thread.messages.map(message=>message.seq));
  const old=previous.find(item=>item.team===thread.key&&!used.has(item.key)&&[...sequences].some(seq=>item.sequences.has(seq)));
  let key=old?.key??teamThreadRenderKey(thread);
  while(used.has(key))key+=':segment';
  used.add(key);
  return {team:thread.key,key,sequences};
 });
}

/** Idempotent geometry correction: scroll writes do not resize either observed box. */
export function stabilizeConversation(viewport:HTMLElement,follow:boolean,anchor:ReadingAnchor|null):ReadingAnchor|null {
 if(follow)pinToBottom(viewport,true);
 else restoreReadingAnchor(viewport,anchor);
 return captureReadingAnchor(viewport);
}
export function observeConversationGeometry(viewport:HTMLElement,onResize:()=>void,Factory:typeof ResizeObserver|undefined=globalThis.ResizeObserver):()=>void {
 const observer=Factory?new Factory(onResize):null;
 observer?.observe(viewport);
 const content=viewport.querySelector('.conversation-inner');
 if(content)observer?.observe(content);
 viewport.addEventListener('load',onResize,true);
 return ()=>{observer?.disconnect();viewport.removeEventListener('load',onResize,true);};
}
