// @ts-expect-error Bun test API is not part of browser tsconfig.
import {afterEach,expect,test} from "bun:test";
import {COMPACT_MEDIA,installMobileViewport,isCompactViewport} from "./mobileViewport";
const descriptors=["window","document"].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
let dispose:(()=>void)|undefined;
afterEach(()=>{dispose?.();dispose=undefined;for(const [key,value] of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
class Events {
 listeners=new Map<string,Set<()=>void>>();
 addEventListener=(key:string,fn:()=>void)=>{if(!this.listeners.has(key))this.listeners.set(key,new Set());this.listeners.get(key)!.add(fn);};
 removeEventListener=(key:string,fn:()=>void)=>{this.listeners.get(key)?.delete(fn);};
 emit(key:string){for(const fn of this.listeners.get(key)??[])fn();}
 count(){return [...this.listeners.values()].reduce((n,set)=>n+set.size,0);}
}
function fixture(){
 const style=new Map<string,string>(),classes=new Set<string>(),media=Object.assign(new Events(),{matches:true});
 const viewport=Object.assign(new Events(),{height:800,offsetTop:0,scale:1});
 const meta={content:"width=device-width, initial-scale=1, viewport-fit=cover"};
 let next=1;const frames=new Map<number,()=>void>();
 const win=Object.assign(new Events(),{innerWidth:390,innerHeight:800,visualViewport:viewport,matchMedia:()=>media,
  requestAnimationFrame:(fn:()=>void)=>{const id=next++;frames.set(id,fn);return id;},cancelAnimationFrame:(id:number)=>frames.delete(id)});
 const doc=Object.assign(new Events(),{activeElement:null as null|{closest:(selector:string)=>unknown},querySelector:()=>meta,documentElement:{
  style:{getPropertyValue:(k:string)=>style.get(k)??"",setProperty:(k:string,v:string)=>style.set(k,v),removeProperty:(k:string)=>style.delete(k)},
  classList:{toggle:(k:string,on:boolean)=>on?classes.add(k):classes.delete(k),remove:(...keys:string[])=>keys.forEach(k=>classes.delete(k))}}});
 Object.defineProperty(globalThis,"window",{configurable:true,value:win});Object.defineProperty(globalThis,"document",{configurable:true,value:doc});
 return {style,classes,media,viewport,meta,win,doc,frames,flush(){for(const [id,fn] of frames){frames.delete(id);fn();}}};
}
test("compact media includes short coarse landscape, not desktop height alone",()=>{
 expect(COMPACT_MEDIA).toContain("(max-height: 760px) and (pointer: coarse)");
 expect(COMPACT_MEDIA).toContain("(max-device-height: 760px) and (pointer: coarse)");
 const f=fixture();expect(isCompactViewport()).toBe(true);f.media.matches=false;expect(isCompactViewport()).toBe(false);
});
test("portrait to short landscape stays compact and never rewrites meta or applies zoom",()=>{
 const f=fixture(),meta=f.meta.content;dispose=installMobileViewport();
 expect(f.style.get("--ac-viewport-height")).toBe("800px");
 f.win.innerWidth=844;f.win.innerHeight=390;f.viewport.height=390;f.win.emit("orientationchange");f.flush();
 expect(f.classes.has("ac-mobile")).toBe(true);expect(f.style.get("--ac-viewport-height")).toBe("390px");
 expect(f.meta.content).toBe(meta);expect(f.style.has("zoom")).toBe(false);expect(f.style.has("--ac-layout-scale")).toBe(false);
});
test("keyboard sizing uses CSS pixels and pinch is never classified as keyboard",()=>{
 const f=fixture();dispose=installMobileViewport();f.doc.activeElement={closest:()=>({})};f.viewport.height=260;f.viewport.offsetTop=12;
 f.doc.emit("focusin");f.viewport.emit("resize");f.flush();
 expect(f.classes.has("ac-keyboard-open")).toBe(true);expect(f.style.get("--ac-viewport-height")).toBe("260px");
 f.viewport.scale=2;f.viewport.emit("resize");f.flush();
 expect(f.classes.has("ac-keyboard-open")).toBe(false);expect(f.style.has("--ac-viewport-height")).toBe(false);expect(f.style.has("zoom")).toBe(false);
 f.viewport.scale=1;f.viewport.height=800;f.viewport.offsetTop=0;f.doc.activeElement=null;f.doc.emit("focusout");f.flush();
 expect(f.classes.has("ac-keyboard-open")).toBe(false);expect(f.style.get("--ac-viewport-height")).toBe("800px");
});
test("media transitions and cleanup remove owned state and listeners",()=>{
 const f=fixture();f.style.set("--ac-layout-scale","2.5");f.style.set("zoom","2.5");dispose=installMobileViewport();
 expect(f.style.has("zoom")).toBe(false);f.media.matches=false;f.media.emit("change");f.flush();
 expect(f.classes.has("ac-mobile")).toBe(false);expect(f.style.has("--ac-viewport-height")).toBe(false);
 f.win.emit("resize");dispose();dispose=undefined;
 expect(f.frames.size).toBe(0);expect(f.win.count()+f.doc.count()+f.media.count()+f.viewport.count()).toBe(0);
});
test("invalid zero visual viewport height does not collapse app",()=>{
 const f=fixture();f.viewport.height=0;dispose=installMobileViewport();expect(f.style.has("--ac-viewport-height")).toBe(false);
});
