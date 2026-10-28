import {test,expect} from "bun:test";
import {settleCurrentRequest} from "./latestRequest";
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(err:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test("obsolete page success cannot append history, move scroll anchor, or clear current loading",async()=>{
 let generation=1;const old=deferred<number[]>();const events:string[]=[];
 const run=settleCurrentRequest(old.promise,()=>generation===1,{success:()=>events.push("append+anchor"),error:()=>events.push("error"),settled:()=>events.push("loading=false")});
 generation=2;old.resolve([1,2]);await run;expect(events).toEqual([]);
 await settleCurrentRequest(Promise.resolve([3]),()=>generation===2,{success:rows=>events.push(`append:${rows}`),error:()=>events.push("error"),settled:()=>events.push("loading=false")});
 expect(events).toEqual(["append:3","loading=false"]);
});
test("old-token 401 after token change or unmount cannot log out the replacement session",async()=>{
 let current=true;const old=deferred<never>();let loggedOut=0,finished=0;
 const run=settleCurrentRequest(old.promise,()=>current,{success:()=>{},error:()=>{loggedOut++;},settled:()=>{finished++;}});
 current=false;old.reject(new Error("401"));await run;expect([loggedOut,finished]).toEqual([0,0]);
 await settleCurrentRequest(Promise.reject(new Error("401")),()=>true,{success:()=>{},error:()=>{loggedOut++;},settled:()=>{finished++;}});
 expect([loggedOut,finished]).toEqual([1,1]);
});
