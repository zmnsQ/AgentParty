import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ChannelRepository, CollaborationSummary, RepositoryPullRequest } from "@agentparty/shared/collaboration";
import { collaborationError, type CollaborationClient } from "../lib/collaborationApi";
import type { CodeProposalClient } from "../lib/codeProposalApi";
import { RepositoryProposals } from "./RepositoryProposals";
import { useT } from "../i18n/useT";
import { useLocale } from "../i18n/locale";
import { collaborationDate } from "./CloudAgentConnections";
import "../i18n/strings/CollaborationHub";

function RepositoryPulls({ token, slug, repository, client }: { token: string; slug: string; repository: ChannelRepository; client: CollaborationClient }) {
  const t = useT();
  const { locale } = useLocale();
  const [pulls, setPulls] = useState<RepositoryPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const result = await client.pulls(token, slug, repository.id, signal);
      if (alive.current && current === generation.current) setPulls(result.pulls);
    } catch (cause) {
      if (alive.current && !signal?.aborted && current === generation.current) setError(collaborationError(cause));
    } finally { if (alive.current && current === generation.current) setLoading(false); }
  }, [client, repository.id, slug, token]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); void refresh(controller.signal);
    return () => { alive.current = false; controller.abort(); };
  }, [refresh]);
  return <section className="commons-pulls">
    <div className="commons-section-head"><h3>{t("Collab.pullTitle")}</h3><button className="d-btn" type="button" disabled={loading} onClick={() => void refresh()}>{t(loading ? "Collab.loading" : "Collab.refresh")}</button></div>
    {error && <p className="commons-error" role="alert">{error}</p>}
    {!loading && !error && pulls.length === 0 && <p className="commons-muted">{t("Collab.pullEmpty")}</p>}
    <div className="commons-pull-list">{pulls.map((pull) => <article className="commons-pull" key={pull.number}>
      <span className="commons-pull-number">#{pull.number}</span>
      <div><a href={pull.html_url} target="_blank" rel="noreferrer"><strong>{pull.title}</strong> ↗</a><p><span className="commons-branch">{pull.head_branch}</span><span aria-hidden="true"> → </span><span className="commons-branch">{pull.base_branch}</span></p><small>{t("Collab.by", { name: pull.author })} · {collaborationDate(pull.updated_at, locale)}</small></div>
      {pull.draft && <span className="commons-badge">{t("Collab.draft")}</span>}
    </article>)}</div>
  </section>;
}

export function RepositoryConnections({ token, slug, summary, client, proposalClient, onChanged }: {
  token: string; slug: string; summary: CollaborationSummary; client: CollaborationClient; proposalClient?: CodeProposalClient; onChanged(): Promise<void>;
}) {
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [credential, setCredential] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(summary.repositories[0]?.id ?? null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullsRevision, setPullsRevision] = useState(0);
  const requestBusy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selected = summary.repositories.find((repository) => repository.id === selectedId) ?? summary.repositories[0] ?? null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (requestBusy.current) return;
    requestBusy.current = true; setBusy(true); setError(null);
    try {
      const { repository } = await client.addRepository(token, slug, { full_name: name.trim(), ...(branch.trim() ? { base_branch: branch.trim() } : {}), ...(credential.trim() ? { credential: credential.trim() } : {}) });
      if (!alive.current) return;
      setCredential(""); setName(""); setBranch(""); setShowForm(false); setSelectedId(repository.id);
      await onChanged();
    } catch (cause) { if (alive.current) setError(collaborationError(cause)); }
    finally { requestBusy.current = false; if (alive.current) setBusy(false); }
  };
  const remove = async (id: string) => {
    if (requestBusy.current) return;
    requestBusy.current = true; setBusy(true); setError(null);
    try { await client.removeRepository(token, slug, id); if (alive.current) { setConfirmId(null); await onChanged(); } }
    catch (cause) { if (alive.current) setError(collaborationError(cause)); }
    finally { requestBusy.current = false; if (alive.current) setBusy(false); }
  };
  return <section>
    <div className="commons-section-head"><h2>{t("Collab.repositories")}</h2>{summary.permissions.manage && <button className="d-btn commons-primary" type="button" onClick={() => setShowForm(true)}>{t("Collab.repoAdd")}</button>}</div>
    <p className="commons-note">{t("Collab.repoBoundary")}</p>
    {error && <p className="commons-error" role="alert">{error}</p>}
    {showForm && <form className="commons-form" onSubmit={(event) => void save(event)} aria-label={t("Collab.repoAdd")}>
      <div className="commons-form-grid">
        <label>{t("Collab.repoName")}<input required value={name} placeholder="owner/repository" pattern="[^/\s]+/[^/\s]+" disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t("Collab.repoBranch")}<input value={branch} placeholder="main" disabled={busy} onChange={(event) => setBranch(event.target.value)} /></label>
        <label className="commons-field-wide">{t("Collab.repoCredential")}<input type="password" value={credential} autoComplete="new-password" spellCheck={false} disabled={busy} onChange={(event) => setCredential(event.target.value)} /></label>
      </div><p className="commons-muted">{t("Collab.repoCredentialHint")}</p>
      <div className="commons-actions"><button className="d-btn commons-primary" disabled={busy}>{t(busy ? "Collab.busy" : "Collab.save")}</button><button className="d-btn" type="button" disabled={busy} onClick={() => { setShowForm(false); setCredential(""); }}>{t("Collab.close")}</button></div>
    </form>}
    {summary.repositories.length === 0 ? <div className="commons-empty"><span className="commons-empty-symbol" aria-hidden="true">⑂</span><h3>{t("Collab.repoEmpty")}</h3><p>{t("Collab.repoEmptyHint")}</p></div> : <>
      <div className="commons-repo-tabs" role="group" aria-label={t("Collab.repositories")}>{summary.repositories.map((repository) => <button className={`commons-repo-card ${selected?.id === repository.id ? "is-selected" : ""}`} type="button" key={repository.id} aria-pressed={selected?.id === repository.id} onClick={() => { setSelectedId(repository.id); setConfirmId(null); }}><strong>{repository.full_name}</strong><span>{repository.base_branch} · {t(repository.private ? "Collab.repoPrivate" : "Collab.repoPublic")}</span></button>)}</div>
      {selected && <>
        <div className="commons-section-head"><a href={selected.html_url} target="_blank" rel="noreferrer">{t("Collab.repoOpen")} ↗</a>{summary.permissions.manage && <button className="d-btn" type="button" onClick={() => setConfirmId(selected.id)}>{t("Collab.repoUnbind")}</button>}</div>
        {confirmId === selected.id && <div className="commons-confirm"><p>{t("Collab.repoConfirm")}</p><button className="d-btn" type="button" disabled={busy} onClick={() => void remove(selected.id)}>{t(busy ? "Collab.busy" : "Collab.confirm")}</button><button className="d-btn" type="button" disabled={busy} onClick={() => setConfirmId(null)}>{t("Collab.close")}</button></div>}
        <RepositoryProposals key={selected.id} token={token} slug={slug} repositoryId={selected.id} canApprove={summary.permissions.manage} client={proposalClient} onPublished={() => setPullsRevision((revision) => revision + 1)} />
        <RepositoryPulls key={`${selected.id}:${pullsRevision}`} token={token} slug={slug} repository={selected} client={client} />
      </>}
    </>}
  </section>;
}
