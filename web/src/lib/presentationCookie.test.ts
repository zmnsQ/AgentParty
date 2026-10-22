// @ts-expect-error Bun tests run outside the browser typecheck.
import {afterEach,describe,expect,test} from "bun:test";
import {writePresentationCookie} from "./presentationCookie";
const doc=Object.getOwnPropertyDescriptor(globalThis,"document"),loc=Object.getOwnPropertyDescriptor(globalThis,"location");
afterEach(()=>{for(const [key,desc]of [["document",doc],["location",loc]] as const){if(desc)Object.defineProperty(globalThis,key,desc);else Reflect.deleteProperty(globalThis,key);}});
function fake(protocol="https:"){const writes:string[]=[];Object.defineProperty(globalThis,"document",{configurable:true,value:{set cookie(s:string){writes.push(s);}}});Object.defineProperty(globalThis,"location",{configurable:true,value:{protocol}});return writes;}
describe("host-only display preferences for server rendered OAuth",()=>{
 test("syncs only theme and language, with HTTPS Secure and SameSite=Lax",()=>{const out=fake();writePresentationCookie("ap_theme","midnight");writePresentationCookie("ap_locale","zh");expect(out).toEqual(["ap_theme=midnight; Path=/; SameSite=Lax; Max-Age=31536000; Secure","ap_locale=zh; Path=/; SameSite=Lax; Max-Age=31536000; Secure"]);expect(out.join(";")).not.toContain("Domain=");});
 test("never writes unrecognized preferences or a value that could inject cookie attributes",()=>{const out=fake();writePresentationCookie("ap_theme","midnight; Domain=evil.test");writePresentationCookie("ap_locale","fr");expect(out).toHaveLength(0);});
 test("handles non-HTTPS development and restricted/absent document",()=>{const out=fake("http:");writePresentationCookie("ap_theme","doodle");expect(out[0]).not.toContain("Secure");Reflect.deleteProperty(globalThis,"document");expect(()=>writePresentationCookie("ap_locale","en")).not.toThrow();});
});
