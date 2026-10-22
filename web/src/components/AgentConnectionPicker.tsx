import {useT} from "../i18n/useT";
import "../i18n/strings/AgentConnect";
import "../styles/agent-connect.css";
export const CLOUD_AGENT_CHOICES=["dot","muse","cue","grok","hermes"] as const;
export type CloudAgentChoice=typeof CLOUD_AGENT_CHOICES[number];
export function AgentConnectionPicker({onCloud,onLocal}:{onCloud:(provider:CloudAgentChoice)=>void;onLocal:()=>void}){
  const t=useT();
  return <section className="agent-connect-picker" aria-label={t("AgentConnect.choose")}>
    <h3>{t("AgentConnect.choose")}</h3><p>{t("AgentConnect.hint")}</p>
    <h4>{t("AgentConnect.cloud")}</h4>
    <div className="agent-connect-grid">{CLOUD_AGENT_CHOICES.map(provider=><button
      className="agent-connect-option" type="button" key={provider} data-provider={provider}
      onClick={()=>onCloud(provider)}><strong>{t(`AgentConnect.${provider}`)}</strong>
      <span>{t(`AgentConnect.${provider}Hint`)}</span></button>)}</div>
    <section className="agent-connect-local"><h4>{t("AgentConnect.local")}</h4>
      <p>{t("AgentConnect.localHint")}</p><button className="d-btn" type="button" onClick={onLocal}>{t("AgentConnect.localButton")}</button>
    </section>
  </section>;
}
