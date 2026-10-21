import type { CodeProposalList, CodeProposalResponse } from "@agentparty/shared/code-proposals";
import { collaborationRequest } from "./collaborationApi";

const path = (slug: string, repositoryId: string) => `/api/channels/${encodeURIComponent(slug)}/repositories/${encodeURIComponent(repositoryId)}/proposals`;

export const codeProposalApi = {
  list: (token: string, slug: string, repositoryId: string, signal?: AbortSignal) =>
    collaborationRequest<CodeProposalList>(token, path(slug, repositoryId), "GET", undefined, signal),
  detail: (token: string, slug: string, repositoryId: string, proposalId: string, signal?: AbortSignal) =>
    collaborationRequest<CodeProposalResponse>(token, `${path(slug, repositoryId)}/${encodeURIComponent(proposalId)}`, "GET", undefined, signal),
  publish: (token: string, slug: string, repositoryId: string, proposalId: string, credential: string, expectedDigest: string) =>
    collaborationRequest<CodeProposalResponse>(token, `${path(slug, repositoryId)}/${encodeURIComponent(proposalId)}/publish`, "POST", { credential, expected_digest: expectedDigest }),
  reject: (token: string, slug: string, repositoryId: string, proposalId: string, expectedDigest: string) =>
    collaborationRequest<CodeProposalResponse>(token, `${path(slug, repositoryId)}/${encodeURIComponent(proposalId)}/reject`, "POST", { expected_digest: expectedDigest }),
};

export type CodeProposalClient = typeof codeProposalApi;
