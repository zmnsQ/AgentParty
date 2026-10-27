// @ts-expect-error Bun test API is not part of browser tsconfig.
import {afterEach,expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {LocaleProvider} from "../i18n/locale";
import {HomeScreenGuide} from "./HomeScreenGuide";
// @ts-expect-error Node APIs are provided by Bun for tests.
import {readFileSync} from "node:fs";
const original=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
afterEach(()=>{if(original)Object.defineProperty(globalThis,"localStorage",original);else Reflect.deleteProperty(globalThis,"localStorage");});
function render(locale:string){Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>locale}});return renderToStaticMarkup(<LocaleProvider><HomeScreenGuide/></LocaleProvider>);}
test("guide is explicit user action, bilingual and honest about limitations",()=>{
 const en=render("en"),zh=render("zh");
 expect(en).toContain("Add to Home Screen");expect(en).toContain("Edit Actions");expect(en).toContain("not a native app");expect(en).toContain("<details>");
 expect(zh).toContain("添加到主屏幕");expect(zh).toContain("仍需联网与有效登录");expect(zh).toContain("不是原生 App");expect(zh).toContain("support.apple.com");
});
test("manifest uses stable scoped standalone launch without locking orientation or caching",()=>{
 const manifest=JSON.parse(readFileSync(new URL("../../public/manifest.webmanifest",import.meta.url),"utf8"));
 expect(manifest.display).toBe("standalone");expect(manifest.scope).toBe("/");expect(manifest.start_url).toBe("/");expect(manifest.orientation).toBeUndefined();
 const icon=readFileSync(new URL("../../public/brand/mark.png",import.meta.url));expect(icon.readUInt32BE(16)).toBe(256);expect(icon.readUInt32BE(20)).toBe(256);expect(manifest.icons[0].sizes).toBe("256x256");
 const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");expect(html).toContain('rel="manifest"');expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');expect(html).toContain("viewport-fit=cover");expect(html).not.toContain("user-scalable=no");
});
