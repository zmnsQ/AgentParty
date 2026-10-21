import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CollaborationSummary } from "@agentparty/shared/collaboration";
import { AuthError, ForbiddenError } from "../lib/api";
import { apiBase } from "../lib/base";
import { collaborationApi, CollaborationApiError, collaborationError, type CollaborationClient } from "../lib/collaborationApi";
import { useT } from "../i18n/useT";
import { CloudAgentConnections } from "./CloudAgentConnections";
import { RepositoryConnections } from "./RepositoryConnections";
import { ChannelFiles } from "./ChannelFiles";
import "../i18n/strings/CollaborationHub";
import "../styles/collaboration.css";

const TABS = ["agents", "repositories", "files"] as const;
type Tab = typeof TABS[number];

export function CollaborationHub({ token, slug, archived = false, onAuthFailed, client = collaborationApi }: {
  token: string;
  slug: string;
  archived?: boolean;
  onAuthFailed?(message: string): void;
  client?: CollaborationClient;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("agents");
  // Never hand a new group/token/server the previous workspace's data or
  // capabilities, even for the render before its replacement request begins.
  const server = apiBase();
  const scope = useMemo(() => ({}), [token, slug, client, server]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [loaded, setLoaded] = useState<{
    scope: object; summary: CollaborationSummary | null; loading: boolean; error: string | null;
  } | null>(null);
  const summary = loaded?.scope === scope ? loaded.summary : null;
  const loading = loaded?.scope === scope ? loaded.loading : true;
  const error = loaded?.scope === scope ? loaded.error : null;
  const generation = useRef(0);
  const alive = useRef(true);
  const authFailure = useRef(onAuthFailed);
  authFailure.current = onAuthFailed;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const active = () => alive.current && activeScope.current === scope && apiBase() === server && !signal?.aborted;
    // A mutation finishing in an unmounted child must not refresh its old group
    // using the new server selected by the global API client.
    if (!active()) return;
    const current = ++generation.current;
    setLoaded((previous) => ({ scope, summary: previous?.scope === scope ? previous.summary : null, loading: true, error: null }));
    try {
      const result = await client.summary(token, slug, signal);
      if (active() && current === generation.current) setLoaded({ scope, summary: result, loading: false, error: null });
    } catch (cause) {
      if (!active() || current !== generation.current) return;
      const accessLost = cause instanceof AuthError || cause instanceof ForbiddenError || (cause instanceof CollaborationApiError && [401, 403, 404, 410].includes(cause.status));
      const message = cause instanceof CollaborationApiError && cause.status === 404 ? t("Collab.offline") : collaborationError(cause);
      setLoaded((previous) => ({ scope, summary: !accessLost && previous?.scope === scope ? previous.summary : null, loading: false, error: message }));
      if (cause instanceof AuthError) authFailure.current?.(cause.message);
    } finally {
      if (active() && current === generation.current) setLoaded((previous) => previous?.scope === scope ? { ...previous, loading: false } : previous);
    }
  }, [client, scope, server, slug, t, token]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); void refresh(controller.signal);
    return () => { alive.current = false; generation.current++; controller.abort(); };
  }, [refresh]);
  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, active: Tab) => {
    const index = TABS.indexOf(active);
    const next = event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length] : event.key === "ArrowLeft" ? TABS[(index + TABS.length - 1) % TABS.length] : event.key === "Home" ? TABS[0] : event.key === "End" ? TABS[TABS.length - 1] : undefined;
    if (next === undefined) return;
    event.preventDefault(); setTab(next);
    document.getElementById(`commons-tab-${next}`)?.focus();
  };
  const current = summary === null ? null : { ...summary, permissions: { manage: !archived && summary.permissions.manage, run: !archived && summary.permissions.run, upload: !archived && summary.permissions.upload } };
  return <div className="commons-hub">
    <header className="commons-hero"><div><span className="commons-kicker">AGENTPARTY COMMONS</span><p>{t("Collab.subtitle")}</p></div><span className="commons-group">#{slug}</span></header>
    <div className="commons-nav"><div role="tablist" aria-label={t("Collab.title")}>{TABS.map((item) => <button className={`commons-tab ${tab === item ? "is-active" : ""}`} key={item} id={`commons-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`commons-panel-${item}`} tabIndex={tab === item ? 0 : -1} onKeyDown={(event) => selectWithKeyboard(event, item)} onClick={() => setTab(item)}>{t(`Collab.${item}`)}{summary !== null && item !== "files" && <span>{item === "agents" ? summary.connections.length : summary.repositories.length}</span>}</button>)}</div><button className="d-btn" type="button" disabled={loading} onClick={() => void refresh()} aria-label={t("Collab.refresh")}>{t(loading ? "Collab.loading" : "Collab.refresh")}</button></div>
    {error !== null && <p className="commons-error" role="alert">{error}</p>}
    {summary === null && loading && <p className="commons-empty" role="status">{t("Collab.loading")}</p>}
    {current !== null && <>
      {!current.permissions.manage && <p className="commons-muted">{t("Collab.readOnly")}</p>}
      <div className="commons-panel" id={`commons-panel-${tab}`} role="tabpanel" aria-labelledby={`commons-tab-${tab}`}>
        {tab === "agents" && <CloudAgentConnections token={token} slug={slug} summary={current} client={client} onChanged={() => refresh()} />}
        {tab === "repositories" && <RepositoryConnections token={token} slug={slug} summary={current} client={client} onChanged={() => refresh()} />}
        {tab === "files" && <ChannelFiles token={token} slug={slug} canUpload={current.permissions.upload} client={client} />}
      </div>
    </>}
    <footer className="commons-attribution"><p>{t("Collab.source")}</p><a href="https://github.com/leeguooooo/AgentParty" target="_blank" rel="noreferrer">AgentParty ↗</a><span> · </span><a href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE" target="_blank" rel="noreferrer">{t("Collab.license")}</a></footer>
  </div>;
}

export default CollaborationHub;
