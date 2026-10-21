// @ts-expect-error Bun executes this test, while the web tsconfig intentionally loads only Vite globals.
import { describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LocaleProvider } from "../i18n/locale";
import { DesktopDownloadLink } from "./DesktopDownloadLink";
import { DESKTOP_BUILD_GUIDE_URL } from "./DesktopInstall";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

describe("DesktopDownloadLink", () => {
  test("opens a truthful source-build guide without an upstream installer command", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <LocaleProvider>
          <DesktopDownloadLink desktop={false} />
        </LocaleProvider>,
      );
    });

    const button = renderer.root.findByType("button");
    expect(button.children.join("")).toBe("desktop");
    await act(async () => button.props.onClick());
    expect(renderer.root.findByProps({ role: "dialog" })).toBeTruthy();
    expect(renderer.root.findByProps({ href: DESKTOP_BUILD_GUIDE_URL }).props.target).toBe("_blank");
    expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("ALLOW_UNNOTARIZED");
    expect(JSON.stringify(renderer.toJSON())).toContain("have not been published");
    await act(async () => renderer.unmount());
  });

  test("is hidden inside the desktop runtime", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <LocaleProvider>
          <DesktopDownloadLink desktop />
        </LocaleProvider>,
      );
    });

    expect(renderer.toJSON()).toBeNull();
    await act(async () => renderer.unmount());
  });
});
