/** In-memory UI locations only: never credentials or connection form drafts. */
export function pushPanelOrigin<T extends {key:string}>(stack:readonly T[],current:T|null,targetKey:string):T[]{
 if(!current||current.key===targetKey)return [...stack];
 const revisit=stack.findIndex(item=>item.key===targetKey);
 if(revisit>=0)return stack.slice(0,revisit);
 const withoutDuplicate=stack.filter(item=>item.key!==current.key);
 return [...withoutDuplicate,current].slice(-12);
}
export function popPanelOrigin<T>(stack:readonly T[]):{previous:T|null;remaining:T[]}{
 return {previous:stack.at(-1)??null,remaining:stack.slice(0,-1)};
}
