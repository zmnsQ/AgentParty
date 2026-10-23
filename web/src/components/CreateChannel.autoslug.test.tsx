// @ts-expect-error Bun executes this test, while the web tsconfig loads browser globals only.
import { afterEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LocaleProvider } from "../i18n/locale";
import { CreateChannelStrings } from "../i18n/strings/CreateChannel";
import { CreateChannel } from "./CreateChannel";

let renderer:ReactTestRenderer|null=null;
const realFetch=globalThis.fetch;
const descriptor=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
afterEach(()=>{
  act(()=>renderer?.unmount());renderer=null;
  globalThis.fetch=realFetch;
  if(descriptor)Object.defineProperty(globalThis,"localStorage",descriptor);
  else Reflect.deleteProperty(globalThis,"localStorage");
});
async function openForm(onCreated:(s:string)=>void=()=>{}){
  await act(async()=>{renderer=create(<LocaleProvider><CreateChannel token="ap_test" onCreated={onCreated}/></LocaleProvider>);});
  await act(async()=>{renderer!.root.findByProps({className:"d-pill chan-pill newchan-open"}).props.onClick();});
  return renderer!.root;
}
describe("new channel needs only a name; server allocates the ID",()=>{
  test("no slug field exists, and the client uses the server-allocated ID for navigation",async()=>{
    const requests:Record<string,unknown>[]=[];
    const slug="ch-0123456789abcdef0123456789abcdef";
    let navigated="";
    globalThis.fetch=(async (_input:RequestInfo|URL,init?:RequestInit)=>{
      requests.push(JSON.parse(String(init?.body)) as Record<string,unknown>);
      return Response.json({slug,title:"AI Agent 协作测试群"},{status:201});
    }) as typeof fetch;
    const root=await openForm(value=>{navigated=value;});
    expect(root.findAllByProps({className:"t-mono newchan-input"})).toHaveLength(0);
    const fields=root.findAllByType("input");
    expect(fields).toHaveLength(2); // friendly name + party checkbox, no slug.
    const name=root.findByProps({id:"newchan-name"});
    expect(name.props.maxLength).toBe(80);
    await act(async()=>{name.props.onChange({target:{value:"  AI Agent 协作测试群  "}});});
    await act(async()=>{await root.findByProps({className:"d-btn d-btn--primary"}).props.onClick();});
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind:"standing",title:"AI Agent 协作测试群",mode:"normal",visibility:"private",
    });
    expect(requests[0]).not.toHaveProperty("slug");
    expect(navigated).toBe(slug);
  });
  test("missing group name does not submit or call the server",async()=>{
    let calls=0;
    globalThis.fetch=(async()=>{calls++;return Response.json({slug:"ch-something"});}) as typeof fetch;
    const root=await openForm();
    const createButton=root.findByProps({className:"d-btn d-btn--primary"});
    expect(createButton.props.disabled).toBe(true);
    await act(async()=>{await createButton.props.onClick();});
    expect(calls).toBe(0);
    expect(root.findByProps({role:"alert"}).children.join("")).toContain("Enter a channel name");
  });
  test("bad or missing server IDs do not navigate",async()=>{
    globalThis.fetch=(async()=>Response.json({slug:"BAD-ID"},{status:201})) as typeof fetch;
    let navigated=false;
    const root=await openForm(()=>{navigated=true;});
    await act(async()=>{root.findByProps({id:"newchan-name"}).props.onChange({target:{value:"Nice Group"}});});
    await act(async()=>{await root.findByProps({className:"d-btn d-btn--primary"}).props.onClick();});
    expect(navigated).toBe(false);
    expect(root.findByProps({role:"alert"}).children.join("")).toContain("Couldn't create");
  });
  test("IME candidate confirmation never creates a group and rapid clicks share one request",async()=>{
    let calls=0,finish!:(response:Response)=>void;
    globalThis.fetch=(async()=>{calls++;return new Promise<Response>(r=>{finish=r;});}) as typeof fetch;
    const root=await openForm();
    await act(async()=>root.findByProps({id:"newchan-name"}).props.onChange({target:{value:"中文协作"}}));
    await act(async()=>root.findByProps({id:"newchan-name"}).props.onKeyDown({key:"Enter",keyCode:229,nativeEvent:{isComposing:false},preventDefault(){}}));
    expect(calls).toBe(0);
    await act(async()=>{const b=root.findByProps({className:"d-btn d-btn--primary"});void b.props.onClick();void b.props.onClick();});
    expect(calls).toBe(1);
    await act(async()=>finish(Response.json({slug:"ch-unique"},{status:201})));
  });
  test("Chinese and English names/automatic identifier hints are translated",()=>{
    expect(Object.keys(CreateChannelStrings.en).sort()).toEqual(Object.keys(CreateChannelStrings.zh).sort());
    expect(CreateChannelStrings.zh["CreateChannel.nameLabel"]).toBe("群组名称");
    expect(CreateChannelStrings.zh["CreateChannel.generatedHint"]).toContain("自动生成");
    expect(CreateChannelStrings.en["CreateChannel.generatedHint"]).toContain("automatically");
  });
});
