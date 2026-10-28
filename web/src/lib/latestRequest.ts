/** Suppress every side effect of an obsolete async request, including errors/finally. */
export async function settleCurrentRequest<T>(request: Promise<T>, isCurrent: () => boolean, handlers: {
  success(value:T):void; error(error:unknown):void; settled():void;
}):Promise<void> {
  try { const value=await request; if(isCurrent()) handlers.success(value); }
  catch(error) { if(isCurrent()) handlers.error(error); }
  finally { if(isCurrent()) handlers.settled(); }
}
