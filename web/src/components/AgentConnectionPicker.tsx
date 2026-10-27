import {ProviderMark} from "./ProviderMark";
import {StudioIcon} from "./StudioIcon";
import "../i18n/strings/Studio";
import {useT} from "../i18n/useT";
import "../i18n/strings/AgentConnect";
import "../styles/agent-connect.css";

export const CLOUD_AGENT_CHOICES=["dot","muse","cue","grok","hermes"] as const;
export type CloudAgentChoice=typeof CLOUD_AGENT_CHOICES[number];
export const CODING_AGENT_CHOICES=["codex","codebuddy","claude","other"] as const;
export type CodingAgentChoice=typeof CODING_AGENT_CHOICES[number];

/** Connection categories are complementary, not mutually exclusive roles.
 * Selecting a card does not mint credentials, authorize work or run a process. */
export function AgentConnectionPicker({onCloud,onLocal}:{
  onCloud:(provider:CloudAgentChoice)=>void;
  onLocal:(provider:CodingAgentChoice)=>void;
}){
  const t=useT();
  return <section className="agent-connect-picker" aria-label={t("AgentConnect.choose")}>
    <h3>{t("AgentConnect.choose")}</h3><p>{t("AgentConnect.hint")}</p>
    <p className="agent-connect-boundary">{t("AgentConnect.guideOnly")}</p>
    <div className="agent-connect-categories">
      <section className="agent-connect-category" aria-label={t("AgentConnect.coding")}>
        <header><h4>{t("AgentConnect.coding")}</h4><p>{t("AgentConnect.codingHint")}</p></header>
        <div className="agent-connect-grid agent-connect-coding-grid">
          {CODING_AGENT_CHOICES.map(provider=><button className="agent-connect-option" type="button"
            key={provider} data-coding-provider={provider} onClick={()=>onLocal(provider)}>
            <ProviderMark provider={provider}/><strong>{t(`AgentConnect.coding.${provider}`)}</strong>
            <span>{t(`AgentConnect.coding.${provider}Hint`)}</span>
            <small className="agent-connect-prerequisite">{t("AgentConnect.codingNeeds")}</small>
            <small className="agent-connect-availability">{t("AgentConnect.unverified")}</small>
            <span className="studio-option-arrow"><StudioIcon name="arrow"/></span>
          </button>)}
        </div>
      </section>
      <section className="agent-connect-category" aria-label={t("AgentConnect.cloud")}>
        <header><h4>{t("AgentConnect.cloud")}</h4><p>{t("AgentConnect.cloudHint")}</p></header>
        <div className="agent-connect-grid agent-connect-cloud-grid">
          {CLOUD_AGENT_CHOICES.map(provider=><button className="agent-connect-option" type="button"
            key={provider} data-provider={provider} onClick={()=>onCloud(provider)}>
            <ProviderMark provider={provider}/><strong>{t(`AgentConnect.${provider}`)}</strong>
            <span>{t(`AgentConnect.${provider}Hint`)}</span>
            <small className="agent-connect-prerequisite">{t(`AgentConnect.${provider}Needs`)}</small>
            <small className="agent-connect-availability">{t(provider==="muse"?"AgentConnect.museChoice":"AgentConnect.unverified")}</small>
            <span className="studio-option-arrow"><StudioIcon name="arrow"/></span>
          </button>)}
        </div>
      </section>
    </div>
    <details className="agent-team-flow">
      <summary>{t("AgentConnect.advancedFlow")}</summary>
      <p>{t("AgentConnect.coexist")}</p>
      <ol>{(["plan","execute","review"] as const).map((step,index)=><li key={step}>
        <span aria-hidden="true">{index+1}</span><div><strong>{t(`AgentConnect.flow.${step}`)}</strong>
        <p>{t(`AgentConnect.flow.${step}Hint`)}</p></div>
      </li>)}</ol>
      <p className="agent-team-boundary">{t("AgentConnect.executionBoundary")}</p>
    </details>
  </section>;
}
