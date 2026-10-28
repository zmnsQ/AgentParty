// @ts-expect-error Bun test runner
import {test,expect,beforeEach,afterEach} from "bun:test";
import {act,create,type ReactTestRenderer,type ReactTestInstance} from "react-test-renderer";
import {CloudBridges} from "./CloudBridges";
import {LocaleProvider} from "../i18n/locale";
const fetchOriginal=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
let renderer:ReactTestRenderer|null=null;const calls:string[]=[];
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==="string"?c:text(c)).join(" ");
beforeEach(()=>{
 calls.length=0;
 Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true});
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>"en",setItem:()=>{}}});
 globalThis.fetch=(async(_input:unknown,init?:RequestInit)=>{calls.push(init?.method??"GET");return Response.json({connection:null,deliveries:[],active_subscriptions:0,pending_deliveries:0,agents:[]});}) as typeof fetch;
});
afterEach(async()=>{if(renderer)await act(async()=>renderer?.unmount());renderer=null;globalThis.fetch=fetchOriginal;if(storage)Object.defineProperty(globalThis,"localStorage",storage);else Reflect.deleteProperty(globalThis,"localStorage");});
test("Hermes choice has a real next step and does not mutate configuration",async()=>{
 let next="";await act(async()=>{renderer=create(<LocaleProvider><CloudBridges token="fixture" slug="group" canManage canRun initialProvider="hermes" onConfigureApi={v=>{next=v;}}/></LocaleProvider>);});
 const root=renderer!.root;expect(text(root)).toContain("running Hermes API Server");
 expect(root.findAllByType("form")).toHaveLength(0);
 await act(async()=>root.findAllByType("button").find(n=>text(n)==="Continue with Hermes")!.props.onClick());
 expect(next).toBe("hermes");expect(calls.every(m=>m==="GET")).toBe(true);
 expect(text(root)).not.toContain("two-step verification");
});
test("Cue discovery is separate from binding and Grok does not promise personal login",async()=>{
 await act(async()=>{renderer=create(<LocaleProvider><CloudBridges token="fixture" slug="group" canManage canRun initialProvider="cue" onConfigureApi={()=>{}}/></LocaleProvider>);});
 const root=renderer!.root;expect(text(root)).toContain("Continue with Cue");
 await act(async()=>root.findAllByType("button").find(n=>text(n).includes("Grok Bot"))!.props.onClick());
 expect(text(root)).toContain("not a personal Grok Bot login");expect(text(root)).toContain("replies are not automatically imported");
 expect(root.findAllByProps({type:"password"})).toHaveLength(1);
 expect(calls.every(m=>m==="GET")).toBe(true);
});
