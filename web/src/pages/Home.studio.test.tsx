// @ts-expect-error Bun test API is not part of browser tsconfig.
import {afterEach,beforeEach,describe,expect,test} from "bun:test";
import {act,create,type ReactTestRenderer,type ReactTestInstance} from "react-test-renderer";
import {Home} from "./Home";
import {LocaleProvider} from "../i18n/locale";
import {StudioStrings} from "../i18n/strings/Studio";
import type {ChannelInfo} from "../lib/api";
const stored=Object.getOwnPropertyDescriptor(globalThis,"localStorage");let renderer:ReactTestRenderer|null=null;
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==="string"?c:text(c)).join(" ");
beforeEach(()=>{Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true});Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>"en",setItem:()=>{}}});});
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;if(stored)Object.defineProperty(globalThis,"localStorage",stored);else Reflect.deleteProperty(globalThis,"localStorage");});
async function mount(props:Parameters<typeof Home>[0]){await act(async()=>{renderer=create(<LocaleProvider><Home {...props}/></LocaleProvider>);});return renderer!.root;}
function channel(title:string,slug:string):ChannelInfo{return {slug,title,kind:"standing",mode:"normal",visibility:"private",archived_at:null,topic:null,summary:null,created_at:0} as unknown as ChannelInfo;}
describe("Conversation-first landing",()=>{
 test("offers a real create action rather than a terminal command and never auto-creates",async()=>{let creates=0;const root=await mount({channels:[],onOpen:()=>{},onCreate:()=>{creates++;}});expect(creates).toBe(0);expect(text(root)).toContain("Create your first group");expect(text(root)).not.toContain("party invite");const button=root.findAllByType("button").find(b=>text(b).includes("Create your first group"))!;await act(async()=>button.props.onClick());expect(creates).toBe(1);});
 test("read-only visitors do not get a fake create action",async()=>{const root=await mount({channels:[],onOpen:()=>{}});expect(root.findAllByProps({className:"d-btn d-btn--primary studio-create-cta"})).toHaveLength(0);});
 test("fallback opens the authorized first group without rendering a second dashboard",async()=>{let opened="";const root=await mount({channels:[channel("Design notes","ch-aaa"),channel("Build plan","ch-bbb")],onOpen:s=>{opened=s;}});expect(root.findAllByProps({type:"search"})).toHaveLength(0);expect(root.findAllByProps({className:"d-card home-card"})).toHaveLength(0);await act(async()=>root.findByType("button").props.onClick());expect(opened).toBe("ch-aaa");});
 test("only shows a loading state while server data is unknown",async()=>{const root=await mount({channels:null,onOpen:()=>{}});expect(root.findByProps({role:"status"})).toBeTruthy();expect(text(root)).not.toContain("A place for your first collaboration");});
 test("has complete bilingual copy",()=>{expect(Object.keys(StudioStrings.en).sort()).toEqual(Object.keys(StudioStrings.zh).sort());expect(StudioStrings.zh["Studio.welcome"]).toContain("一起完成");});
});
