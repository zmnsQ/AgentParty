import "./ChannelAdminView.css";
import { StudioIcon } from "./StudioIcon";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Visibility } from "../lib/api";
import { useT } from "../i18n/useT";
import "../i18n/strings/Channel";
import "../i18n/strings/VisibilityToggle";
import "../i18n/strings/ChannelAdminView";

export type ChannelAdminSection = "access" | "members" | "safety" | "lifecycle";

export interface ChannelAdminViewMemory {
  slug: string;
  section: ChannelAdminSection;
  query: string;
  filter: "all" | "human" | "agent";
}

export interface ChannelAdminMember {
  name: string;
  display: string;
  kind: "agent" | "human";
  account?: string | null;
  detail?: string | null;
  canRemove: boolean;
  /** Session-local snapshot retained after an authoritative participant_removed frame. */
  removed?: boolean;
  canRestore?: boolean;
}

export interface ChannelAdminCapabilities {
  manageAccess: boolean;
  manageMembers: boolean;
  manageSafety: boolean;
  archive: boolean;
}

export interface ChannelAdminViewProps {
  slug: string;
  channelTitle?: string;
  /** The owning dialog already provides its title, Back and Close controls. */
  embeddedHeader?: boolean;
  visibility: Visibility;
  archived: boolean;
  capabilities: ChannelAdminCapabilities;
  members: readonly ChannelAdminMember[];
  /** A render function receives whether Access is the visible tab, for lifecycle-sensitive confirmations. */
  accessControls?: ReactNode | ((active: boolean) => ReactNode);
  invitationControls?: ReactNode;
  safetyControls?: ReactNode;
  initialSection?: ChannelAdminSection;
  /** In-memory navigation context only; never confirmations, credentials or mutations. */
  viewMemory?: { current: ChannelAdminViewMemory | null };
  activeSection?: ChannelAdminSection;
  detail?: ReactNode;
  detailBackLabel?: string;
  removingMember?: string | null;
  restoringMember?: string | null;
  memberError?: string | null;
  archiving?: boolean;
  lifecycleError?: string | null;
  onSectionChange?: (section: ChannelAdminSection) => void;
  onEditAccess?: () => void;
  onManageInvitations?: () => void;
  onOpenMember?: (name: string) => void;
  onBackFromDetail?: () => void;
  onRemoveMember?: (name: string) => void;
  onRestoreMember?: (member: ChannelAdminMember) => void;
  onArchive?: () => void;
  onClose?: () => void;
}

const SECTION_ORDER: readonly ChannelAdminSection[] = [
  "access",
  "members",
  "safety",
  "lifecycle",
];

function sectionFromKey(
  key: string,
  current: number,
): ChannelAdminSection | null {
  if (key === "Home") return SECTION_ORDER[0]!;
  if (key === "End") return SECTION_ORDER[SECTION_ORDER.length - 1]!;
  if (key === "ArrowRight") return SECTION_ORDER[(current + 1) % SECTION_ORDER.length]!;
  if (key === "ArrowLeft") {
    return SECTION_ORDER[(current - 1 + SECTION_ORDER.length) % SECTION_ORDER.length]!;
  }
  return null;
}

/**
 * Channel-scoped administration shell.
 *
 * API calls stay with the parent. Access and invitation actions are routed
 * through callbacks so this view never nests another modal inside the channel
 * panel. The existing inline guard controls can be mounted in the safety slot.
 * Tabs remain mounted so in-progress form state is not lost between sections.
 */
export function ChannelAdminView({
  slug,
  channelTitle,
  embeddedHeader = false,
  visibility,
  archived,
  capabilities,
  members,
  accessControls,
  invitationControls,
  safetyControls,
  initialSection = "access",
  viewMemory,
  activeSection: controlledSection,
  detail,
  detailBackLabel = "Back",
  removingMember = null,
  restoringMember = null,
  memberError = null,
  archiving = false,
  lifecycleError = null,
  onSectionChange,
  onEditAccess,
  onManageInvitations,
  onOpenMember,
  onBackFromDetail,
  onRemoveMember,
  onRestoreMember,
  onArchive,
  onClose,
}: ChannelAdminViewProps) {
  const t = useT();
  const idPrefix = useId();
  const remembered = viewMemory?.current?.slug === slug ? viewMemory.current : null;
  const [internalSection, setInternalSection] = useState<ChannelAdminSection>(() => remembered?.section ?? initialSection);
  const activeSection = controlledSection ?? internalSection;
  const tabRefs = useRef(new Map<ChannelAdminSection, HTMLButtonElement>());
  const memberOpenRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailBackRef = useRef<HTMLButtonElement | null>(null);
  const detailReturnMemberRef = useRef<string | null>(null);
  const detailWasOpenRef = useRef(false);
  const showingDetail = detail !== undefined && detail !== null;
  const activeMemberCount = members.filter((member) => member.removed !== true).length;
  const humanCount = members.filter(member => !member.removed && member.kind === "human").length;
  const agentCount = members.filter(member => !member.removed && member.kind === "agent").length;
  const [accessExpanded, setAccessExpanded] = useState(false);
  const [memberFilter, setMemberFilter] = useState<"all" | "human" | "agent">(() => remembered?.filter ?? "all");
  const [memberQuery, setMemberQuery] = useState(() => remembered?.query ?? "");
  useEffect(() => {
    if (viewMemory) viewMemory.current = { slug, section: activeSection, query: memberQuery, filter: memberFilter };
  }, [viewMemory, slug, activeSection, memberQuery, memberFilter]);
  const [copiedIdentity, setCopiedIdentity] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const query = memberQuery.trim().toLocaleLowerCase();
  const visibleMembers = members.filter(member =>
    (memberFilter === "all" || member.kind === memberFilter)
    && (!query || `${member.display} ${member.name}`.toLocaleLowerCase().includes(query)));
  const copyIdentity = async (name: string) => {
    setCopyFailed(false);
    try { await navigator.clipboard.writeText(name); setCopiedIdentity(name); }
    catch { setCopyFailed(true); }
  };

  useEffect(() => {
    if (!detailWasOpenRef.current && showingDetail) {
      detailBackRef.current?.focus();
    } else if (detailWasOpenRef.current && !showingDetail) {
      const memberName = detailReturnMemberRef.current;
      detailReturnMemberRef.current = null;
      if (memberName !== null) memberOpenRefs.current.get(memberName)?.focus();
    }
    detailWasOpenRef.current = showingDetail;
  }, [showingDetail]);

  const selectSection = (section: ChannelAdminSection, focus = false) => {
    if (controlledSection === undefined) setInternalSection(section);
    onSectionChange?.(section);
    if (focus) tabRefs.current.get(section)?.focus();
  };

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const next = sectionFromKey(event.key, currentIndex);
    if (next === null) return;
    event.preventDefault();
    selectSection(next, true);
  };

  const tabs: Array<{
    id: ChannelAdminSection;
    label: string;
    content: ReactNode;
  }> = [
    {
      id: "access",
      label: t("ChannelAdmin.tab.access"),
      content: (
        <>
          <h3 className="settings-module-title">{t("ChannelAdmin.access.title")}</h3>
          <div className="channel-admin-overview">
            <div><span>{t("ChannelAdmin.overview.people")}</span><strong>{humanCount}</strong></div>
            <div><span>{t("ChannelAdmin.overview.agents")}</span><strong>{agentCount}</strong></div>
            <div><span>{t("ChannelAdmin.overview.permission")}</span><strong>{t(!archived && Object.values(capabilities).some(Boolean) ? "ChannelAdmin.overview.manager" : "ChannelAdmin.overview.reader")}</strong></div>
          </div>
          <p className="channel-admin-context">{t("ChannelAdmin.overview.hint")}</p>
          <div className="channel-admin-shortcuts">
            <button type="button" className="d-btn" onClick={() => selectSection("members")}><StudioIcon name="human" />{t("ChannelAdmin.overview.manageMembers")}</button>
            <button type="button" className="d-btn" onClick={() => { setMemberFilter("agent"); selectSection("members"); }}><StudioIcon name="agent" />{t("ChannelAdmin.overview.manageAgents")}</button>
          </div>
          <details className="channel-admin-disclosure" onToggle={event => setAccessExpanded(event.currentTarget.open)}>
            <summary><strong>{t("ChannelAdmin.access.visibility")}</strong><span>{t(`Visibility.opt.${visibility}`)}</span></summary>
          <section className="settings-section">
            <div className="settings-label">{t("ChannelAdmin.access.visibility")}</div>
            <p className="settings-hint">
              {t("ChannelAdmin.access.current", {
                visibility: t(`Visibility.opt.${visibility}`),
              })}
            </p>
            {!archived && capabilities.manageAccess && accessControls !== undefined
              ? typeof accessControls === "function"
                ? accessControls(activeSection === "access" && accessExpanded)
                : accessControls
              : !archived && capabilities.manageAccess && onEditAccess !== undefined && (
              <button type="button" className="d-btn" onClick={onEditAccess}>
                {t("ChannelAdmin.access.edit")}
              </button>
              )}
            {!archived
              && capabilities.manageAccess
              && accessControls === undefined
              && onEditAccess === undefined
              && (
              <p className="settings-hint">{t("ChannelAdmin.actionUnavailable")}</p>
            )}
          </section>
          </details>
          <details className="channel-admin-disclosure">
            <summary><strong>{t("ChannelAdmin.access.invitations")}</strong><span>{t("ChannelAdmin.invitations.hint")}</span></summary>
          <section className="settings-section">
            {!archived && capabilities.manageAccess && invitationControls !== undefined
              ? invitationControls
              : !archived && capabilities.manageAccess && onManageInvitations !== undefined && (
              <button type="button" className="d-btn" onClick={onManageInvitations}>
                {t("ChannelAdmin.access.manageInvitations")}
              </button>
              )}
            {(archived || !capabilities.manageAccess) && (
              <p className="settings-hint">
                {archived
                  ? t("ChannelAdmin.access.archived")
                  : t("ChannelAdmin.access.readOnly")}
              </p>
            )}
            {!archived
              && capabilities.manageAccess
              && invitationControls === undefined
              && onManageInvitations === undefined
              && (
              <p className="settings-hint">{t("ChannelAdmin.actionUnavailable")}</p>
            )}
          </section>
          </details>
        </>
      ),
    },
    {
      id: "members",
      label: t("ChannelAdmin.tab.members"),
      content: (
        <>
          <h3 className="settings-module-title">{t("ChannelAdmin.members.title")}</h3>
          <div className="channel-admin-member-tools">
            <div className="channel-admin-member-filters" role="group" aria-label={t("ChannelAdmin.members.filter")}>
              {(["all", "human", "agent"] as const).map(filter => <button key={filter} type="button" className="d-btn" aria-pressed={memberFilter === filter} data-member-filter={filter} onClick={() => setMemberFilter(filter)}>{t(`ChannelAdmin.filter.${filter}`)}</button>)}
            </div>
            <input type="search" className="d-input" value={memberQuery} aria-label={t("ChannelAdmin.members.search")} placeholder={t("ChannelAdmin.members.search")} onChange={event => setMemberQuery(event.currentTarget.value)} />
          </div>
          <p className="channel-admin-context">{t("ChannelAdmin.members.hint")}</p>
          {copyFailed && <p role="alert" className="guard-setting-error">{t("ChannelAdmin.members.copyFailed")}</p>}
          {visibleMembers.length === 0
            ? <p className="settings-hint">{t(members.length === 0 ? "ChannelAdmin.members.empty" : "ChannelAdmin.members.noMatch")}</p>
            : (
                <div role="list" aria-label={t("ChannelAdmin.members.listLabel")}>
                  {visibleMembers.map((member) => {
                    const removing = removingMember === member.name;
                    const restoring = restoringMember === member.name;
                    return (
                      <article key={member.name} role="listitem" className="settings-section channel-admin-member-row">
                        <div className="settings-account">
                          <strong className="settings-account-name">{member.display}</strong>
                          <span className={`settings-account-chip settings-account-chip--${member.kind}`}>
                            {t(`ChannelAdmin.memberKind.${member.kind}`)}
                          </span>
                          {member.removed === true && (
                            <span className="t-mono settings-hint">
                              {t("ChannelAdmin.members.removed")}
                            </span>
                          )}

                        </div>
                        <details className="channel-admin-identity">
                          <summary>{t("ChannelAdmin.members.identity")}</summary>
                          <code>{member.name}</code>
                          <button type="button" className="d-btn" onClick={() => { void copyIdentity(member.name); }}>{t(copiedIdentity === member.name ? "ChannelAdmin.members.copied" : "ChannelAdmin.members.copy")}</button>
                        </details>
                        {member.detail != null && member.detail !== "" && (
                          <p className="settings-hint">{member.detail}</p>
                        )}
                        {(
                          (member.removed !== true && onOpenMember !== undefined)
                          || member.canRemove
                          || (
                            member.removed === true
                            && member.canRestore === true
                            && capabilities.manageMembers
                            && onRestoreMember !== undefined
                          )
                        ) && (
                          <div className="settings-account">
                            {member.removed !== true && onOpenMember !== undefined && (
                              <button
                                ref={(node) => {
                                  if (node === null) memberOpenRefs.current.delete(member.name);
                                  else memberOpenRefs.current.set(member.name, node);
                                }}
                                type="button"
                                className="d-btn"
                                data-admin-member-open={member.name}
                                onClick={() => {
                                  detailReturnMemberRef.current = member.name;
                                  onOpenMember(member.name);
                                }}
                              >
                                {t("ChannelAdmin.members.view")}
                              </button>
                            )}
                            {member.canRemove && onRemoveMember !== undefined && (
                              <button
                                type="button"
                                className="d-btn"
                                data-admin-member-remove={member.name}
                                disabled={
                                  archived
                                  || !capabilities.manageMembers
                                  || removingMember !== null
                                  || restoringMember !== null
                                }
                                aria-busy={removing}
                                aria-label={t("ChannelAdmin.members.removeLabel", { name: member.display })}
                                onClick={() => onRemoveMember(member.name)}
                              >
                                {removing
                                  ? t("ChannelAdmin.members.removing")
                                  : t("ChannelAdmin.members.remove")}
                              </button>
                            )}
                            {member.removed === true
                              && member.canRestore === true
                              && capabilities.manageMembers
                              && onRestoreMember !== undefined
                              && (
                                <button
                                  type="button"
                                  className="d-btn"
                                  data-admin-member-restore={member.name}
                                  disabled={
                                    archived
                                    || removingMember !== null
                                    || restoringMember !== null
                                  }
                                  aria-busy={restoring}
                                  aria-label={t("ChannelAdmin.members.restoreLabel", { name: member.display })}
                                  onClick={() => onRestoreMember(member)}
                                >
                                  {restoring
                                    ? t("ChannelAdmin.members.restoring")
                                    : t("ChannelAdmin.members.restore")}
                                </button>
                              )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
          {members.some((member) => (
            (member.removed === true && member.canRestore === true && onRestoreMember === undefined)
            || (member.removed !== true && member.canRemove && onRemoveMember === undefined)
          ))
            && capabilities.manageMembers
            && (
              <p className="settings-hint">{t("ChannelAdmin.actionUnavailable")}</p>
            )}
        </>
      ),
    },
    {
      id: "safety",
      label: t("ChannelAdmin.tab.safety"),
      content: (
        <>
          <h3 className="settings-module-title">{t("ChannelAdmin.safety.title")}</h3>
          <p className="channel-admin-context">{t("ChannelAdmin.safety.hint")}</p>
          {!archived && capabilities.manageSafety && safetyControls !== undefined
            ? safetyControls
            : (
                <p className="settings-hint">
                  {
                    archived
                      ? t("ChannelAdmin.safety.archived")
                      : !capabilities.manageSafety
                        ? t("ChannelAdmin.safety.readOnly")
                        : t("ChannelAdmin.actionUnavailable")
                  }
                </p>
              )}
        </>
      ),
    },
    {
      id: "lifecycle",
      label: t("ChannelAdmin.tab.lifecycle"),
      content: (
        <>
          <h3 className="settings-module-title">{t("ChannelAdmin.lifecycle.title")}</h3>
          <p className="channel-admin-danger-note">{t("ChannelAdmin.lifecycle.warning")}</p>
          <section className="settings-section channel-admin-danger">
            <div className="settings-label">{t("ChannelAdmin.lifecycle.status")}</div>
            <p className="settings-hint">
              {archived
                ? t("ChannelAdmin.lifecycle.archived")
                : t("ChannelAdmin.lifecycle.active")}
            </p>
            {!archived && (!capabilities.archive || onArchive !== undefined) && (
              <button
                type="button"
                className="d-btn archive-channel-btn"
                data-admin-archive
                disabled={!capabilities.archive || archiving || onArchive === undefined}
                aria-busy={archiving}
                onClick={onArchive}
                title={t("Channel.archive.buttonTitle")}
              >
                {archiving
                  ? t("Channel.archive.archiving")
                  : t("Channel.archive.button")}
              </button>
            )}
            {!archived && capabilities.archive && onArchive === undefined && (
              <p className="settings-hint">{t("ChannelAdmin.actionUnavailable")}</p>
            )}
          </section>
        </>
      ),
    },
  ];

  const titleId = `${idPrefix}-channel-admin-title`;
  const tabId = (section: ChannelAdminSection) => `${idPrefix}-channel-admin-tab-${section}`;
  const panelId = (section: ChannelAdminSection) => `${idPrefix}-channel-admin-panel-${section}`;

  return (
    <section className="team-blog channel-admin-view" aria-labelledby={embeddedHeader ? undefined : titleId} aria-label={embeddedHeader ? t("ChannelAdmin.title") : undefined}>
      <header className="team-blog-head">
        {embeddedHeader ? <span className="channel-admin-channel-name">{channelTitle?.trim() || slug}</span> : <div className="team-blog-title">
          <h2 id={titleId} className="team-blog-name">{t("ChannelAdmin.title")}</h2>
          <span className="t-mono team-blog-prompt">
            {channelTitle?.trim() || t("ChannelAdmin.subtitle", { slug })}
          </span>
        </div>}
        <div className="team-blog-stats" role="list">
          <span className="t-mono team-blog-stat" role="listitem">
            {t(`Visibility.opt.${visibility}`)}
          </span>
          <span className="t-mono team-blog-stat" role="listitem">
            {t("ChannelAdmin.memberCount", { count: activeMemberCount })}
          </span>
          <span
            className={`t-mono team-blog-stat${archived ? " team-blog-stat--hot" : ""}`}
            role="listitem"
          >
            {archived ? t("ChannelAdmin.status.archived") : t("ChannelAdmin.status.active")}
          </span>
        </div>
        {!embeddedHeader && onClose !== undefined && (
          <button type="button" className="d-btn team-blog-close" onClick={onClose}>
            {t("ChannelAdmin.close")} <StudioIcon name="close" />
          </button>
        )}
      </header>

      <nav
        className="team-blog-tabs"
        role="tablist"
        aria-label={t("ChannelAdmin.navigation")}
        aria-orientation="horizontal"
        hidden={showingDetail}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            ref={(node) => {
              if (node === null) tabRefs.current.delete(tab.id);
              else tabRefs.current.set(tab.id, node);
            }}
            type="button"
            role="tab"
            data-admin-section={tab.id}
            aria-selected={activeSection === tab.id}
            aria-controls={panelId(tab.id)}
            tabIndex={activeSection === tab.id ? 0 : -1}
            className={`team-blog-tab${activeSection === tab.id ? " team-blog-tab--active" : ""}`}
            onClick={() => selectSection(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            <StudioIcon name={tab.id === "access" ? "settings" : tab.id === "members" ? "human" : tab.id === "safety" ? "shield" : "archive"} size={15} />
            <span className="team-blog-tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      {(memberError !== null || lifecycleError !== null) && (
        <div className="guard-setting-error" role="alert" aria-atomic="true">
          {memberError !== null && <p>{memberError}</p>}
          {lifecycleError !== null && <p>{lifecycleError}</p>}
        </div>
      )}

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={panelId(tab.id)}
          className="team-blog-panel settings-module"
          role="tabpanel"
          aria-labelledby={tabId(tab.id)}
          hidden={showingDetail || activeSection !== tab.id}
        >
          {tab.content}
        </div>
      ))}

      {showingDetail && (
        <div className="team-blog-panel team-blog-detail">
          <button
            ref={detailBackRef}
            type="button"
            className="d-btn team-blog-detail-back"
            onClick={onBackFromDetail}
          >
            ← {detailBackLabel}
          </button>
          {detail}
        </div>
      )}
    </section>
  );
}
