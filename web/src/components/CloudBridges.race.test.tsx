// @ts-nocheck Bun component regression tests.
import {test,expect,beforeEach,afterEach} from "bun:test";
import {act,create} from "react-test-renderer";
import {CloudBridges} from "./CloudBridges";
import {LocaleProvider} from "../i18n/locale";
import {setApiBase,clearApiBase} from "../lib/base";
const originalFetch=globalThis.fetch;let renderer;let posts;let pending;let actDescriptor;
const configured={connection:{name:"Fixture",configured:true},deliveries:[],agents:[],active_subscriptions:0,pending_deliveries:0};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const view=(props={})=><LocaleProvider><CloudBridges token="a" slug="group" canManage canRun initialProvider="grok" showAuthorizationManagement={false} {...props}/></LocaleProvider>;
async function mount(){await act(async()=>{renderer=create(view());});}
async function prompt(text="hello"){await act(async()=>renderer.root.findByType("textarea").props.onChange({target:{value:text}}));}
const form=()=>renderer.root.findAllByType("form").find(f=>f.findAllByType("textarea").length);
beforeEach(()=>{posts=[];pending=[];setApiBase("https://first.example");actDescriptor=Object.getOwnPropertyDescriptor(globalThis,"IS_REACT_ACT_ENVIRONMENT");Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true});
 globalThis.fetch=async(input,init)=>{if(init?.method==="POST"){const d=deferred();posts.push({url:String(input),body:JSON.parse(init.body)});pending.push(d);return d.promise;}return Response.json(configured);};});
afterEach(async()=>{await act(async()=>renderer?.unmount());renderer=null;globalThis.fetch=originalFetch;clearApiBase();if(actDescriptor)Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",actDescriptor);else Reflect.deleteProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT");});
test("same-turn double submit sends once and unknown explicit retry reuses request ID",async()=>{
 await mount();await prompt();const submit=form().props.onSubmit;
 await act(async()=>{submit({preventDefault(){}});submit({preventDefault(){}});});
 expect(posts).toHaveLength(1);
 await act(async()=>pending[0].reject(new Error("timeout")));
 await act(async()=>form().props.onSubmit({preventDefault(){}}));expect(posts).toHaveLength(2);expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
 await act(async()=>pending[1].resolve(Response.json({delivery:{state:"unknown"}})));
 expect(renderer.root.findByType("textarea").props.value).toBe("hello");
 await act(async()=>form().props.onSubmit({preventDefault(){}}));expect(posts[2].body.request_id).toBe(posts[0].body.request_id);
});
test("base-only scope switch clears sensitive drafts/busy and ignores late success",async()=>{
 await mount();await prompt("private old prompt");
 await act(async()=>renderer.root.findByProps({type:"password"}).props.onChange({target:{value:"private secret"}}));
 await act(async()=>form().props.onSubmit({preventDefault(){}}));
 setApiBase("https://second.example");await act(async()=>renderer.update(view()));
 expect(renderer.root.findByType("textarea").props.value).toBe("");expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
 expect(renderer.root.findByProps({type:"password"}).props.value).toBe("");
 await prompt("new prompt");await act(async()=>pending[0].resolve(Response.json({delivery:{state:"submitted"}})));
 expect(renderer.root.findByType("textarea").props.value).toBe("new prompt");
 await act(async()=>form().props.onSubmit({preventDefault(){}}));expect(posts[1].url.startsWith("https://second.example/")).toBe(true);
});
test("permission revocation rejects stale handlers and clears drafts on regain",async()=>{
 await mount();await prompt("old");const submit=form().props.onSubmit;
 await act(async()=>renderer.update(view({canRun:false,canManage:false})));
 await act(async()=>submit({preventDefault(){}}));expect(posts).toHaveLength(0);
 await act(async()=>renderer.update(view()));expect(renderer.root.findByType("textarea").props.value).toBe("");
});
test("old Cue discovery cannot expose account results after token/group switch",async()=>{
 await act(async()=>{renderer=create(view({initialProvider:"cue"}));});
 await act(async()=>renderer.root.findByProps({type:"password"}).props.onChange({target:{value:"old-api-key"}}));
 await act(async()=>renderer.root.findByType("form").props.onSubmit({preventDefault(){}}));
 expect(posts[0].body.credential).toBe("old-api-key");
 await act(async()=>renderer.update(view({initialProvider:"cue",token:"b",slug:"different"})));
 expect(renderer.root.findByProps({type:"password"}).props.value).toBe("");expect(renderer.root.findByProps({type:"password"}).props.disabled).toBe(false);
 await act(async()=>pending[0].resolve(Response.json({agents:[{id:"private-old-agent",name:"Old Account Agent"}]})));
 expect(JSON.stringify(renderer.toJSON())).not.toContain("Old Account Agent");
});
test("unknown dispatch survives token refresh without storing or restoring old draft",async()=>{
 await mount();await prompt("same request");await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 await act(async()=>pending[0].reject(new Error("timeout")));
 await act(async()=>renderer.update(view({token:"refreshed"})));
 expect(renderer.root.findByType("textarea").props.value).toBe("");
 await prompt("same request");await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 expect(posts).toHaveLength(2);expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
});
test("in-flight dispatch keeps its lock across token refresh and permission churn",async()=>{
 await mount();await prompt("same request");await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 await act(async()=>renderer.update(view({token:"refreshed",canManage:false})));
 expect(renderer.root.findByType("textarea").props.disabled).toBe(true);
 await prompt("same request");await act(async()=>form().props.onSubmit({preventDefault(){}}));expect(posts).toHaveLength(1);expect(renderer.root.findByType("textarea").props.disabled).toBe(true);
 await act(async()=>pending[0].reject(new Error("timeout")));
 expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 expect(posts).toHaveLength(2);expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
});

import {CollaborationHub} from "./CollaborationHub";
import {ownedGrokSubmissionSafety} from "../lib/grokSubmissionSafety";
function hubFixture(){
 const memory={current:null};
 const client={summary:async()=>({permissions:{manage:true,run:true,upload:true},agents:[],repositories:[],files:[],runs:[]})};
 return (token="a",owner="owner")=><LocaleProvider><CollaborationHub token={token} slug="group" client={client} initialProvider="grok" submissionSafety={ownedGrokSubmissionSafety(memory,owner,"https://first.example","group")} dispatchScopeReady={owner!==null}/></LocaleProvider>;
}
test("real Hub token-key remount preserves unknown ID, including temporarily unknown account",async()=>{
 const hub=hubFixture();await act(async()=>{renderer=create(hub());});await prompt("same task");
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 await act(async()=>pending[0].reject(new Error("timeout")));
 await act(async()=>renderer.update(hub("renewed",null)));
 expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
 await act(async()=>renderer.update(hub("renewed","owner")));expect(renderer.root.findByType("textarea").props.value).toBe("");
 await prompt("same task");await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
});
test("real Hub remount retains in-flight lock and receives release without old response",async()=>{
 const hub=hubFixture();await act(async()=>{renderer=create(hub());});await prompt("task");
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 await act(async()=>renderer.update(hub("renewed")));expect(renderer.root.findByType("textarea").props.disabled).toBe(true);
 await prompt("task");await act(async()=>form().props.onSubmit({preventDefault(){}}));expect(posts).toHaveLength(1);
 await act(async()=>pending[0].reject(new Error("timeout")));expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
});
test("known different account receives isolated request ID after Hub remount",async()=>{
 const hub=hubFixture();await act(async()=>{renderer=create(hub());});await prompt("same task");
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 await act(async()=>pending[0].reject(new Error("timeout")));
 await act(async()=>renderer.update(hub("other-token","different-owner")));await prompt("same task");
 await act(async()=>{form().props.onSubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));});
 expect(posts[1].body.request_id).not.toBe(posts[0].body.request_id);
});
