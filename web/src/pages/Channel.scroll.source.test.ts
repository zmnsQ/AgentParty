// @ts-expect-error Bun executes this test, while the web tsconfig intentionally loads only Vite globals.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(import.meta.dir + "/Channel.tsx", "utf8");

const geometry = readFileSync(import.meta.dir + "/../lib/conversationScroll.ts", "utf8");

test("channel stream stabilizes before paint and observes late geometry without overriding history reading", () => {
  // Geometry is now shared with tested helpers rather than an inline RAF repin loop.
  expect(source).toMatch(/useLayoutEffect\(\(\) => \{\s*const el = streamRef.current;\s*if \(el === null \|\| pendingAnchorRef.current !== null\) return;\s*readingAnchorRef.current = stabilizeConversation\(el, stickBottom.current, readingAnchorRef.current\);/);
  expect(source).toContain("return observeConversationGeometry(el, repin);");
  expect(source).toMatch(/const repin = \(\) => \{\s*if \(pendingAnchorRef.current !== null\) return;/);
  expect(geometry).toContain("if(follow)pinToBottom(viewport,true);");
  expect(geometry).toContain("else restoreReadingAnchor(viewport,anchor);");
  expect(geometry).toContain("observer?.observe(viewport)");
  expect(geometry).toContain("if(content)observer?.observe(content)");
  expect(geometry).toContain("viewport.addEventListener('load',onResize,true)");
  expect(geometry).toContain("observer?.disconnect()");
  expect(geometry).toContain("viewport.removeEventListener('load',onResize,true)");
  expect(geometry).not.toContain("requestAnimationFrame");
  expect(source).toContain("el.scrollTop = el.scrollHeight - anchor.height + anchor.top;");
});
