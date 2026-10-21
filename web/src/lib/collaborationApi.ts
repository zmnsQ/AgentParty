import type { Attachment } from "@agentparty/shared";
import type {
  ChannelFilesResponse, ChannelRepository, ChannelRepositoryInput,
  CloudAgentConnection, CloudAgentConnectionInput, CloudAgentRun,
  CloudAgentRunResponse, CollaborationSummary, RepositoryPullRequest,
} from "@agentparty/shared/collaboration";
import { AuthError, ForbiddenError } from "./api";
import { apiUrl } from "./base";

export class CollaborationApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
}

/** No credential is read from or written to browser storage. */
async function request<T>(token: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ?? AbortSignal.timeout(45_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const message = typeof error?.message === "string" ? error.message : `Request failed (${response.status})`;
    const code = typeof error?.code === "string" ? error.code : null;
    if (response.status === 401) throw new AuthError(message);
    if (response.status === 403) throw new ForbiddenError(message, code, message);
    throw new CollaborationApiError(message, response.status, code);
  }
  return payload as T;
}

export { request as collaborationRequest };

const channelPath = (slug: string) => `/api/channels/${encodeURIComponent(slug)}`;
const agentPath = (slug: string, id: string) => `${channelPath(slug)}/cloud-agents/${encodeURIComponent(id)}`;

export const collaborationApi = {
  summary: (token: string, slug: string, signal?: AbortSignal) =>
    request<CollaborationSummary>(token, `${channelPath(slug)}/collaboration`, "GET", undefined, signal),
  saveConnection: (token: string, slug: string, id: string, input: CloudAgentConnectionInput) =>
    request<{ connection: CloudAgentConnection }>(token, agentPath(slug, id), "PUT", input),
  removeConnection: (token: string, slug: string, id: string) =>
    request<{ ok: boolean }>(token, agentPath(slug, id), "DELETE"),
  runs: (token: string, slug: string, id: string, signal?: AbortSignal) =>
    request<{ runs: CloudAgentRun[] }>(token, `${agentPath(slug, id)}/runs`, "GET", undefined, signal),
  run: (token: string, slug: string, id: string, prompt: string, requestId: string) =>
    request<CloudAgentRunResponse>(token, `${agentPath(slug, id)}/runs`, "POST", { prompt, request_id: requestId }),
  syncRun: (token: string, slug: string, id: string, runId: string) =>
    request<CloudAgentRunResponse>(token, `${agentPath(slug, id)}/runs/${encodeURIComponent(runId)}/sync`, "POST", {}),
  cancelRun: (token: string, slug: string, id: string, runId: string) =>
    request<CloudAgentRunResponse>(token, `${agentPath(slug, id)}/runs/${encodeURIComponent(runId)}/cancel`, "POST", {}),
  files: (token: string, slug: string, cursor?: string | null, signal?: AbortSignal) =>
    request<ChannelFilesResponse>(token, `${channelPath(slug)}/files${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, signal),
  shareFile: (token: string, slug: string, attachment: Attachment, requestId: string) =>
    request<{ seq: number }>(token, `${channelPath(slug)}/messages`, "POST", {
      type: "send", kind: "message", body: attachment.filename,
      mentions: [], body_mentions: [], reply_to: null,
      attachments: [attachment], idempotency_key: requestId,
    }),
  addRepository: (token: string, slug: string, input: ChannelRepositoryInput) =>
    request<{ repository: ChannelRepository }>(token, `${channelPath(slug)}/repositories`, "POST", input),
  removeRepository: (token: string, slug: string, id: string) =>
    request<{ ok: boolean }>(token, `${channelPath(slug)}/repositories/${encodeURIComponent(id)}`, "DELETE"),
  pulls: (token: string, slug: string, id: string, signal?: AbortSignal) =>
    request<{ repository: ChannelRepository; pulls: RepositoryPullRequest[] }>(token, `${channelPath(slug)}/repositories/${encodeURIComponent(id)}/pulls`, "GET", undefined, signal),
};

export type CollaborationClient = typeof collaborationApi;

export function collaborationError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function isActiveCloudRun(run: CloudAgentRun): boolean {
  return ["starting", "running", "needs_input", "unknown"].includes(run.state);
}
