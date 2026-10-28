export interface PanelScrollRequest {key:string;top:number;selector:string;}
interface RestoreOptions {
 request:PanelScrollRequest;
 currentKey:()=>string|null;
 root:Document;
 onDone?:()=>void;
 mutation?:typeof MutationObserver;
 resize?:typeof ResizeObserver;
 schedule?:(callback:()=>void,ms:number)=>ReturnType<typeof setTimeout>;
 unschedule?:(id:ReturnType<typeof setTimeout>)=>void;
}
/** One navigation's bounded restoration. Wait for mount AND sufficient content,
 * never clamp prematurely or move a different destination. User input cancels. */
export function restorePanelScrollWhenReady({request,currentKey,root,onDone,mutation=globalThis.MutationObserver,resize=globalThis.ResizeObserver,schedule=setTimeout,unschedule=clearTimeout}:RestoreOptions):()=>void {
 let stopped=false,container:HTMLElement|null=null;
 let mutationObserver:MutationObserver|null=null,resizeObserver:ResizeObserver|null=null;
 let timer:ReturnType<typeof setTimeout>|null=null;
 const inputEvents=['pointerdown','wheel','touchstart','keydown'] as const;
 const stop=()=>{
  if(stopped)return;stopped=true;
  mutationObserver?.disconnect();resizeObserver?.disconnect();
  if(timer!==null)unschedule(timer);
  for(const name of inputEvents)root.removeEventListener(name,stop,true);
  onDone?.();
 };
 const attempt=()=>{
  if(stopped)return;
  if(currentKey()!==request.key){stop();return;}
  const next=root.querySelector<HTMLElement>(request.selector);
  if(!next||!next.isConnected||next.closest('[hidden]'))return;
  if(next!==container){container=next;resizeObserver?.disconnect();resizeObserver?.observe(next);}
  // The scroller's own box may stay fixed while its children or font grow.
  for(const child of next.children)resizeObserver?.observe(child);
  const top=Math.max(0,request.top);
  if(next.scrollHeight-next.clientHeight+.5<top)return;
  if(Math.abs(next.scrollTop-top)>.5)next.scrollTop=top;
  stop();
 };
 resizeObserver=resize?new resize(attempt):null;
 mutationObserver=mutation?new mutation(attempt):null;
 if(root.body)mutationObserver?.observe(root.body,{childList:true,subtree:true,characterData:true});
 for(const name of inputEvents)root.addEventListener(name,stop,true);
 // Expire one transition, not an open-ended listener per page or API refresh.
 timer=schedule(stop,10_000);
 attempt();
 return stop;
}
