// @ts-expect-error Bun executes this test; the web tsconfig only loads Vite globals.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { ChannelFile, ChannelRepository, CloudAgentConnection, CloudAgentRun, CollaborationSummary } from "@agentparty/shared/collaboration";
import { LocaleProvider } from "../i18n/locale";
import { CollaborationStrings } from "../i18n/strings/CollaborationHub";
import { AuthError, ForbiddenError } from "../lib/api";
import { clearApiBase, setApiBase } from "../lib/base";
import { CollaborationApiError, type CollaborationClient } from "../lib/collaborationApi";
import { codeProposalApi } from "../lib/codeProposalApi";
import { CloudAgentConnections, CloudAgentRuns } from "./CloudAgentConnections";
import { RepositoryConnections } from "./RepositoryConnections";
import { ChannelFiles } from "./ChannelFiles";
import { CollaborationHub } from "./CollaborationHub";

const connection: CloudAgentConnection = {
  id: "cloud-1", channel: "demo", provider: "hermes", name: "Research helper", agent_name: "cloud-helper", supports_cancel: true, endpoint: "https://hermes.example",
  remote_agent_id: null, status: "verified", credential_configured: true, mode: "manual", personal_context_acknowledged: false,
  verified_at: 1_790_000_000_000, created_at: 1_790_000_000_000, updated_at: 1_790_000_000_000,
};
const run: CloudAgentRun = {
  id: "run-1", connection_id: connection.id, channel: "demo", request_id: "request-1", state: "running", prompt: "Review this plan",
  result: null, error: null, reply_message_seq: null, created_at: 1_790_000_000_000, updated_at: 1_790_000_000_000,
};
const repository: ChannelRepository = {
  id: "repo-1", channel: "demo", full_name: "example/project", html_url: "https://github.com/example/project", base_branch: "main",
  private: true, credential_configured: true, created_at: 1_790_000_000_000,
};
const file: ChannelFile = {
  key: "demo/hash/notes.txt", filename: "notes.txt", content_type: "text/plain", size: 18,
  url: "/api/channels/demo/attachments/hash/notes.txt", uploaded_at: "2026-10-01T12:00:00.000Z", uploaded_by: "member",
};
const summary: CollaborationSummary = {
  providers: [{ id: "chatgpt-dot", name: "ChatGPT dot", integration: "mcp-tools", implemented: true, supports_cancel: false, description: "MCP tools", docs_url: "https://developers.openai.com/plugins/build/mcp-server" }],
  connections: [connection], repositories: [repository], permissions: { manage: true, run: true, upload: true },
  mcp_endpoint: "/mcp/demo", execution: "manual-sync",
};
function client(overrides: Partial<CollaborationClient> = {}): CollaborationClient {
  return {
    summary: async () => summary,
    saveConnection: async () => ({ connection }), removeConnection: async () => ({ ok: true }),
    runs: async () => ({ runs: [] }), run: async () => ({ run }), syncRun: async () => ({ run }), cancelRun: async () => ({ run: { ...run, state: "cancelled" } }),
    files: async () => ({ files: [file], cursor: null }), shareFile: async () => ({ seq: 42 }),
    addRepository: async () => ({ repository }), removeRepository: async () => ({ ok: true }), pulls: async () => ({ repository, pulls: [] }),
    ...overrides,
  };
}
let renderer: ReactTestRenderer | null = null;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "en", setItem: () => {}, removeItem: () => {} } });
  setApiBase("https://commons.example");
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  clearApiBase();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
async function mount(node: ReactNode) {
  await act(async () => { renderer = create(<LocaleProvider>{node}</LocaleProvider>); });
  return renderer!.root;
}
function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}
function button(label: string) {
  return renderer!.root.find((node) => node.type === "button" && text(node) === label);
}
async function click(label: string) {
  await act(async () => { button(label).props.onClick(); });
}
async function sendPrompt(prompt: string) {
  await act(async () => { renderer!.root.findByType("textarea").props.onChange({ target: { value: prompt } }); });
  await act(async () => { renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
}

describe("cloud agent collaboration controls", () => {
  test("loads history without starting a task, and reuses the request ID after an ambiguous failure", async () => {
    const requests: Array<{ prompt: string; id: string }> = [];
    let historyReads = 0;
    await mount(<CloudAgentRuns token="token" slug="demo" connection={connection} canRun client={client({
      runs: async () => { historyReads++; return { runs: [] }; },
      run: async (_token, _slug, _id, prompt, id) => {
        requests.push({ prompt, id });
        if (requests.length === 1) throw new Error("Timed out");
        return { run: { ...run, prompt, request_id: id } };
      },
    })} />);
    expect(historyReads).toBe(1);
    expect(requests).toHaveLength(0);
    await sendPrompt("Review this plan");
    expect(text(renderer!.root)).toContain("Timed out");
    expect(renderer!.root.findByType("textarea").props.value).toBe("Review this plan");
    await sendPrompt("Review this plan");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.id).toBe(requests[1]?.id);
    expect(renderer!.root.findByType("textarea").props.value).toBe("");
    expect(button("Send task").props.disabled).toBe(true);
    expect(text(renderer!.root)).toContain("Running");
  });

  test("syncs an existing run and allows a failed group post to recover without another remote run", async () => {
    let syncs = 0;
    let starts = 0;
    await mount(<CloudAgentRuns token="token" slug="demo" connection={connection} canRun client={client({
      runs: async () => ({ runs: [{ ...run, state: "completed", result: "Useful answer" }] }),
      run: async () => { starts++; return { run }; },
      syncRun: async () => { syncs++; return { run: { ...run, state: "completed", result: "Useful answer", reply_message_seq: 81 } }; },
    })} />);
    expect(text(renderer!.root)).toContain("has not been posted to the group");
    await click("Retry posting result");
    expect(syncs).toBe(1); expect(starts).toBe(0);
    expect(text(renderer!.root)).toContain("message #81");
    expect(renderer!.root.findAll((node) => node.type === "button" && text(node) === "Request cancellation")).toHaveLength(0);
  });

  test("labels Manus as delivery only and never offers to fetch personal replies", async () => {
    await mount(<CloudAgentRuns token="token" slug="demo" connection={{ ...connection, provider: "manus" }} canRun client={client({ runs: async () => ({ runs: [{ ...run, state: "submitted" }] }) })} />);
    expect(text(renderer!.root)).toContain("Open Manus / Cue to confirm the result");
    expect(renderer!.root.findAll((node) => node.type === "button" && text(node) === "Sync status & result")).toHaveLength(0);
    expect(text(renderer!.root)).not.toContain("Posted to group as message");
  });

  test("requires a verified save, keeps existing credentials write-only, and marks connector setup unfinished", async () => {
    let saves = 0;
    const api = client({ saveConnection: async () => { saves++; throw new Error("Provider rejected credential"); } });
    await mount(<CloudAgentConnections token="token" slug="demo" summary={summary} client={api} onChanged={async () => {}} />);
    expect(text(renderer!.root)).toContain("OAuth onboarding and MCP Events are not implemented");
    await click("Edit");
    const password = renderer!.root.findByProps({ type: "password" });
    expect(password.props.value).toBe(""); expect(password.props.required).toBe(false);
    await act(async () => { password.props.onChange({ target: { value: "new-secret" } }); });
    const form = renderer!.root.find((node) => node.type === "form" && node.props["aria-label"] === "Connect an agent");
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
    expect(saves).toBe(1);
    expect(text(renderer!.root)).toContain("Provider rejected credential");
    expect(text(renderer!.root)).not.toContain("Connection verified and saved.");
    expect(text(renderer!.root)).not.toContain("new-secret");
    await click("Cancel");
    await click("Edit");
    expect(renderer!.root.findByProps({ type: "password" }).props.value).toBe("");
  });
});

describe("shared files and repository data", () => {
  test("uploads to storage before posting, then reloads the real file listing", async () => {
    const calls: string[] = [];
    const api = client({ files: async () => { calls.push("list"); return { files: [file], cursor: null }; }, shareFile: async (_token, _slug, attachment) => { calls.push(`post:${attachment.key}`); return { seq: 42 }; } });
    await mount(<ChannelFiles token="token" slug="demo" canUpload client={api} upload={async (_token, _slug, picked) => { calls.push(`upload:${picked.name}`); return file; }} />);
    await act(async () => { renderer!.root.findByProps({ type: "file" }).props.onChange({ currentTarget: { files: [new File(["notes"], "notes.txt")], value: "" } }); });
    expect(calls).toEqual(["list", "upload:notes.txt", `post:${file.key}`, "list"]);
    expect(text(renderer!.root)).toContain("Posted notes.txt as message #42");
  });

  test("shows failed file posts and reuses the post key on an explicit retry", async () => {
    const requests: string[] = [];
    await mount(<ChannelFiles token="token" slug="demo" canUpload client={client({ shareFile: async (_token, _slug, _file, requestId) => { requests.push(requestId); if (requests.length === 1) throw new Error("Send failed"); return { seq: 45 }; } })} />);
    await click("Post to group");
    expect(text(renderer!.root)).toContain("Send failed");
    expect(text(renderer!.root)).not.toContain("Posted notes.txt");
    await click("Post to group");
    expect(requests[0]).toBe(requests[1]);
    expect(text(renderer!.root)).toContain("message #45");
  });

  test("renders returned PR branches and handles GitHub failure without pretending the list is empty", async () => {
    let reads = 0;
    await mount(<RepositoryConnections token="token" slug="demo" summary={summary} onChanged={async () => {}} proposalClient={{ ...codeProposalApi, list: async () => ({ proposals: [] }) }} client={client({ pulls: async () => {
      reads++;
      if (reads === 2) throw new Error("GitHub rate limit");
      return { repository, pulls: [{ number: 7, title: "Fix the queue", html_url: "https://github.com/example/project/pull/7", state: "open", draft: true, author: "helper", head_branch: "agent/task-7", base_branch: "main", updated_at: "2026-10-01T12:00:00.000Z" }] };
    } })} />);
    expect(text(renderer!.root)).toContain("agent/task-7");
    expect(renderer!.root.findByProps({ href: "https://github.com/example/project/pull/7" }).props.target).toBe("_blank");
    await click("Refresh");
    expect(text(renderer!.root)).toContain("GitHub rate limit");
    expect(text(renderer!.root)).not.toContain("No open pull requests returned");
  });
});

describe("collaboration hub and access", () => {
  test("uses server permissions to hide mutation controls while keeping group data visible", async () => {
    await mount(<CollaborationHub token="token" slug="demo" client={client({ summary: async () => ({ ...summary, permissions: { manage: false, run: false, upload: false } }) })} />);
    expect(text(renderer!.root)).toContain("A human group owner manages");
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.type === "button" && text(node) === "Connect an agent")).toHaveLength(0);
    await act(async () => { renderer!.root.findByProps({ id: "commons-tab-files" }).props.onClick(); });
    expect(renderer!.root.findAllByProps({ type: "file" })).toHaveLength(0);
    expect(text(renderer!.root)).toContain("notes.txt");
    expect(text(renderer!.root)).not.toContain("Post to group");
  });

  test("makes an unsupported server visible and preserves original project attribution", async () => {
    await mount(<CollaborationHub token="token" slug="demo" client={client({ summary: async () => { throw new CollaborationApiError("missing route", 404, "not_found"); } })} />);
    expect(text(renderer!.root)).toContain("does not provide the Commons collaboration API");
    expect(text(renderer!.root)).toContain("independent derivative of AgentParty");
    expect(text(renderer!.root)).toContain("BUSL-1.1");
  });

  test("has equivalent English and Chinese strings and readable connector constraints in both locales", () => {
    expect(Object.keys(CollaborationStrings.en).sort()).toEqual(Object.keys(CollaborationStrings.zh).sort());
    for (const locale of ["en", "zh"]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => locale, setItem: () => {} } });
      const html = renderToStaticMarkup(<LocaleProvider><CloudAgentConnections token="token" slug="demo" summary={{ ...summary, connections: [] }} client={client()} onChanged={async () => {}} /></LocaleProvider>);
      expect(html).toContain("OAuth"); expect(html).toContain("MCP Events");
      expect(html).not.toContain("Collab.");
    }
  });
});


describe("collaboration session isolation", () => {
  test.each(["group", "account"])("clears old data and credentials before a different %s finishes loading", async (change: string) => {
    let complete!: (value: CollaborationSummary) => void;
    const next = new Promise<CollaborationSummary>((resolve) => { complete = resolve; });
    const service = client({ summary: async (token, slug) => token === "token" && slug === "demo" ? summary : next });
    await mount(<CollaborationHub token="token" slug="demo" client={service} />);
    expect(text(renderer!.root)).toContain("Research helper");
    await click("Edit");
    await act(async () => { renderer!.root.findByProps({ type: "password" }).props.onChange({ target: { value: "unsaved-private-key" } }); });
    await act(async () => { renderer!.update(<LocaleProvider><CollaborationHub token={change === "account" ? "other-token" : "token"}
      slug={change === "group" ? "other-group" : "demo"} client={service} /></LocaleProvider>); });
    expect(text(renderer!.root)).not.toContain("Research helper");
    expect(renderer!.root.findAllByProps({ type: "password" })).toHaveLength(0);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    await act(async () => { complete({ ...summary, connections: [], repositories: [], permissions: { manage: false, run: false, upload: false } }); });
    expect(text(renderer!.root)).not.toContain("Research helper");
    expect(text(renderer!.root)).not.toContain("unsaved-private-key");
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  });

  test("ignores an old summary even when it resolves after the replacement group", async () => {
    let complete!: (value: CollaborationSummary) => void;
    const pending = new Promise<CollaborationSummary>((resolve) => { complete = resolve; });
    const service = client({ summary: async (_token, slug) => slug === "demo" ? pending : { ...summary, connections: [], repositories: [] } });
    await mount(<CollaborationHub token="token" slug="demo" client={service} />);
    await act(async () => { renderer!.update(<LocaleProvider><CollaborationHub token="token" slug="other-group" client={service} /></LocaleProvider>); });
    await act(async () => { complete(summary); });
    expect(text(renderer!.root)).toContain("#other-group");
    expect(text(renderer!.root)).not.toContain("Research helper");
  });

  test("removes cached group content when a refresh reports revoked access", async () => {
    let calls = 0;
    await mount(<CollaborationHub token="token" slug="demo" client={client({ summary: async () => {
      if (++calls > 1) throw new CollaborationApiError("Group access revoked", 403, "forbidden");
      return summary;
    } })} />);
    expect(text(renderer!.root)).toContain("Research helper");
    await act(async () => { renderer!.root.findByProps({ "aria-label": "Refresh" }).props.onClick(); });
    expect(text(renderer!.root)).toContain("Group access revoked");
    expect(text(renderer!.root)).not.toContain("Research helper");
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  });

  test("does not automatically post an upload after its file panel is unmounted", async () => {
    let complete!: (value: ChannelFile) => void; let posts = 0;
    const pending = new Promise<ChannelFile>((resolve) => { complete = resolve; });
    await mount(<ChannelFiles token="token" slug="demo" canUpload client={client({ shareFile: async () => { posts++; return { seq: 1 }; } })}
      upload={async () => pending} />);
    await act(async () => { renderer!.root.findByProps({ type: "file" }).props.onChange({ currentTarget: { files: [new File(["private"], "notes.txt")], value: "" } }); });
    await act(async () => { renderer!.unmount(); }); renderer = null;
    await act(async () => { complete(file); });
    expect(posts).toBe(0);
  });
});


function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function rerender(node: ReactNode) {
  await act(async () => { renderer!.update(<LocaleProvider>{node}</LocaleProvider>); });
}

describe("private workspace scope isolation", () => {
  test.each(["group", "account", "server"])("clears data and secret form state immediately on a %s switch", async (change: string) => {
    const next = pending<CollaborationSummary>();
    let reads = 0;
    const scopedClient = client({ summary: async () => ++reads === 1 ? summary : next.promise });
    await mount(<CollaborationHub token="old-token" slug="demo" client={scopedClient} />);
    await click("Edit");
    await act(async () => {
      renderer!.root.findByProps({ type: "password" }).props.onChange({ target: { value: "OLD PRIVATE SECRET" } });
      renderer!.root.findByType("textarea").props.onChange({ target: { value: "OLD PRIVATE PROMPT" } });
    });
    if (change === "server") setApiBase("https://different-server.example");
    await rerender(<CollaborationHub token={change === "account" ? "new-token" : "old-token"} slug={change === "group" ? "new-group" : "demo"} client={scopedClient} />);
    expect(reads).toBe(2);
    expect(text(renderer!.root)).not.toContain("Research helper");
    expect(renderer!.root.findAllByProps({ type: "password" })).toHaveLength(0);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    await act(async () => { next.resolve({ ...summary, connections: [{ ...connection, name: "Current scope helper" }] }); });
    expect(text(renderer!.root)).toContain("Current scope helper");
    expect(renderer!.root.findByType("textarea").props.value).toBe("");
    await click("Edit");
    expect(renderer!.root.findByProps({ type: "password" }).props.value).toBe("");
  });

  test.each(["success", "unauthorized"])("ignores a late %s response from an abandoned group", async (result: string) => {
    const previous = pending<CollaborationSummary>();
    let authFailures = 0;
    const scopedClient = client({ summary: async (_token, slug) => slug === "old" ? previous.promise : { ...summary, connections: [{ ...connection, name: "New private helper" }] } });
    const failed = () => { authFailures++; };
    await mount(<CollaborationHub token="token" slug="old" client={scopedClient} onAuthFailed={failed} />);
    await rerender(<CollaborationHub token="token" slug="new" client={scopedClient} onAuthFailed={failed} />);
    await act(async () => { if (result === "success") previous.resolve(summary); else previous.reject(new AuthError("Old account expired")); });
    expect(text(renderer!.root)).toContain("New private helper");
    expect(text(renderer!.root)).not.toContain("Research helper");
    expect(text(renderer!.root)).not.toContain("Old account expired");
    expect(authFailures).toBe(0);
  });

  test.each([401, 403])("removes cached private data and controls after a %s refresh denial", async (status: number) => {
    let reads = 0; let authFailures = 0;
    const scopedClient = client({ summary: async () => {
      if (++reads > 1) throw status === 401 ? new AuthError("No longer authorized") : new ForbiddenError("No longer authorized");
      return summary;
    } });
    await mount(<CollaborationHub token="token" slug="demo" client={scopedClient} onAuthFailed={() => { authFailures++; }} />);
    expect(text(renderer!.root)).toContain("Research helper");
    await act(async () => { renderer!.root.findByProps({ "aria-label": "Refresh" }).props.onClick(); });
    expect(text(renderer!.root)).toContain("No longer authorized");
    expect(text(renderer!.root)).not.toContain("Research helper");
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    expect(authFailures).toBe(status === 401 ? 1 : 0);
  });
});

describe("file upload follow-up scope", () => {
  test.each(["unmount", "server", "permission"])("does not post or upload the next file after %s changes while an upload is pending", async (change: string) => {
    const uploaded = pending<ChannelFile>();
    let uploads = 0; let posts = 0; let lists = 0;
    const scopedClient = client({ files: async () => { lists++; return { files: [file], cursor: null }; }, shareFile: async () => { posts++; return { seq: 99 }; } });
    const upload = async () => { uploads++; return uploaded.promise; };
    await mount(<ChannelFiles token="old-token" slug="demo" canUpload client={scopedClient} upload={upload} />);
    await act(async () => {
      renderer!.root.findByProps({ type: "file" }).props.onChange({ currentTarget: { files: [new File(["one"], "one.txt"), new File(["two"], "two.txt")], value: "" } });
    });
    expect(uploads).toBe(1);
    if (change === "unmount") await act(async () => { renderer!.unmount(); renderer = null; });
    else if (change === "server") setApiBase("https://another-server.example");
    else await rerender(<ChannelFiles token="old-token" slug="demo" canUpload={false} client={scopedClient} upload={upload} />);
    await act(async () => { uploaded.resolve(file); });
    expect(uploads).toBe(1);
    expect(posts).toBe(0);
    expect(lists).toBe(change === "permission" ? 2 : 1);
  });

  test("clears a standalone file list immediately when the group changes", async () => {
    const next = pending<{ files: ChannelFile[]; cursor: null }>();
    const scopedClient = client({ files: async (_token, slug) => slug === "demo" ? { files: [file], cursor: null } : next.promise });
    await mount(<ChannelFiles token="token" slug="demo" canUpload client={scopedClient} />);
    expect(text(renderer!.root)).toContain("notes.txt");
    await rerender(<ChannelFiles token="token" slug="other" canUpload client={scopedClient} />);
    expect(text(renderer!.root)).not.toContain("notes.txt");
    await act(async () => { next.resolve({ files: [], cursor: null }); });
    expect(text(renderer!.root)).not.toContain("notes.txt");
  });
});
