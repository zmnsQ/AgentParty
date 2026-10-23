import "../i18n/strings/Studio";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CollaborationSummary } from "@agentparty/shared/collaboration";
import { AuthError, ForbiddenError } from "../lib/api";
import { apiBase } from "../lib/base";
import { collaborationApi, CollaborationApiError, collaborationError, type CollaborationClient } from "../lib/collaborationApi";
import { useT } from "../i18n/useT";
import { CloudAgentConnections } from "./CloudAgentConnections";
import { RepositoryConnections } from "./RepositoryConnections";
import { ChannelFiles } from "./ChannelFiles";
import { CloudBridges } from "./CloudBridges";
import type {CloudAgentChoice} from "./AgentConnectionPicker";
import { OriginalProjectCredit } from "./OriginalProjectCredit";
import "../i18n/strings/CollaborationHub";
import "../styles/collaboration.css";

const TABS = ["bridges", "agents", "files", "repositories"] as const;
type Tab = typeof TABS[number];

interface CollaborationHubProps {
  token: string;
  slug: string;
  archived?: boolean;
  onAuthFailed?(message: string): void;
  client?: CollaborationClient;
  initialTab?: Tab;
  initialProvider?: CloudAgentChoice;
}

export function CollaborationHub(props: CollaborationHubProps) {
  const server = apiBase();
  // Reset the whole private workspace, including unsent prompts, credentials and
  // child request state. The key is opaque: never place a bearer token in a key.
  const scope = useMemo(() => crypto.randomUUID(), [props.token, props.slug, props.client, server]);
  return <ScopedCollaborationHub key={scope} {...props} server={server} />;
}

function ScopedCollaborationHub({ token, slug, archived = false, onAuthFailed, client = collaborationApi, server, initialTab, initialProvider }: CollaborationHubProps & { server: string }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab??"bridges");
  // Keep the selected tab visible without scrolling the whole mobile dialog.
  useEffect(() => {
    const item = typeof document !== "undefined" ? document.getElementById?.(`commons-tab-${tab}`) : null;
    const list = item?.parentElement;
    if (!item || !list || list.scrollWidth <= list.clientWidth) return;
    const active = item.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (active.left < bounds.left) list.scrollLeft -= bounds.left - active.left;
    else if (active.right > bounds.right) list.scrollLeft += active.right - bounds.right;
  }, [tab]);
  const [summary, setSummary] = useState<CollaborationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const authFailure = useRef(onAuthFailed);
  authFailure.current = onAuthFailed;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!alive.current || apiBase() !== server || signal?.aborted) return;
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const result = await client.summary(token, slug, signal);
      if (alive.current && !signal?.aborted && apiBase() === server && current === generation.current) setSummary(result);
    } catch (cause) {
      if (!alive.current || signal?.aborted || apiBase() !== server || current !== generation.current) return;
      if (cause instanceof AuthError || cause instanceof ForbiddenError || (cause instanceof CollaborationApiError && [401, 403, 404, 410].includes(cause.status))) setSummary(null);
      if (cause instanceof AuthError) authFailure.current?.(cause.message);
      setError(cause instanceof CollaborationApiError && cause.status === 404 ? t("Collab.offline") : collaborationError(cause));
    } finally { if (alive.current && apiBase() === server && current === generation.current) setLoading(false); }
  }, [client, slug, t, token, server]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); void refresh(controller.signal);
    return () => { alive.current = false; controller.abort(); };
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
    <header className="commons-hero"><div><span className="commons-kicker">AGENT COMMONS</span><h2>{t("Studio.connectLead")}</h2><p>{t("Studio.connectSub")}</p></div><details className="studio-group-detail"><summary>{t("Studio.id")}</summary><code>#{slug}</code></details></header>
    <div className="commons-nav"><div role="tablist" aria-label={t("Collab.title")}>{TABS.map((item) => <button className={`commons-tab ${tab === item ? "is-active" : ""}`} key={item} id={`commons-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`commons-panel-${item}`} tabIndex={tab === item ? 0 : -1} onKeyDown={(event) => selectWithKeyboard(event, item)} onClick={() => setTab(item)}>{t(item==="bridges"?"Studio.setup":item==="agents"?"Studio.manage":item==="files"?"Studio.files":"Studio.code")}{summary !== null && ((item === "agents" && summary.connections.length > 0) || (item === "repositories" && summary.repositories.length > 0)) && <span>{item === "agents" ? summary.connections.length : summary.repositories.length}</span>}</button>)}</div><button className="d-btn" type="button" disabled={loading} onClick={() => void refresh()} aria-label={t("Collab.refresh")}>{t(loading ? "Collab.loading" : "Collab.refresh")}</button></div>
    {error !== null && <p className="commons-error" role="alert">{error}</p>}
    {summary === null && loading && <p className="commons-empty" role="status">{t("Collab.loading")}</p>}
    {current !== null && <>
      {!current.permissions.manage && <p className="commons-muted">{t("Collab.readOnly")}</p>}
      <div key={tab} className="commons-panel" id={`commons-panel-${tab}`} role="tabpanel" aria-labelledby={`commons-tab-${tab}`}>
        {tab === "agents" && <><p className="studio-direct-hint">{t("Studio.directHint")}</p><CloudAgentConnections token={token} slug={slug} summary={current} client={client} onChanged={() => refresh()} /></>}
        {tab === "repositories" && <RepositoryConnections token={token} slug={slug} summary={current} client={client} onChanged={() => refresh()} />}
        {tab === "files" && <ChannelFiles token={token} slug={slug} canUpload={current.permissions.upload} client={client} />}
        {tab === "bridges" && <CloudBridges token={token} slug={slug} canManage={current.permissions.manage} canRun={current.permissions.run} initialProvider={initialProvider} />}
      </div>
    </>}
    <footer className="commons-attribution"><details className="commons-project-credit"><summary>{t("Attribution.label")}</summary><OriginalProjectCredit compact /></details></footer>
  </div>;
}

export default CollaborationHub;
