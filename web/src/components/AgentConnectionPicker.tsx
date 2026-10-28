import {useState} from "react";
import {ProviderMark} from "./ProviderMark";
import {StudioIcon} from "./StudioIcon";
import "../i18n/strings/Studio";
import {useT} from "../i18n/useT";
import "../i18n/strings/AgentConnect";
import "../styles/agent-connect.css";
import "../styles/agent-picker.css";

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
  const [selection,setSelection]=useState<{kind:"cloud";provider:CloudAgentChoice}|{kind:"coding";provider:CodingAgentChoice}|null>(null);
  const key=selection===null?null:selection.kind==="cloud"?`AgentConnect.${selection.provider}`:`AgentConnect.coding.${selection.provider}`;
  return <section className="agent-platform-picker" aria-label={t("AgentConnect.choose")}>
    <header className="agent-platform-heading"><h3>{t("AgentConnect.platformTitle")}</h3><p>{t("AgentConnect.platformHint")}</p></header>
    <div className="agent-platform-categories">
      <section className="agent-platform-category" aria-label={t("AgentConnect.coding")}>
        <h4>{t("AgentConnect.coding")}</h4>
        <div className="agent-platform-grid">{CODING_AGENT_CHOICES.map(provider=><button className="agent-platform-tile" type="button" key={provider} data-coding-provider={provider} aria-pressed={selection?.kind==="coding"&&selection.provider===provider} onClick={()=>setSelection({kind:"coding",provider})}>
          <ProviderMark provider={provider}/><span className="agent-platform-copy"><strong>{t(`AgentConnect.coding.${provider}`)}</strong><small>{t(`AgentConnect.short.${provider}`)}</small></span><StudioIcon name="chevron-down"/>
        </button>)}</div>
      </section>
      <section className="agent-platform-category" aria-label={t("AgentConnect.cloud")}>
        <h4>{t("AgentConnect.platformCloud")}</h4>
        <div className="agent-platform-grid">{CLOUD_AGENT_CHOICES.map(provider=><button className="agent-platform-tile" type="button" key={provider} data-provider={provider} aria-pressed={selection?.kind==="cloud"&&selection.provider===provider} onClick={()=>setSelection({kind:"cloud",provider})}>
          <ProviderMark provider={provider}/><span className="agent-platform-copy"><strong>{t(`AgentConnect.${provider}`)}</strong><small>{t(`AgentConnect.short.${provider}`)}</small></span><StudioIcon name="chevron-down"/>
        </button>)}</div>
      </section>
    </div>
    {selection&&key&&<section className="agent-platform-next" aria-live="polite" aria-label={t("AgentConnect.nextStep")}>
      <h4>{t(key)}</h4><p>{t(`${key}Hint`)}</p>
      <p>{t(selection.kind==="coding"?"AgentConnect.codingNeeds":`AgentConnect.${selection.provider}Needs`)}</p>
      <div><small>{t(selection.provider==="muse"?"AgentConnect.museChoice":"AgentConnect.unverified")}</small><button className="d-btn" type="button" data-picker-continue onClick={()=>selection.kind==="cloud"?onCloud(selection.provider):onLocal(selection.provider)}>{t("AgentConnect.nextStep")}<StudioIcon name="arrow"/></button></div>
    </section>}
    <p className="agent-platform-boundary">{t("AgentConnect.guideOnly")}</p>
    <details className="agent-team-flow"><summary>{t("AgentConnect.advancedFlow")}</summary><p>{t("AgentConnect.coexist")}</p><ol>{(["plan","execute","review"] as const).map((step,index)=><li key={step}><span aria-hidden="true">{index+1}</span><div><strong>{t(`AgentConnect.flow.${step}`)}</strong><p>{t(`AgentConnect.flow.${step}Hint`)}</p></div></li>)}</ol><p className="agent-team-boundary">{t("AgentConnect.executionBoundary")}</p></details>
  </section>;
}
