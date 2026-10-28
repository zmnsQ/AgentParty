import type {GrokSubmissionSafety} from "../lib/grokSubmissionSafety";
import "../i18n/strings/Studio";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CollaborationSummary } from "@agentparty/shared/collaboration";
import { AuthError, ForbiddenError } from "../lib/api";
import { apiBase } from "../lib/base";
import { collaborationApi, CollaborationApiError, collaborationError, type CollaborationClient } from "../lib/collaborationApi";
import { useT } from "../i18n/useT";
import { ConnectorGrants } from "./ConnectorGrants";
import { CloudAgentConnections } from "./CloudAgentConnections";
import { RepositoryConnections } from "./RepositoryConnections";
import { ChannelFiles } from "./ChannelFiles";
import { CloudBridges } from "./CloudBridges";
import type {CloudAgentChoice} from "./AgentConnectionPicker";
import { OriginalProjectCredit } from "./OriginalProjectCredit";
import "../i18n/strings/CollaborationHub";
import "../styles/collaboration.css";

const TABS = ["bridges", "files", "repositories"] as const;
type Tab = typeof TABS[number];

export interface CollaborationView {tab:Tab;view:"setup"|"manage"|"configure";provider:CloudAgentChoice|null;}
interface CollaborationHubProps {
  submissionSafety?:GrokSubmissionSafety;
  dispatchScopeReady?:boolean;
  viewMemory?:{current:CollaborationView|null};
  token: string;
  slug: string;
  archived?: boolean;
  onAuthFailed?(message: string): void;
  client?: CollaborationClient;
  initialTab?: Tab | "agents";
  initialProvider?: CloudAgentChoice;
}

export function CollaborationHub(props: CollaborationHubProps) {
  const server = apiBase();
  // Reset the whole private workspace, including unsent prompts, credentials and
  // child request state. The key is opaque: never place a bearer token in a key.
  const scope = useMemo(() => crypto.randomUUID(), [props.token, props.slug, props.client, server]);
  return <ScopedCollaborationHub key={scope} {...props} server={server} />;
}

function ScopedCollaborationHub({ submissionSafety, dispatchScopeReady=true, token, slug, archived = false, onAuthFailed, client = collaborationApi, server, initialTab, initialProvider, viewMemory }: CollaborationHubProps & { server: string }) {
  const t = useT();
  const [apiProvider,setApiProvider] = useState<"hermes"|"manus"|undefined>();
  const [tab, setTab] = useState<Tab>(initialTab==="agents"?"bridges":initialTab??viewMemory?.current?.tab??"bridges");
  const [connectionView,setConnectionView]=useState<"setup"|"manage"|"configure">(viewMemory?.current?.view==="manage"?"manage":initialTab==="agents"?"manage":"setup");
  const [selectedProvider,setSelectedProvider]=useState<CloudAgentChoice|null>(initialProvider??viewMemory?.current?.provider??null);
  useEffect(()=>{if(viewMemory)viewMemory.current={tab,view:connectionView,provider:selectedProvider};},[tab,connectionView,selectedProvider,viewMemory]);
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
    <div className="commons-nav"><div role="tablist" aria-label={t("Collab.title")}>{TABS.map((item) => <button className={`commons-tab ${tab === item ? "is-active" : ""}`} key={item} id={`commons-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`commons-panel-${item}`} tabIndex={tab === item ? 0 : -1} onKeyDown={(event) => selectWithKeyboard(event, item)} onClick={() => setTab(item)}>{t(item==="bridges"?"Studio.addAgent":item==="files"?"Studio.files":"Studio.code")}{summary !== null && ((item === "repositories" && summary.repositories.length > 0)) && <span>{summary.repositories.length}</span>}</button>)}</div><button className="d-btn" type="button" disabled={loading} onClick={() => void refresh()} aria-label={t("Collab.refresh")}>{t(loading ? "Collab.loading" : "Collab.refresh")}</button></div>
    {error !== null && <p className="commons-error" role="alert">{error}</p>}
    {summary === null && loading && <p className="commons-empty" role="status">{t("Collab.loading")}</p>}
    {current !== null && <>
      {!current.permissions.manage && <p className="commons-muted">{t("Collab.readOnly")}</p>}
      <div key={tab} className="commons-panel" id={`commons-panel-${tab}`} role="tabpanel" aria-labelledby={`commons-tab-${tab}`}>

        {tab === "repositories" && <RepositoryConnections token={token} slug={slug} summary={current} client={client} onChanged={() => refresh()} />}
        {tab === "files" && <ChannelFiles token={token} slug={slug} canUpload={current.permissions.upload} client={client} />}
        {tab === "bridges" && <>
          <nav className="commons-actions" aria-label={t("Studio.addAgent")}>
            <button className="d-btn" type="button" aria-pressed={connectionView!=="manage"} onClick={()=>{setApiProvider(undefined);setConnectionView("setup");}}>{t("Studio.setup")}</button>
            <button className="d-btn" type="button" aria-pressed={connectionView==="manage"} onClick={()=>{setApiProvider(undefined);setConnectionView("manage");}}>{t("Studio.manage")}</button>
          </nav>
          {connectionView==="setup" && <CloudBridges submissionSafety={submissionSafety} showAuthorizationManagement={false} token={token} slug={slug} canManage={current.permissions.manage} canRun={current.permissions.run&&dispatchScopeReady} initialProvider={selectedProvider??undefined} onProviderChange={setSelectedProvider} onConfigureApi={provider=>{setApiProvider(provider);setConnectionView("configure");}} />}
          {connectionView!=="setup" && <>
            {connectionView==="configure" && <button className="d-btn" type="button" onClick={()=>setConnectionView("setup")}>{t("Studio.backPlatforms")}</button>}
            <CloudAgentConnections key={connectionView+":"+(apiProvider??"")} initialProvider={connectionView==="configure"?apiProvider:undefined} token={token} slug={slug} summary={current} client={client} onChanged={()=>refresh()} onConnect={()=>{setApiProvider(undefined);setConnectionView("setup");}} />
            {connectionView==="manage" && current.permissions.manage && <section><h3>{t("Studio.authorizedConnections")}</h3><ConnectorGrants slug={slug}/></section>}
          </>}
        </>}
      </div>
    </>}
    <footer className="commons-attribution"><details className="commons-project-credit"><summary>{t("Attribution.label")}</summary><OriginalProjectCredit compact /></details></footer>
  </div>;
}

export default CollaborationHub;
