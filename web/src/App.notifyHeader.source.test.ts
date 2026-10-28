// @ts-expect-error Bun executes this test, while the web tsconfig intentionally loads only Vite globals.
import { describe, expect, test } from "bun:test";
// @ts-expect-error Bun provides node:fs for this source-level ownership contract test.
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const channelSource = readFileSync(new URL("./pages/Channel.tsx", import.meta.url), "utf8");
const visibilitySource = readFileSync(new URL("./components/VisibilityToggle.tsx", import.meta.url), "utf8");

describe("channel header controls", () => {
  test("the shared sidebar account tools own the mention toggle and the channel only consumes its state", () => {
    expect(appSource).toMatch(/const accountControls = \([\s\S]*<header className="workspace-account-controls">[\s\S]*className="app-channel-notify"[\s\S]*<NotifyToggle/);
    expect(appSource).toContain("navigationFooter={accountControls}");
    expect(appSource).toContain("mobileActions={accountControls}");
    expect(appSource).not.toContain('className="app-head prototype-rail"');
    expect(appSource).toContain("notifyOptin={notifyOptin}");
    expect(channelSource).not.toContain("<NotifyToggle");
  });

  test("visibility help is available on demand instead of as permanent toolbar text", () => {
    expect(visibilitySource).toContain('<FeatureTip tip="Tips.visibility" />');
    expect(visibilitySource).not.toContain('className="vis-help');
  });
});
