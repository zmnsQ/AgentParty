import type { CSSProperties } from "react";
import { StudioIcon } from "./StudioIcon";
import "./PlatformIcon.css";

/** A declared connector/runner key, never inferred from a nickname or ID. */
export type AgentPlatform = "chatgpt" | "openai" | "dot" | "codex" | "codex-sdk" | "claude" | "anthropic" | "muse" | "manus" | "cue" | "grok" | "hermes" | "codebuddy" | "other";
const KEYS = new Set<string>(["chatgpt", "openai", "dot", "codex", "codex-sdk", "claude", "anthropic", "muse", "manus", "cue", "grok", "hermes", "codebuddy", "other"]);
export function declaredAgentPlatform(value: unknown): AgentPlatform | null {
  return typeof value === "string" && KEYS.has(value) ? value as AgentPlatform : null;
}
const ASSETS: Partial<Record<AgentPlatform, string>> = {
  chatgpt: "openai", openai: "openai", dot: "openai", codex: "openai", "codex-sdk": "openai",
  claude: "anthropic", anthropic: "anthropic",
};
const LABELS: Record<AgentPlatform, string> = {
  chatgpt: "ChatGPT · OpenAI", openai: "OpenAI", dot: "ChatGPT / dot · OpenAI", codex: "Codex · OpenAI", "codex-sdk": "Codex SDK · OpenAI",
  claude: "Claude · Anthropic", anthropic: "Anthropic", muse: "Muse", manus: "Manus", cue: "Cue", grok: "Grok", hermes: "Hermes", codebuddy: "CodeBuddy", other: "Agent",
};
/** Brand indicates declared platform only, not identity verification or live connection. */
export function PlatformIcon({ platform, size = 20, decorative = false, className = "" }: {
  platform?: string | null; size?: number; decorative?: boolean; className?: string;
}) {
  const known = declaredAgentPlatform(platform);
  const asset = known ? ASSETS[known] : undefined;
  const label = known ? LABELS[known] : "Agent";
  return <span className={`platform-icon ${className}`} data-platform={known ?? "unknown"}
    role={decorative ? undefined : "img"} aria-label={decorative ? undefined : label}
    aria-hidden={decorative ? true : undefined} title={decorative ? undefined : label}
    style={{ "--platform-icon-size": `${size}px` } as CSSProperties}>
    {asset ? <span className="platform-icon-mask" style={{ maskImage: `url(/brand/platforms/${asset}.svg)`, WebkitMaskImage: `url(/brand/platforms/${asset}.svg)` }} />
      : <StudioIcon name="agent" size={size} />}
  </span>;
}
