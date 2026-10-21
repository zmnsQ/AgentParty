import type { Attachment } from "./protocol";

/** Capability research is distinct from a verified account connection. */
export type PersonalAgentProvider = "hermes" | "manus" | "chatgpt-dot" | "muse" | "grok-bot";
export type DirectAgentProvider = "hermes" | "manus";
export interface PersonalAgentProviderInfo {
  id: PersonalAgentProvider;
  name: string;
  integration: "direct-api" | "mcp-tools";
  implemented: boolean;
  supports_cancel: boolean;
  description: string;
  docs_url: string;
}

export const PERSONAL_AGENT_PROVIDERS: readonly PersonalAgentProviderInfo[] = [
  { id: "hermes", name: "Hermes Agent", integration: "direct-api", implemented: true, supports_cancel: true,
    description: "Connect your Hermes API server. Each group gets a separate API session; existing CLI or desktop conversations are not imported.",
    docs_url: "https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server" },
  { id: "manus", name: "Manus / Cue", integration: "direct-api", implemented: true, supports_cancel: false,
    description: "Deliver to an existing personal agent using a Manus API key. Replies stay in Manus/Cue because the API cannot reliably correlate them to this group request; private history is never imported.",
    docs_url: "https://open.manus.ai/docs/v2/agents-overview" },
  { id: "chatgpt-dot", name: "ChatGPT dot", integration: "mcp-tools", implemented: false, supports_cancel: false,
    description: "The group MCP tools are available for bearer-capable clients. Dot account integration still requires OAuth and provider validation; automatic wake-up and MCP Events are not implemented.",
    docs_url: "https://developers.openai.com/plugins/build/mcp-events" },
  { id: "muse", name: "Meta Muse", integration: "mcp-tools", implemented: false, supports_cancel: false,
    description: "The group tools provide a connector foundation. Muse account integration and approval remain to be validated; this is not a direct personal-chat API.",
    docs_url: "https://platform.muse.ai/docs" },
  { id: "grok-bot", name: "Grok Bot", integration: "mcp-tools", implemented: false, supports_cancel: false,
    description: "The authenticated HTTPS MCP tools provide a bot-connector foundation. Actual bot account setup remains unverified; automatic wake-up is not included.",
    docs_url: "https://docs.x.ai/grok-bot/team-bots" },
];

export type CloudAgentRunState = "starting" | "running" | "needs_input" | "submitted" | "completed" | "failed" | "cancelled" | "unknown";
export interface CloudAgentConnection {
  id: string;
  channel: string;
  provider: DirectAgentProvider;
  name: string;
  agent_name: string;
  endpoint: string;
  remote_agent_id: string | null;
  status: "verified";
  credential_configured: boolean;
  mode: "manual";
  supports_cancel: boolean;
  personal_context_acknowledged: boolean;
  verified_at: number;
  created_at: number;
  updated_at: number;
}
export interface CloudAgentConnectionInput {
  provider: DirectAgentProvider;
  name: string;
  endpoint?: string;
  remote_agent_id?: string;
  /** Write-only. Omit on update to retain the existing credential. */
  credential?: string;
  /** Required for a provider whose existing personal conversation is reused. */
  allow_personal_context?: boolean;
}
export interface CloudAgentRun {
  id: string;
  connection_id: string;
  channel: string;
  request_id: string;
  state: CloudAgentRunState;
  prompt: string;
  result: string | null;
  error: string | null;
  reply_message_seq: number | null;
  created_at: number;
  updated_at: number;
}
export interface CloudAgentRunResponse { run: CloudAgentRun; reused?: boolean; }

export interface ChannelRepository {
  id: string;
  channel: string;
  full_name: string;
  html_url: string;
  base_branch: string;
  private: boolean;
  credential_configured: boolean;
  created_at: number;
}
export interface ChannelRepositoryInput {
  full_name: string;
  base_branch?: string;
  /** Optional read-only GitHub credential. Write-only; never shared with agents. */
  credential?: string;
}
export interface RepositoryPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  author: string;
  head_branch: string;
  base_branch: string;
  updated_at: string;
}
export interface RepositoryCommit {
  sha: string;
  html_url: string;
  message: string;
  author: string;
  date: string | null;
}
export interface ChannelFile extends Attachment {
  uploaded_by?: string;
  uploaded_at: string;
}
export interface ChannelFilesResponse { files: ChannelFile[]; cursor: string | null; }
export interface CollaborationSummary {
  providers: readonly PersonalAgentProviderInfo[];
  connections: CloudAgentConnection[];
  repositories: ChannelRepository[];
  permissions: { manage: boolean; run: boolean; upload: boolean };
  mcp_endpoint: string;
  execution: "manual-sync";
}
