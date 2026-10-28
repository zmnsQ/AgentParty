// @ts-expect-error Bun test module not included in web tsconfig.
import { expect, test } from "bun:test";
// @ts-expect-error Bun provides Node fs; production web does not bundle this test.
import { readFileSync } from "node:fs";
import { declaredAgentPlatform, PlatformIcon } from "./PlatformIcon";

test("only explicit platform keys map, never nickname fragments", () => {
  expect(declaredAgentPlatform("chatgpt")).toBe("chatgpt");
  expect(declaredAgentPlatform("codex-sdk")).toBe("codex-sdk");
  expect(declaredAgentPlatform("manus")).toBe("manus");
  expect(PlatformIcon({ platform: "manus" }).props.children.props.name).toBe("agent");
  expect(declaredAgentPlatform("My ChatGPT agent")).toBe(null);
  expect(declaredAgentPlatform("ac-oauth-muse")).toBe(null);
  expect(declaredAgentPlatform(undefined)).toBe(null);
});
test("known OpenAI service uses local mark and unknown remains neutral", () => {
  const icon = PlatformIcon({ platform: "chatgpt" });
  expect(icon.props["aria-label"]).toBe("ChatGPT · OpenAI");
  expect(icon.props.children.props.style.maskImage).toBe("url(/brand/platforms/openai.svg)");
  const fallback = PlatformIcon({ platform: "made-up" });
  expect(fallback.props["data-platform"]).toBe("unknown");
  expect(fallback.props.children.props.name).toBe("agent");
});
test("vendored vector marks contain geometry only and no external resources", () => {
  for (const name of ["openai", "anthropic"]) {
    const svg = readFileSync(new URL(`../../public/brand/platforms/${name}.svg`, import.meta.url), "utf8");
    expect(svg).toContain('<path d="');
    expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+=|href=|<image|<animate|<style/i);
  }
});
