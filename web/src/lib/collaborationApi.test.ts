// @ts-expect-error Bun executes this test; the web tsconfig only loads Vite globals.
import { afterEach, describe, expect, test } from "bun:test";
import { collaborationApi, CollaborationApiError } from "./collaborationApi";
import { codeProposalApi } from "./codeProposalApi";
import { AuthError, ForbiddenError } from "./api";
import { clearApiBase, setApiBase } from "./base";

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
  else Reflect.deleteProperty(globalThis, "fetch");
  clearApiBase();
});
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  setApiBase("https://commons.example");
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string, init: RequestInit) => handler(url, init) });
}

describe("collaboration request boundaries", () => {
  test("sends credentials only in authenticated request bodies and preserves run idempotency", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    mockFetch((url, init) => { calls.push({ url, init }); return Response.json({}); });
    await collaborationApi.saveConnection("session-token", "demo", "cloud-a", { provider: "hermes", name: "Research", endpoint: "https://hermes.example", credential: "provider-secret" });
    await collaborationApi.run("session-token", "demo", "cloud-a", "Review the plan", "request-123");
    expect(calls[0]?.url).toBe("https://commons.example/api/channels/demo/cloud-agents/cloud-a");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer session-token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ credential: "provider-secret" });
    expect(calls.every((call) => !call.url.includes("secret") && !call.url.includes("token"))).toBe(true);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ prompt: "Review the plan", request_id: "request-123" });
  });

  test("posts an existing file as a channel attachment with a retry key", async () => {
    let captured: RequestInit | undefined;
    mockFetch((_url, init) => { captured = init; return Response.json({ seq: 42 }); });
    const file = { key: "demo/hash/notes.txt", filename: "notes.txt", content_type: "text/plain", size: 18, url: "/api/channels/demo/attachments/hash/notes.txt" };
    expect(await collaborationApi.shareFile("token", "demo", file, "post-key")).toEqual({ seq: 42 });
    expect(JSON.parse(String(captured?.body))).toEqual({ type: "send", kind: "message", body: "notes.txt", mentions: [], body_mentions: [], reply_to: null, attachments: [file], idempotency_key: "post-key" });
  });

  test("reports rejected and unsupported requests instead of returning success objects", async () => {
    for (const [status, expected] of [[401, AuthError], [403, ForbiddenError], [404, CollaborationApiError], [502, CollaborationApiError]] as const) {
      mockFetch(() => Response.json({ error: { code: "unavailable", message: "Provider unavailable" } }, { status }));
      await expect(collaborationApi.summary("token", "demo")).rejects.toBeInstanceOf(expected);
    }
    mockFetch(() => new Response("proxy error", { status: 503 }));
    await expect(collaborationApi.summary("token", "demo")).rejects.toThrow("Request failed (503)");
  });

  test("passes cancellation and cursor encoding through read requests", async () => {
    let seenUrl = ""; let seenSignal: AbortSignal | null | undefined;
    mockFetch((url, init) => { seenUrl = url; seenSignal = init.signal; return Response.json({ files: [], cursor: null }); });
    const controller = new AbortController();
    await collaborationApi.files("token", "demo", "next+/=", controller.signal);
    expect(seenUrl).toEndWith("/files?cursor=next%2B%2F%3D");
    expect(seenSignal).toBe(controller.signal);
  });

  test("publishes only the reviewed proposal digest with its one-use write credential", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    mockFetch((url, init) => { calls.push({ url, init }); return Response.json({ proposal: {} }); });
    await codeProposalApi.publish("token", "demo", "repo-1", "proposal-1", "one-use-secret", "reviewed-digest");
    await codeProposalApi.reject("token", "demo", "repo-1", "proposal-1", "reviewed-digest");
    expect(calls[0]?.url).toBe("https://commons.example/api/channels/demo/repositories/repo-1/proposals/proposal-1/publish");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ credential: "one-use-secret", expected_digest: "reviewed-digest" });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ expected_digest: "reviewed-digest" });
  });
});
