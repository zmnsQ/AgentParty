// @ts-expect-error Bun runs this test outside the Vite TypeScript typecheck.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "../i18n/locale";
import { AttributionStrings } from "../i18n/strings/Attribution";
import { OriginalProjectCredit } from "../components/OriginalProjectCredit";
// @ts-expect-error Bun executes this test; the Vite tsconfig excludes Node built-in types.
import { readFileSync } from "node:fs";
// @ts-expect-error Bun executes this test; the Vite tsconfig excludes Node built-in types.
import { resolve } from "node:path";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function credit(locale: "en" | "zh"): string {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key:string) => key === "ap_locale" ? locale : null, setItem:()=>{} },
  });
  return renderToStaticMarkup(<LocaleProvider><OriginalProjectCredit /></LocaleProvider>);
}
// @ts-expect-error Bun supplies import.meta.dir; Vite typecheck does not.
const css = (name:string) => readFileSync(resolve(import.meta.dir, name),"utf8");
describe("Agent Commons author credit and responsive layout", () => {
  test("EN and ZH attribute the current product to zmnsQ and distinguish the original AgentParty author", () => {
    expect(Object.keys(AttributionStrings.en).sort()).toEqual(Object.keys(AttributionStrings.zh).sort());
    const en=credit("en"), zh=credit("zh");
    expect(en).toContain("Created and maintained by zmnsQ");
    expect(zh).toContain("作者及维护者：zmnsQ");
    for(const markup of [en,zh]) {
      expect(markup).toContain("AgentParty");
      expect(markup).toContain("Guo Li");
      expect(markup).toContain("leeguoo");
      expect(markup).toContain("BUSL-1.1");
      expect(markup).toContain('href="https://github.com/zmnsQ"');
      expect(markup).toContain('href="https://github.com/leeguooooo/AgentParty"');
      expect(markup).toContain('href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE"');
      expect(markup).not.toContain("Attribution.");
    }
  });
  test("four-tab collaboration navigation fits a phone by scrolling, without clipping content", () => {
    const styles=css("collaboration.css");
    expect(styles).toContain("@media (max-width: 720px)");
    expect(styles).toMatch(/\.commons-nav \[role=tablist\]\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
    expect(styles).toMatch(/\.commons-tab\s*\{[^}]*min-height:\s*44px;/s);
    expect(styles).toContain("minmax(0, 1fr)");
    expect(styles).toContain("100dvh");
    expect(styles).toContain("safe-area-inset-bottom");
    expect(styles).toContain("@media (max-width: 430px)");
    expect(styles).toMatch(/\.commons-agent-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  });
  test("mobile login, GitHub 2FA and plugin forms keep 44px targets and 16px inputs", () => {
    const auth=css("../components/browser-auth.css");
    const connectors=css("cloud-bridges.css");
    const upstream=css("original-project-credit.css");
    expect(auth).toContain("@media (max-width: 600px)");
    expect(auth).toContain("safe-area-inset-bottom");
    expect(auth).toMatch(/\.browser-auth-stack input:not\(\[type=checkbox\]\)[^{]*\{[^}]*font-size:\s*16px;[^}]*min-height:\s*44px;/s);
    expect(connectors).toContain("@media (max-width: 720px)");
    expect(connectors).toMatch(/\.cloud-bridge-form input,[\s\S]*?\.cloud-bridge-form textarea\s*\{[^}]*font-size:\s*16px;/s);
    expect(connectors).toMatch(/\.cloud-bridge-form \.d-btn\s*\{[^}]*width:\s*100%;/s);
    expect(upstream).toContain("overflow-wrap: anywhere");
    expect(upstream).toContain("--t-faint");
  });
});
