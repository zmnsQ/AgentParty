import { describe, expect, it } from "vitest";
import type { TokenIdentity } from "../src/auth";
import { COLLABORATION_MCP_VERSION, handleChannelMcp } from "../src/collaboration/mcp";

const identity: TokenIdentity = { name: "reviewer", role: "agent", kind: "agent", hash: "hash", channel_scope: "dev" };
function request(message: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://commons.test/api/channels/dev/mcp", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(message),
  });
}
function call(name: string, args: Record<string, unknown> = {}) {
  return request({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
}
const unused = async (): Promise<Response> => { throw new Error("Forward must not run"); };
async function payload(response: Response): Promise<any> { return response.json(); }

describe("group-scoped remote MCP", () => {
  it("negotiates only the implemented tools transport and accepts initialization notifications", async () => {
    const response = await handleChannelMcp(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "test", version: "1" },
    } }), "dev", identity, unused);
    const data = await payload(response);
    expect(data.result.protocolVersion).toBe(COLLABORATION_MCP_VERSION);
    expect(data.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(data.result.capabilities.events).toBeUndefined();
    const notification = await handleChannelMcp(request({ jsonrpc: "2.0", method: "notifications/initialized" }), "dev", identity, unused);
    expect(notification.status).toBe(202);
  });

  it("rejects human credentials, broad agent credentials, and tokens for another group", async () => {
    for (const candidate of [
      { ...identity, kind: "human" as const, role: "human" as const },
      { ...identity, channel_scope: undefined },
      { ...identity, channel_scope: "private" },
      { ...identity, role: "readonly" as const },
    ]) expect((await handleChannelMcp(call("party_profile"), "dev", candidate, unused)).status).toBe(403);
    const data = await payload(await handleChannelMcp(call("party_profile"), "dev", identity, unused));
    expect(data.result.structuredContent).toMatchObject({ name: "reviewer", channel: "dev", event_delivery: {push_method:"events/stream",host_activation:"client-dependent"} });
    expect(JSON.stringify(data)).not.toContain('"hash"');
  });

  it("checks origins, content types, protocol headers and HTTP methods before dispatch", async () => {
    const rpc = { jsonrpc: "2.0", id: 1, method: "ping" };
    for (const [headers, status] of [
      [{ origin: "https://evil.test" }, 403],
      [{ "content-type": "application/jsonp" }, 415],
      [{ "mcp-protocol-version": "unknown" }, 400],
    ] as Array<[Record<string, string>, number]>) {
      expect((await handleChannelMcp(request(rpc, headers), "dev", identity, unused)).status).toBe(status);
    }
    expect((await handleChannelMcp(request(rpc, { origin: "https://commons.test" }), "dev", identity, unused)).status).toBe(200);
    const get = await handleChannelMcp(new Request("https://commons.test/api/channels/dev/mcp"), "dev", identity, unused);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("rejects oversized bodies and JSON-RPC batches without performing group operations", async () => {
    const oversized = request({ value: "x".repeat(1_500_001) });
    expect((await handleChannelMcp(oversized, "dev", identity, unused)).status).toBe(413);
    expect((await handleChannelMcp(request([{ jsonrpc: "2.0", id: 1, method: "ping" }]), "dev", identity, unused)).status).toBe(400);
  });

  it("reads only the authenticated group and passes explicit pagination", async () => {
    const paths: string[] = [];
    const data = await payload(await handleChannelMcp(call("party_read_messages", { after: 42, limit: 3 }), "dev", identity, async (path) => {
      paths.push(path); return Response.json({ messages: [], next_after: null });
    }));
    expect(paths).toEqual(["/api/channels/dev/messages?after=42&limit=3"]);
    expect(data.result.isError).toBe(false);
    const invalid = await payload(await handleChannelMcp(call("party_read_messages", { channel: "private" }), "dev", identity, unused));
    expect(invalid.result.isError).toBe(true);
  });

  it("preserves message retry keys and routes writes through the existing message API", async () => {
    let sent: any;
    const data = await payload(await handleChannelMcp(call("party_send_message", {
      body: "Review ready", idempotency_key: "review:17", reply_to: 12, mentions: ["developer"],
    }), "dev", identity, async (path, init) => {
      expect(path).toBe("/api/channels/dev/messages");
      expect(init?.method).toBe("POST");
      sent = JSON.parse(String(init?.body));
      return Response.json({ seq: 18 });
    }));
    expect(sent).toMatchObject({ kind: "message", body: "Review ready", idempotency_key: "review:17", reply_to: 12, mentions: ["developer"] });
    expect(sent.sender).toBeUndefined();
    expect(data.result.isError).toBe(false);
    for (const args of [{ body: "x" }, { body: "x", idempotency_key: "bad key" }, { body: "x", idempotency_key: "ok", identity: "owner" }]) {
      expect((await payload(await handleChannelMcp(call("party_send_message", args), "dev", identity, unused))).result.isError).toBe(true);
    }
  });

  it("never creates a file URL for another group or a path traversal", async () => {
    for (const key of [`private/${"a".repeat(64)}/secret.txt`, `dev/${"a".repeat(64)}/../secret`, `dev/${"a".repeat(64)}/..`]) {
      const result = await payload(await handleChannelMcp(call("party_get_file", { key }), "dev", identity, unused));
      expect(result.result.isError).toBe(true);
    }
    let path = "";
    await handleChannelMcp(call("party_get_file", { key: `dev/${"a".repeat(64)}/a b.txt` }), "dev", identity, async (value) => {
      path = value; return Response.json({ url: "https://commons.test/signed", expires_at: 1 });
    });
    expect(path).toBe(`/api/channels/dev/attachments/${"a".repeat(64)}/a%20b.txt?signed-url=1`);
  });

  it("decodes bounded file bytes and uses the original attachment uploader", async () => {
    let uploaded = "";
    const response = await handleChannelMcp(call("party_upload_file", { filename: "note.txt", content_type: "text/plain", data_base64: btoa("hello") }), "dev", identity, async (path, init) => {
      expect(path).toBe("/api/channels/dev/attachments?filename=note.txt");
      uploaded = await new Response(init?.body).text();
      return Response.json({ key: "dev/key/note.txt" });
    });
    expect((await payload(response)).result.isError).toBe(false);
    expect(uploaded).toBe("hello");
    for (const data_base64 of ["!!", btoa("x".repeat(1_048_577))]) {
      const result = await payload(await handleChannelMcp(call("party_upload_file", { filename: "x", content_type: "text/plain", data_base64 }), "dev", identity, unused));
      expect(result.result.isError).toBe(true);
    }
  });

  it("does not reflect upstream errors, credentials, or response bodies into tool failures", async () => {
    for (const forward of [async () => new Response("secret-provider-key", { status: 403 }), async () => { throw new Error("secret-provider-key"); }]) {
      const result = await payload(await handleChannelMcp(call("party_list_repositories"), "dev", identity, forward));
      expect(result.result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret-provider-key");
    }
  });

  it("lets agents propose code but never exposes an approval or publishing tool", async () => {
    const listed = await payload(await handleChannelMcp(request({ jsonrpc: "2.0", id: 1, method: "tools/list" }), "dev", identity, unused));
    expect(listed.result.tools.some((tool: { name: string }) => /publish|approve/.test(tool.name))).toBe(false);
    const args = { repository_id: "repo-1", request_id: "change-1", title: "Fix greeting", base_sha: "a".repeat(40), files: [{ path: "src/hello.ts", content: "export const hello = 'hi';\n" }] };
    let forwarded: any;
    const result = await payload(await handleChannelMcp(call("party_propose_changes", args), "dev", identity, async (path, init) => {
      expect(path).toBe("/api/channels/dev/repositories/repo-1/proposals");
      forwarded = JSON.parse(String(init?.body));
      return Response.json({ proposal: { state: "proposed" } });
    }));
    expect(result.result.isError).toBe(false);
    expect(forwarded.files).toEqual(args.files);
    expect(forwarded.request_id).toBe("change-1");
    expect((await payload(await handleChannelMcp(call("party_propose_changes", { ...args, credential: "never-accept-an-agent-write-key" }), "dev", identity, unused))).result.isError).toBe(true);
    const forbiddenFile = { ...args, files: [{ path: ".github/workflows/publish.yml", content: "unsafe" }] };
    expect((await payload(await handleChannelMcp(call("party_propose_changes", forbiddenFile), "dev", identity, unused))).result.isError).toBe(true);
  });

  it("lists repository paths only at an immutable commit", async () => {
    let path = "";
    const result = await payload(await handleChannelMcp(call("party_list_repository_files", { repository_id: "repo-1", ref: "b".repeat(40), path: "src" }), "dev", identity, async (value) => {
      path = value; return Response.json({ entries: [], truncated: false });
    }));
    expect(result.result.isError).toBe(false);
    expect(path).toBe(`/api/channels/dev/repositories/repo-1/files?path=src&ref=${"b".repeat(40)}`);
    const bad = await payload(await handleChannelMcp(call("party_read_repository_file", { repository_id: "repo-1", ref: "main", path: "README.md" }), "dev", identity, unused));
    expect(bad.result.isError).toBe(true);
  });
});
