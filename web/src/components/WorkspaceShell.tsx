import {useEffect, useState, type ReactNode} from "react";
import {useLocale} from "../i18n/locale";
import {StudioIcon} from "./StudioIcon";

const key = "commons.navigation.collapsed";
function storedCollapsed() {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
/** Navigation state is a device preference, never an account or permission decision. */
export function WorkspaceShell({navigation, children, route, navigationError}: {navigation: ReactNode; children: ReactNode; route: string | null; navigationError?: string | null}) {
  const {locale} = useLocale();
  const zh = locale === "zh";
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [route]);
  const label = zh ? "工作区导航" : "Workspace navigation";
  return <div className="workspace-frame">
    {navigationError && <p className="banner banner--red workspace-navigation-error" role="alert">{navigationError}</p>}
    <div className={`app-shell workspace-shell${collapsed ? " navigation-collapsed" : ""}${mobileOpen ? " navigation-mobile-open" : ""}`}>
    <aside className="app-side workspace-navigation" aria-label={label}>
      <div className="workspace-nav-heading">
        <button type="button" className="workspace-nav-toggle workspace-nav-desktop" aria-expanded={!collapsed} aria-controls="workspace-navigation-content" title={zh ? (collapsed ? "展开工作区" : "收起工作区") : (collapsed ? "Expand workspace" : "Collapse workspace")} aria-label={label} onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* In-memory state still works. */ }
        }}><StudioIcon name={collapsed ? "chevron-right" : "arrow-left"}/></button>
        <button type="button" className="workspace-nav-toggle workspace-nav-mobile" aria-expanded={mobileOpen} aria-controls="workspace-navigation-content" onClick={() => setMobileOpen(v => !v)}><StudioIcon name={mobileOpen ? "chevron-up" : "chevron-down"}/><span>{label}</span></button>
        <span className="workspace-nav-label">{zh ? "工作区" : "WORKSPACE"}</span>
      </div>
      <div className="workspace-nav-body" id="workspace-navigation-content"><div className="workspace-nav-inner">{navigation}</div></div>
    </aside>
    {children}
  </div></div>;
}
