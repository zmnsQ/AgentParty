// @ts-expect-error Bun executes this test; the web tsconfig only loads Vite globals.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopInstallPrompt } from "./DesktopInstall";

describe("Commons desktop preview", () => {
  test("does not proactively advertise an installer in either runtime", () => {
    expect(renderToStaticMarkup(<DesktopInstallPrompt desktop={false} />)).toBe("");
    expect(renderToStaticMarkup(<DesktopInstallPrompt desktop />)).toBe("");
  });
});
