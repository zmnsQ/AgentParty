// @ts-expect-error Bun test APIs are not part of the browser tsconfig.
import {beforeEach,afterEach,describe,expect,test} from "bun:test";
import {act,create,type ReactTestRenderer,type ReactTestInstance} from "react-test-renderer";
import {LocaleProvider} from "../i18n/locale";
import {ChatGptQuickStart,connectorTestPrompt} from "./ChatGptQuickStart";
import {ConnectorUsageStrings} from "../i18n/strings/ConnectorUsage";
let renderer:ReactTestRenderer|null=null;
const oldFetch=globalThis.fetch,oldStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
const oldClipboard=Object.getOwnPropertyDescriptor(globalThis.navigator,"clipboard");
const slug="ch-00000000000000000000000000000001",name="ac-oauth-0011223344556677889900112";
let readOnly=false,expired=false,disabled=false,empty=false,failed=false,otherSubscribed=false,serverMissing=false;
const copied:string[]=[],calls:Array<{url:string;method:string}>=[];
const text=(node:ReactTestInstance):string=>node.children.map(v=>typeof v==="string"?v:text(v)).join(" ");
beforeEach(()=>{
  readOnly=false;expired=false;disabled=false;empty=false;failed=false;otherSubscribed=false;serverMissing=false;copied.length=0;calls.length=0;
  Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true});
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>key==="ap_locale"?"en":null,setItem:()=>{}}});
  Object.defineProperty(globalThis.navigator,"clipboard",{configurable:true,value:{writeText:async(s:string)=>{copied.push(s);}}});
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);calls.push({url,method:init?.method??"GET"});
    if(failed)return Response.json({error:{code:"unavailable"}},{status:503});
    if(url.endsWith("/agents"))return Response.json({agents:empty?[]:[{name,owner:"fixture-account",channel_scope:slug,created_at:1,credential_kind:"oauth",oauth:{provider:"chatgpt",client_name:"ChatGPT",status:expired?"reconnect_required":"authorized",scopes:readOnly?["group.read"]:["group.events","group.read","group.write"]}}]});
    if(url.endsWith("/mcp-security"))return Response.json({can_manage:true,policy:{enabled:!disabled,allow_write:!readOnly,allow_events:true,owner_mfa_enabled:true,require_mfa:true,updated_at:1}});
    if(url.endsWith("/events/status"))return Response.json({callback_policy_configured:!serverMissing,active_subscriptions:otherSubscribed?1:0,pending_deliveries:0,agents:otherSubscribed?[{agent_name:"another-agent",active_subscriptions:1}]:[]});
    throw new Error("Unexpected request "+url);
  }) as typeof fetch;
});
afterEach(async()=>{
  if(renderer)await act(async()=>renderer?.unmount());renderer=null;globalThis.fetch=oldFetch;
  if(oldStorage)Object.defineProperty(globalThis,"localStorage",oldStorage);else Reflect.deleteProperty(globalThis,"localStorage");
  if(oldClipboard)Object.defineProperty(globalThis.navigator,"clipboard",oldClipboard);else Reflect.deleteProperty(globalThis.navigator,"clipboard");
});
async function render(){await act(async()=>{renderer=create(<LocaleProvider><ChatGptQuickStart token="fixture-human" slug={slug} canManage/></LocaleProvider>);});return renderer!.root;}
const copies=(root:ReactTestInstance)=>root.findAllByType("button").filter(b=>text(b).includes("Copy prompt")||text(b).includes("Copied."));
describe("authorized plugin first-use guidance",()=>{
  test("explains authorization, three usage steps and no automatic subscription",async()=>{
    const root=await render(),body=text(root);
    expect(body).toContain("OAuth authorized");expect(body).toContain("Not subscribed · no automatic response");
    expect(body).toContain("Verify identity and read access");expect(body).toContain("Send one message back");
    expect(body).toContain("Copying does not count as a passed test");expect(body).not.toContain("credential missing");
    expect(root.findAllByType("textarea")).toHaveLength(4);
    expect(root.findByProps({href:"https://chatgpt.com/"}).props.rel).toContain("noopener");
  });
  test("copies a read-only scoped prompt, without making a write request or subscribing",async()=>{
    const root=await render();await act(async()=>{await copies(root)[0]!.props.onClick();});
    expect(copied).toHaveLength(1);expect(copied[0]).toContain(slug);expect(copied[0]).toContain(name);
    expect(copied[0]).toContain("Do not post");expect(calls.every(c=>c.method==="GET")).toBe(true);
    expect(text(root)).toContain("Paste and send it in ChatGPT");
  });
  test("the reply prompt is one message, no mentions, with a retry-safe idempotency key",async()=>{
    const root=await render();await act(async()=>{await copies(root)[1]!.props.onClick();});
    expect(copied[0]).toContain("exactly one message");expect(copied[0]).toContain("Do not @mention");expect(copied[0]).toContain("idempotency_key");
    expect(copied[0]).toBe(connectorTestPrompt("post",slug,name,false));
    expect(calls.every(c=>c.method==="GET")).toBe(true);
  });
  test("read-only grants disable reply/task prompts without changing permission",async()=>{
    readOnly=true;const root=await render();expect(copies(root).map(b=>b.props.disabled)).toEqual([false,true,true]);
    expect(text(root)).toContain("Not currently allowed");
  });
  test("disabled group MCP policy disables all test prompts",async()=>{
    disabled=true;const root=await render();expect(copies(root).every(b=>b.props.disabled)).toBe(true);
  });
  test("expired authorization is not shown as ready and cannot copy write prompts",async()=>{
    expired=true;const root=await render();expect(text(root)).toContain("Reauthorization required");expect(copies(root).every(b=>b.props.disabled)).toBe(true);
  });
  test("another agent's subscription does not imply this ChatGPT identity is subscribed",async()=>{
    otherSubscribed=true;const root=await render();expect(text(root)).toContain("Not subscribed · no automatic response");expect(text(root)).not.toContain("Subscription exists");
  });
  test("missing grant shows first-time guidance, not an empty authorized state",async()=>{
    empty=true;const root=await render();expect(text(root)).toContain("No active ChatGPT OAuth connection");expect(copies(root)).toHaveLength(0);
  });
  test("a status failure is visible and does not claim connection succeeded",async()=>{
    failed=true;const root=await render();expect(text(root)).toContain("Connection status could not be checked");expect(copies(root)).toHaveLength(0);
  });
  test("server event configuration failure is actionable and does not disable existing read or reply",async()=>{
    serverMissing=true;const root=await render();expect(text(root)).toContain("Event callbacks not configured");
    expect(text(root)).toContain("operator configures callback security");
    expect(copies(root).map(b=>b.props.disabled)).toEqual([false,false,false]);
    expect(calls.every(c=>c.method==="GET")).toBe(true);
  });
  test("copies an explicit native subscription request without creating a scheduled poll or writing to a group",async()=>{
    const root=await render();const button=root.findAllByType("button").find(b=>text(b)==="Copy event subscription request")!;
    expect(button.props.disabled).toBe(false);
    await act(async()=>{await button.props.onClick();});
    expect(copied[0]).toContain("native MCP Events");expect(copied[0]).toContain("mention_only true");
    expect(copied[0]).toContain(slug);expect(copied[0]).toContain(name);expect(copied[0]).toContain("Do not replace events with scheduled polling");
    expect(calls.every(c=>c.method==="GET")).toBe(true);
  });
  test("blocks subscription guidance when server transport is not configured",async()=>{
    serverMissing=true;const root=await render();
    expect(root.findAllByType("button").find(b=>text(b)==="Copy event subscription request")!.props.disabled).toBe(true);
  });
  test("all guidance translations and exact group-scoped prompts exist in both languages",()=>{
    expect(Object.keys(ConnectorUsageStrings.en).sort()).toEqual(Object.keys(ConnectorUsageStrings.zh).sort());
    expect(connectorTestPrompt("read",slug,name,true)).toContain("不要发消息");
    expect(connectorTestPrompt("post",slug,name,true)).toContain("不要 @其他 Agent");
    expect(connectorTestPrompt("task",slug,name,true)).toContain("不匹配就停止");
  });
});
