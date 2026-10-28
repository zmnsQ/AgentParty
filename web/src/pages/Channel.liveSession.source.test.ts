// @ts-nocheck — Bun 执行本测试；web tsconfig 只加载 Vite 全局类型，这里读源码做回归门禁。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// #1103：live session 取代频道面板而不是叠在上面——两个 aria-modal + 两套 Esc/Tab focus trap 会互相打架。
describe("Channel live session dialog (#1103)", () => {
  test("openLiveSession replaces active surfaces while preserving its return location", () => {
    const src = readFileSync(resolve(import.meta.dir, "Channel.tsx"), "utf8");
    const start = src.indexOf("const openLiveSession = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("}, [", start));
    expect(body).toContain('rememberPanelOrigin("live-session")');
    // Global close clears return history; a nested transition must not use it.
    expect(body).not.toContain("closeChannelPanel();");
    for (const close of ["setActivePanel(null)", "setActiveAdminSurface(null)"]) {
      expect(body).toContain(close);
      expect(body.indexOf(close)).toBeLessThan(body.indexOf("setLiveSessionTarget(name)"));
    }
    expect(src).toContain('onBack={panelBackTarget?()=>{setLiveSessionTarget(null);backChannelPanel();}:undefined}');
    expect(src).toContain('const closeLiveSession = useCallback(() => {setLiveSessionTarget(null);setPanelOrigins([]);}, []);');
  });
});
