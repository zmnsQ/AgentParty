/** Agent-authored changes are immutable proposals until a human owner approves them. */
export interface CodeChangeFile { path: string; content: string | null; }
export type CodeProposalState = "proposed" | "publishing" | "published" | "rejected" | "failed" | "unknown";
export interface CodeProposal {
  id: string;
  repository_id: string;
  channel: string;
  title: string;
  description: string;
  base_sha: string;
  base_branch: string;
  digest: string;
  state: CodeProposalState;
  created_by: string;
  approved_by: string | null;
  file_count: number;
  branch: string | null;
  commit_sha: string | null;
  pull_request_url: string | null;
  pull_request_number: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}
export interface CodeProposalDetail extends CodeProposal {
  files: CodeChangeFile[];
  /** Original text at the immutable base commit, captured before approval. */
  originals: CodeChangeFile[];
}
export interface CodeProposalInput {
  request_id: string;
  title: string;
  description?: string;
  base_sha: string;
  files: CodeChangeFile[];
}
export interface RepositorySnapshot { commit_sha: string; tree_sha: string; }
export interface RepositoryFile {
  path: string;
  content: string;
  encoding: "utf-8";
  blob_sha: string;
  commit_sha: string;
}
export interface RepositoryDirectory {
  commit_sha: string;
  path: string;
  entries: Array<{ name: string; path: string; type: "file" | "directory" | "symlink" | "submodule"; sha: string; mode: string }>;
  truncated: boolean;
}
export interface CodeProposalList { proposals: CodeProposal[]; }
export interface CodeProposalResponse { proposal: CodeProposalDetail; reused?: boolean; }
