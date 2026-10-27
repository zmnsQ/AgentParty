// @ts-expect-error Bun test API is not part of browser tsconfig.
import {afterEach,expect,test} from "bun:test";
import {isStandaloneDisplay} from "./standalone";
const originals=["window","navigator"].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
afterEach(()=>{for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
function environment(matches:boolean,standalone=false){
 Object.defineProperty(globalThis,"window",{configurable:true,value:{matchMedia:()=>({matches})}});
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{standalone}});
}
test("reports browser versus standalone display without assuming an install",()=>{
 environment(false);expect(isStandaloneDisplay()).toBe(false);
 environment(true);expect(isStandaloneDisplay()).toBe(true);
 environment(false,true);expect(isStandaloneDisplay()).toBe(true);
});
test("is safe without a browser",()=>{Reflect.deleteProperty(globalThis,"window");expect(isStandaloneDisplay()).toBe(false);});
