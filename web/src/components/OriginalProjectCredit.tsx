import { useT } from "../i18n/useT";
import "../i18n/strings/Attribution";
import "../styles/original-project-credit.css";

/**
 * The author of Agent Commons is zmnsQ. The authors of the inherited
 * AgentParty project are credited separately; upstream LICENSE is unchanged.
 */
export function OriginalProjectCredit({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return <aside
    className={`original-project-credit${compact ? " original-project-credit--compact" : ""}`}
    aria-label={t("Attribution.label")}
  >
    <strong>{t("Attribution.productBy")}</strong>
    <span>{t("Attribution.upstream")}</span>
    <span>{t("Attribution.independent")}</span>
    <span className="original-project-credit__links">
      <a href="https://github.com/zmnsQ" rel="author noopener noreferrer" target="_blank">
        zmnsQ GitHub ↗
      </a>
      {" · "}
      <a href="https://github.com/zmnsQ/AgentParty" rel="noopener noreferrer" target="_blank">
        {t("Attribution.sourceLink")}
      </a>
      {" · "}
      <a href="https://github.com/leeguooooo/AgentParty" rel="noopener noreferrer" target="_blank">
        {t("Attribution.originalLink")}
      </a>
      {" · "}
      <a href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE"
        rel="noopener noreferrer" target="_blank">
        {t("Attribution.licenseLink")}
      </a>
    </span>
  </aside>;
}
