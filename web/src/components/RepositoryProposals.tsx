import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CodeProposal, CodeProposalDetail } from "@agentparty/shared/code-proposals";
import { codeProposalApi, type CodeProposalClient } from "../lib/codeProposalApi";
import { collaborationError } from "../lib/collaborationApi";
import { collaborationDate } from "./CloudAgentConnections";
import { useT } from "../i18n/useT";
import { useLocale } from "../i18n/locale";
import "../i18n/strings/CollaborationHub";

function ProposalReview({ token, slug, repositoryId, proposalId, canApprove, client, onUpdated, onBusy }: {
  token: string; slug: string; repositoryId: string; proposalId: string; canApprove: boolean; client: CodeProposalClient;
  onUpdated(proposal: CodeProposalDetail): void; onBusy(busy: boolean): void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<CodeProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<"publish" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const alive = useRef(true);
  const requestBusy = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setLoading(true); setDetail(null); setError(null); setCredential(""); setReviewed(false);
    void client.detail(token, slug, repositoryId, proposalId, controller.signal).then(({ proposal }) => {
      if (alive.current && !controller.signal.aborted) setDetail(proposal);
    }).catch((cause: unknown) => {
      if (alive.current && !controller.signal.aborted) setError(collaborationError(cause));
    }).finally(() => { if (alive.current && !controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [client, proposalId, repositoryId, slug, token]);

  const originalByPath = new Map(detail?.originals.map((file) => [file.path, file.content]));
  const completeReview = detail !== null && detail.files.length > 0 && detail.digest.length > 0 && detail.files.every((file) => originalByPath.has(file.path));
  const canDecide = detail !== null && ["proposed", "failed", "unknown"].includes(detail.state);
  const canReject = detail !== null && ["proposed", "failed"].includes(detail.state);
  const decide = async (action: "publish" | "reject") => {
    if (!detail || !canApprove || !completeReview || !canDecide || requestBusy.current || (action === "reject" && !canReject) || (action === "publish" && (!reviewed || !credential.trim()))) return;
    requestBusy.current = true; setBusy(action); onBusy(true); setError(null);
    // Keep the credential only in this request closure. Clear the password field
    // before the network call, including when the provider rejects or times out.
    const oneUseCredential = credential.trim();
    setCredential("");
    try {
      const response = action === "publish"
        ? await client.publish(token, slug, repositoryId, detail.id, oneUseCredential, detail.digest)
        : await client.reject(token, slug, repositoryId, detail.id, detail.digest);
      if (alive.current) { setDetail(response.proposal); setReviewed(false); setRejecting(false); onUpdated(response.proposal); }
    } catch (cause) { if (alive.current) setError(`${collaborationError(cause)} ${t("Collab.proposalRequestFailed")}`); }
    finally { requestBusy.current = false; onBusy(false); if (alive.current) setBusy(null); }
  };
  const publish = (event: FormEvent) => { event.preventDefault(); void decide("publish"); };

  return <section className="commons-review" aria-label={t("Collab.reviewTitle")}>
    {loading && <p role="status" className="commons-muted">{t("Collab.loading")}</p>}
    {error && <p className="commons-error" role="alert">{error}</p>}
    {detail && <>
      <div className="commons-section-head"><h3>{t("Collab.reviewTitle")}</h3><span className={`commons-badge commons-badge--${detail.state}`}>{t(`Collab.proposalState.${detail.state}`)}</span></div>
      <p className="commons-review-description">{detail.description || detail.title}</p>
      <dl className="commons-review-meta"><div><dt>{t("Collab.baseCommit")}</dt><dd><code>{detail.base_sha}</code></dd></div><div><dt>{t("Collab.reviewDigest")}</dt><dd><code>{detail.digest}</code></dd></div></dl>
      {!completeReview && <p className="commons-error" role="alert">{t("Collab.reviewIncomplete")}</p>}
      <div className="commons-changes">{detail.files.map((file) => {
        const original = originalByPath.get(file.path);
        const change = file.content === null ? "Collab.deletedFile" : original === null ? "Collab.addedFile" : "Collab.changedFile";
        return <details className="commons-change" key={file.path} open>
          <summary><span>{file.path}</span><span className="commons-badge">{t(change)}</span></summary>
          <div className="commons-diff">
            <div className="commons-diff-before"><h4>{t("Collab.before")}</h4><pre>{original === undefined ? t("Collab.originalMissing") : original === null ? t("Collab.fileAbsent") : original}</pre></div>
            <div className="commons-diff-after"><h4>{t("Collab.after")}</h4><pre>{file.content === null ? t("Collab.fileAbsent") : file.content}</pre></div>
          </div>
        </details>;
      })}</div>
      {detail.error && <p className="commons-error">{detail.error}</p>}
      {detail.state === "unknown" && <p className="commons-note">{t("Collab.proposalUnknown")}</p>}
      {detail.state === "publishing" && <p className="commons-note">{t("Collab.proposalPublishing")}</p>}
      {detail.pull_request_url && <p className="commons-success"><a href={detail.pull_request_url} target="_blank" rel="noreferrer">{t("Collab.openProposalPr", { number: detail.pull_request_number ?? "" })} ↗</a>{detail.branch && <span className="commons-branch"> · {detail.branch}</span>}</p>}
      {canApprove && canDecide && completeReview && <form className="commons-approval" onSubmit={publish}>
        <p className="commons-note">{t("Collab.publishBoundary")}</p>
        <label className="commons-check"><input type="checkbox" checked={reviewed} disabled={busy !== null} onChange={(event) => setReviewed(event.target.checked)} required />{t("Collab.reviewAck")}</label>
        <label className="commons-secret-label">{t("Collab.writeCredential")}<input type="password" autoComplete="new-password" spellCheck={false} value={credential} disabled={busy !== null} onChange={(event) => setCredential(event.target.value)} aria-describedby="commons-proposal-credential-help" /></label>
        <p className="commons-muted" id="commons-proposal-credential-help">{t("Collab.writeCredentialHint")}</p>
        <div className="commons-actions"><button className="d-btn commons-primary" disabled={busy !== null || !reviewed || !credential.trim()}>{t(busy === "publish" ? "Collab.busy" : detail.state === "proposed" ? "Collab.publishProposal" : "Collab.retryProposal")}</button>{canReject && <button className="d-btn" type="button" disabled={busy !== null} onClick={() => { setRejecting(true); setCredential(""); }}>{t("Collab.rejectProposal")}</button>}</div>
        {rejecting && <div className="commons-confirm"><p>{t("Collab.confirmReject")}</p><button className="d-btn" type="button" disabled={busy !== null} onClick={() => void decide("reject")}>{t(busy === "reject" ? "Collab.busy" : "Collab.confirm")}</button><button className="d-btn" type="button" disabled={busy !== null} onClick={() => setRejecting(false)}>{t("Collab.close")}</button></div>}
      </form>}
      {!canApprove && canDecide && <p className="commons-muted">{t("Collab.approvalOwnerOnly")}</p>}
    </>}
  </section>;
}

export function RepositoryProposals({ token, slug, repositoryId, canApprove, client = codeProposalApi, onPublished }: {
  token: string; slug: string; repositoryId: string; canApprove: boolean; client?: CodeProposalClient; onPublished?(): void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [proposals, setProposals] = useState<CodeProposal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const result = await client.list(token, slug, repositoryId, signal);
      if (alive.current && current === generation.current) setProposals(result.proposals);
    } catch (cause) { if (alive.current && !signal?.aborted && current === generation.current) setError(collaborationError(cause)); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [client, repositoryId, slug, token]);
  useEffect(() => {
    alive.current = true; const controller = new AbortController(); void refresh(controller.signal);
    return () => { alive.current = false; controller.abort(); };
  }, [refresh]);
  const update = (proposal: CodeProposalDetail) => {
    if (!alive.current) return;
    setProposals((previous) => previous.map((entry) => entry.id === proposal.id ? proposal : entry));
    if (proposal.state === "published") onPublished?.();
  };
  return <section className="commons-proposals">
    <div className="commons-section-head"><h3>{t("Collab.proposalsTitle")}</h3><button className="d-btn" type="button" disabled={loading || working} onClick={() => { setReviewVersion((version) => version + 1); void refresh(); }}>{t(loading ? "Collab.loading" : "Collab.refreshProposals")}</button></div>
    <p className="commons-muted">{t("Collab.proposalsHint")}</p>
    {error && <p className="commons-error" role="alert">{error}</p>}
    {!loading && !error && proposals.length === 0 && <p className="commons-muted">{t("Collab.proposalsEmpty")}</p>}
    <div className="commons-proposal-list">{proposals.map((proposal) => <button className={`commons-proposal-card ${selectedId === proposal.id ? "is-selected" : ""}`} key={proposal.id} type="button" disabled={working} aria-expanded={selectedId === proposal.id} onClick={() => setSelectedId((current) => current === proposal.id ? null : proposal.id)}>
      <span><strong>{proposal.title}</strong><small>{t("Collab.proposalBy", { name: proposal.created_by, count: proposal.file_count })} · {collaborationDate(proposal.created_at, locale)}</small><code>{proposal.base_branch} @ {proposal.base_sha.slice(0, 12)}</code></span><span className={`commons-badge commons-badge--${proposal.state}`}>{t(`Collab.proposalState.${proposal.state}`)}</span>
    </button>)}</div>
    {selectedId && <ProposalReview key={`${selectedId}:${reviewVersion}`} token={token} slug={slug} repositoryId={repositoryId} proposalId={selectedId} canApprove={canApprove} client={client} onUpdated={update} onBusy={(value) => { if (alive.current) setWorking(value); }} />}
  </section>;
}
