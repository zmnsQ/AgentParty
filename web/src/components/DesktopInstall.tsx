import { useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useModalFocusTrap } from "./useModalFocusTrap";
import "../i18n/strings/App";

export const DESKTOP_BUILD_GUIDE_URL = "https://github.com/zmnsQ/AgentParty/blob/main/docs/commons-development.zh.md";

interface ButtonProps { className?: string; label?: string; }
interface DialogProps { onClose(): void; returnFocusRef: React.RefObject<HTMLButtonElement | null>; }

function DesktopInstallDialog({ onClose, returnFocusRef }: DialogProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const guideRef = useRef<HTMLAnchorElement | null>(null);
  useModalFocusTrap({ active: true, containerRef: panelRef, initialFocusRef: guideRef, returnFocusRef, onEscape: onClose });
  return (
    <div className="desktop-install-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-install-title" onClick={onClose}>
      <div ref={panelRef} className="desktop-install-dialog" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <header className="desktop-install-head">
          <div><p className="desktop-install-kicker t-mono">{t("App.desktop.installKicker")}</p><h2 id="desktop-install-title">{t("App.desktop.installTitle")}</h2></div>
          <button type="button" className="desktop-install-close" aria-label={t("App.desktop.installClose")} onClick={onClose}>×</button>
        </header>
        <p className="desktop-install-lead">{t("App.desktop.installLead")}</p>
        <ul className="desktop-install-benefits">
          <li>{t("App.desktop.installBenefitResident")}</li><li>{t("App.desktop.installBenefitManage")}</li><li>{t("App.desktop.installBenefitNotify")}</li>
        </ul>
        <div className="desktop-install-actions">
          <a ref={guideRef} href={DESKTOP_BUILD_GUIDE_URL} target="_blank" rel="noreferrer" className="d-btn d-btn--primary">{t("App.desktop.installGuide")} ↗</a>
          <button type="button" className="d-btn" onClick={onClose}>{t("App.desktop.installDone")}</button>
        </div>
        <p className="desktop-install-note">{t("App.desktop.installNote")}</p>
      </div>
    </div>
  );
}

export function DesktopInstallButton({ className = "app-product-link t-mono", label }: ButtonProps) {
  const t = useT();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={buttonRef} type="button" className={className} onClick={() => setOpen(true)}>{label ?? t("App.desktop.download")}</button>
    {open && <DesktopInstallDialog returnFocusRef={buttonRef} onClose={() => setOpen(false)} />}
  </>;
}

/** Preview builds are available through the explicit desktop entry only. */
export function DesktopInstallPrompt(_props: { desktop: boolean }) { return null; }
