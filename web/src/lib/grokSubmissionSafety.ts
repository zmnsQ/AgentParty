/** Parent-owned, account/server/group-scoped memory. No credentials or prompt text. */
export interface GrokSubmissionSafety {
  key:string; ids:Map<string,string>; salt:string; inFlight:boolean;
  listeners:Set<()=>void>;
}
export function createGrokSubmissionSafety(base:string,slug:string):GrokSubmissionSafety {
  return {key:JSON.stringify([base,slug]),ids:new Map(),salt:crypto.randomUUID(),inFlight:false,listeners:new Set()};
}
export function notifyGrokSubmissionSafety(store:GrokSubmissionSafety):void {
  for(const listener of store.listeners)listener();
}
export interface GrokSubmissionOwnerMemory {current:{owner:string;store:GrokSubmissionSafety}|null;}
/** A temporarily unresolved actor cannot use or destroy the last known actor's guard. */
export function ownedGrokSubmissionSafety(memory:GrokSubmissionOwnerMemory,owner:string|null,base:string,slug:string):GrokSubmissionSafety|undefined {
  if(owner===null)return undefined;
  if(memory.current?.owner!==owner||memory.current.store.key!==JSON.stringify([base,slug])) {
    memory.current={owner,store:createGrokSubmissionSafety(base,slug)};
  }
  return memory.current.store;
}
