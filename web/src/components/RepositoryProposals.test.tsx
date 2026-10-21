// @ts-expect-error Bun executes this test; the web tsconfig only loads Vite globals.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import type { CodeProposalDetail } from "@agentparty/shared/code-proposals";
import { LocaleProvider } from "../i18n/locale";
import type { CodeProposalClient } from "../lib/codeProposalApi";
import { RepositoryProposals } from "./RepositoryProposals";

const proposal: CodeProposalDetail = {
  id: "proposal-1", repository_id: "repo-1", channel: "demo", title: "Improve shared uploads", description: "Validate before uploading.",
  base_sha: "a".repeat(40), base_branch: "main", digest: "b".repeat(64), state: "proposed", created_by: "agent-hermes", approved_by: null,
  file_count: 2, branch: null, commit_sha: null, pull_request_url: null, pull_request_number: null, error: null,
  created_at: 1_790_000_000_000, updated_at: 1_790_000_000_000,
  files: [{ path: "src/upload.ts", content: "export const max = 10;\n" }, { path: "notes.md", content: null }],
  originals: [{ path: "src/upload.ts", content: "export const max = 5;\n" }, { path: "notes.md", content: "Remove this note.\n" }],
};
const published: CodeProposalDetail = { ...proposal, state: "published", approved_by: "owner", branch: "agentparty/proposal-1", commit_sha: "c".repeat(40), pull_request_url: "https://github.com/example/project/pull/9", pull_request_number: 9 };
function client(overrides: Partial<CodeProposalClient> = {}): CodeProposalClient {
  return { list: async () => ({ proposals: [proposal] }), detail: async () => ({ proposal }), publish: async () => ({ proposal: published }), reject: async () => ({ proposal: { ...proposal, state: "rejected" } }), ...overrides };
}
let renderer: ReactTestRenderer | null = null;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "en", setItem: () => {}, removeItem: () => {} } });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}
function button(label: string) { return renderer!.root.find((node) => node.type === "button" && text(node) === label); }
async function mount(api: CodeProposalClient, canApprove = true) {
  await act(async () => { renderer = create(<LocaleProvider><RepositoryProposals token="token" slug="demo" repositoryId="repo-1" canApprove={canApprove} client={api} /></LocaleProvider>); });
}
async function openReview() {
  await act(async () => { renderer!.root.find((node) => node.type === "button" && node.props.className.includes("commons-proposal-card")).props.onClick(); });
}
async function acknowledgeAndCredential(secret = "one-use-secret") {
  await act(async () => {
    renderer!.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } });
    renderer!.root.findByProps({ type: "password" }).props.onChange({ target: { value: secret } });
  });
}
async function submit() { await act(async () => { renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); }

describe("human approval of agent code proposals", () => {
  test("loads full originals only when expanded and cannot publish before review and credentials", async () => {
    let detailReads = 0; let publishes = 0;
    await mount(client({ detail: async () => { detailReads++; return { proposal }; }, publish: async () => { publishes++; return { proposal: published }; } }));
    expect(detailReads).toBe(0);
    expect(renderer!.root.findAllByProps({ type: "password" })).toHaveLength(0);
    await openReview();
    expect(detailReads).toBe(1);
    expect(text(renderer!.root)).toContain("export const max = 5;");
    expect(text(renderer!.root)).toContain("export const max = 10;");
    expect(text(renderer!.root)).toContain("Remove this note.");
    expect(text(renderer!.root)).toContain("File does not exist in this version.");
    expect(button("Approve & create draft PR").props.disabled).toBe(true);
    await submit();
    expect(publishes).toBe(0);
  });

  test("clears the one-use credential before a publish resolves and sends the loaded digest", async () => {
    let resolvePublish: ((value: { proposal: CodeProposalDetail }) => void) | null = null;
    const calls: string[][] = [];
    await mount(client({ publish: async (_token, _slug, _repo, id, credential, digest) => {
      calls.push([id, credential, digest]);
      return await new Promise<{ proposal: CodeProposalDetail }>((resolve) => { resolvePublish = resolve; });
    } }));
    await openReview(); await acknowledgeAndCredential(); await submit();
    expect(calls).toEqual([[proposal.id, "one-use-secret", proposal.digest]]);
    expect(renderer!.root.findByProps({ type: "password" }).props.value).toBe("");
    expect(text(renderer!.root)).not.toContain("one-use-secret");
    expect(button("Refresh proposals").props.disabled).toBe(true);
    await act(async () => { resolvePublish!({ proposal: published }); });
    expect(renderer!.root.findByProps({ href: published.pull_request_url }).props.target).toBe("_blank");
    expect(text(renderer!.root)).toContain("Open draft PR #9");
    expect(renderer!.root.findAllByProps({ type: "password" })).toHaveLength(0);
  });

  test("requires the same proposal on an uncertain retry and does not offer rejection", async () => {
    const uncertain = { ...proposal, state: "unknown" as const, error: "Network outcome uncertain" };
    const calls: string[] = [];
    await mount(client({ detail: async () => ({ proposal: uncertain }), publish: async (_token, _slug, _repo, id) => { calls.push(id); return { proposal: published }; } }));
    await openReview();
    expect(text(renderer!.root)).toContain("cannot be rejected until its remote state is known");
    expect(renderer!.root.findAll((node) => node.type === "button" && text(node) === "Reject proposal")).toHaveLength(0);
    await acknowledgeAndCredential(); await submit();
    expect(calls).toEqual([proposal.id]);
    expect(text(renderer!.root)).toContain("Open draft PR #9");
  });

  test("shows permission restrictions and blocks decisions when original content is missing", async () => {
    await mount(client(), false); await openReview();
    expect(text(renderer!.root)).toContain("Only a human group owner");
    expect(renderer!.root.findAllByType("form")).toHaveLength(0);
    await act(async () => { renderer!.unmount(); }); renderer = null;
    await mount(client({ detail: async () => ({ proposal: { ...proposal, originals: [] } }) })); await openReview();
    expect(text(renderer!.root)).toContain("complete original files or proposal digest could not be loaded");
    expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  });

  test("rejects only after an explicit confirmation and never sends a write credential", async () => {
    const calls: string[] = [];
    await mount(client({ reject: async (_token, _slug, _repo, id, digest) => { calls.push(`${id}:${digest}`); return { proposal: { ...proposal, state: "rejected" } }; } }));
    await openReview();
    await act(async () => { button("Reject proposal").props.onClick(); });
    expect(calls).toHaveLength(0);
    await act(async () => { button("Confirm").props.onClick(); });
    expect(calls).toEqual([`${proposal.id}:${proposal.digest}`]);
    expect(text(renderer!.root)).toContain("Rejected");
    expect(renderer!.root.findAllByType("form")).toHaveLength(0);
  });

  test("shows failed publication without a success link and clears credentials on network failure", async () => {
    await mount(client({ publish: async () => { throw new Error("Connection lost"); } }));
    await openReview(); await acknowledgeAndCredential(); await submit();
    expect(text(renderer!.root)).toContain("Connection lost");
    expect(text(renderer!.root)).toContain("server may still be processing");
    expect(renderer!.root.findByProps({ type: "password" }).props.value).toBe("");
    expect(renderer!.root.findAllByType("a")).toHaveLength(0);
    expect(button("Approve & create draft PR").props.disabled).toBe(true);
  });
});
