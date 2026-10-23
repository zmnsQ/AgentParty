import {useEffect,useRef,useState} from "react";
import {useT} from "../i18n/useT";
import {useLocale} from "../i18n/locale";
import {listChannelAgents,type ChannelAgentInfo} from "../lib/api";
import {cloudBridgesApi,type EventBridgeState,type McpPolicyResponse} from "../lib/cloudBridgesApi";
import {copyText} from "../lib/agentTokenVault";
import {apiBase} from "../lib/base";
import "../i18n/strings/ConnectorUsage";
import "../styles/connector-usage.css";

type TestKind="read"|"post"|"task"|"subscribe";
export function connectorTestPrompt(kind:TestKind,slug:string,agentName:string,zh:boolean):string{
  const key=`onboarding-${zh?"zh":"en"}-${slug}-${agentName}`.slice(0,128);
  const identify=zh
    ?`使用已连接的 AgentCommons 插件。先调用 party_profile，确认群组 ID 是「${slug}」、身份是「${agentName}」；不匹配就停止。`
    :`Use the connected AgentCommons plugin. First call party_profile and verify group ID "${slug}" and agent identity "${agentName}". Stop on any mismatch.`;
  if(kind==="subscribe")return identify+(zh
    ?`在支持事件的 Work / Cloud 或 dot 会话中，通过原生 MCP Events 创建 message.created 订阅，channel_id 为「${slug}」，mention_only 为 true。只在新消息明确 @「${agentName}」时读取相关上下文；仅处理群主明确授权的任务，把结果回复到原消息，不转发私人历史、不自动给其他 Agent 派任务或批准代码发布。不要改成定时轮询。只有平台保存任务且服务器保存订阅后才报告成功；失败请报告错误类别，不要把授权成功说成订阅成功。`
    :`In an event-capable Work/Cloud or dot conversation, create a native MCP Events subscription for message.created with channel_id "${slug}" and mention_only true. On an explicit @mention of "${agentName}", read relevant context, perform only the owner's expressly authorized task and reply to its message. Never expose private history, automatically delegate to other agents or approve code publication. Do not replace events with scheduled polling. Report success only after both the platform task and server subscription are saved; otherwise report the error category.`);
  if(kind==="read")return identify+(zh
    ?"读取本群最近 10 条消息，只告诉我连接是否正常及消息内容；没有消息请明确说明空群。不要发消息、改文件或通知其他 Agent。"
    :" Read the latest 10 messages and report whether access works. Say explicitly if the group is empty. Do not post, change files or notify other agents.");
  if(kind==="post")return identify+(zh
    ?`仅向本群发送一条「ChatGPT 已接入，群消息收发测试成功。」不要 @其他 Agent，不上传文件或修改代码。使用幂等键「${key}」，重试复用这个键。最后告诉我消息序号。`
    :` Post exactly one message: "ChatGPT connected: group messaging test succeeded." Do not @mention agents, upload files or change code. Use idempotency_key "${key}" and reuse it for retries. Report the message sequence.`);
  return identify+(zh
    ?"我已在本群发布测试任务。读取必要上下文，只处理我最新明确交办的测试任务，将结果回复到对应任务消息。不要自行给其他 Agent 派任务、发布代码或转发私人对话；遇到权限不够就告诉我。"
    :" I have posted a test task in this group. Read the necessary context, handle only my latest explicitly assigned test task and reply to its message. Do not assign other agents, publish code or share private chats; report missing permission instead.");
}
interface Snapshot{agents:ChannelAgentInfo[];security:McpPolicyResponse;events:EventBridgeState|null;}
export function ChatGptQuickStart({token,slug,canManage}:{token:string;slug:string;canManage:boolean}){
  const t=useT(),{locale}=useLocale(),zh=locale==="zh";
  const [value,setValue]=useState<Snapshot|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
  const [selected,setSelected]=useState("");
  const [copied,setCopied]=useState<TestKind|null>(null),[copyFailed,setCopyFailed]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{
    const n=++generation.current,base=apiBase(),abort=new AbortController();
    setValue(null);setError(false);setCopied(null);setCopyFailed(false);
    void Promise.all([listChannelAgents(token,slug),cloudBridgesApi.security(token,slug,abort.signal),
      canManage?cloudBridgesApi.events(token,slug,abort.signal):Promise.resolve(null)])
      .then(([agents,security,events])=>{
        if(!abort.signal.aborted&&generation.current===n&&apiBase()===base)setValue({agents,security,events});
      }).catch(()=>{if(!abort.signal.aborted&&generation.current===n)setError(true);});
    return()=>{abort.abort();++generation.current;};
  },[token,slug,canManage,revision]);
  const agents=value?.agents.filter(a=>a.credential_kind==="oauth"&&a.oauth?.provider==="chatgpt")??[];
  const agent=agents.find(a=>a.name===selected)??agents[0];
  const authorized=agent?.oauth?.status==="authorized";
  const policy=value?.security.policy;
  const readable=!!(authorized&&policy?.enabled&&policy.owner_mfa_enabled&&agent?.oauth?.scopes.includes("group.read"));
  const writable=!!(readable&&policy?.allow_write&&agent?.oauth?.scopes.includes("group.write"));
  const count=agent&&value?.events?.agents?value.events.agents.find(a=>a.agent_name===agent.name)?.active_subscriptions??0:null;
  const subscribable=!!(readable&&policy?.allow_events&&agent?.oauth?.scopes.includes("group.events")&&value?.events?.callback_policy_configured);
  const copy=async(kind:TestKind)=>{
    if(!agent||(kind==="subscribe"?!subscribable:kind==="read"?!readable:!writable))return;
    const n=generation.current;
    const ok=await copyText(connectorTestPrompt(kind,slug,agent.name,zh));
    if(generation.current!==n)return;
    setCopied(ok?kind:null);setCopyFailed(!ok);
  };
  return <section className="cloud-bridge-card connector-usage" aria-label={t("ConnectorUsage.title")}>
    <div className="connector-usage-heading"><h3>{t("ConnectorUsage.title")}</h3>
      <button className="d-btn" type="button" onClick={()=>setRevision(v=>v+1)}>{t("ConnectorUsage.refresh")}</button></div>
    {!value&&!error&&<p role="status">{t("ConnectorUsage.loading")}</p>}
    {error&&<p role="alert">{t("ConnectorUsage.error")}</p>}
    {value&&!agent&&<><strong>{t("ConnectorUsage.none")}</strong><p>{t("ConnectorUsage.before")}</p></>}
    {value&&agent&&<>
      {agents.length>1&&<label>{t("ConnectorUsage.choose")}<select value={agent.name} onChange={e=>{setSelected(e.target.value);setCopied(null);}}>
        {agents.map(a=><option key={a.name} value={a.name}>{a.nickname??a.oauth?.client_name} · {a.name}</option>)}
      </select></label>}
      <strong className={authorized?"connector-authorized":"connector-attention"}>{t(authorized?"ConnectorUsage.authorized":"ConnectorUsage.reconnect")}</strong>
      <p>{t("ConnectorUsage.authorizedHint")}</p>
      <p className="connector-workflow">{t("ConnectorUsage.flow")}</p>
      <dl className="connector-capabilities" aria-label={t("ConnectorUsage.status")}>
        <div><dt>{t("ConnectorUsage.read")}</dt><dd>{t(readable?"ConnectorUsage.allowed":"ConnectorUsage.blocked")}</dd></div>
        <div><dt>{t("ConnectorUsage.write")}</dt><dd>{t(writable?"ConnectorUsage.allowed":"ConnectorUsage.blocked")}</dd></div>
        <div><dt>{t("ConnectorUsage.wake")}</dt><dd>{t(value.events?.callback_policy_configured===false?"ConnectorUsage.serverBlocked":count===null?"ConnectorUsage.unknown":count>0?"ConnectorUsage.subscribed":"ConnectorUsage.notSubscribed")}</dd></div>
      </dl>
      {value.events?.callback_policy_configured===false&&<p className="commons-note" role="status">{t("ConnectorUsage.serverNotReady")}</p>}
      <a className="d-btn connector-open-chat" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">{t("ConnectorUsage.open")}</a>
      <ol className="connector-first-steps">
        {(["read","post","task"] as const).map((kind,i)=><li key={kind}>
          <details className="connector-step" open={i===0}><summary><span className="studio-step-number">{i+1}</span><h4>{t(`ConnectorUsage.step${i+1}`)}</h4></summary><div className="connector-step-body"><p>{t(`ConnectorUsage.step${i+1}Help`)}</p>
          <textarea readOnly rows={4} aria-label={t(`ConnectorUsage.step${i+1}`)} value={connectorTestPrompt(kind,slug,agent.name,zh)} onFocus={e=>e.currentTarget.select()}/>
          <button type="button" className="d-btn" disabled={kind==="read"?!readable:!writable} onClick={()=>void copy(kind)}>
            {t(copied===kind?"ConnectorUsage.copied":"ConnectorUsage.copy")}</button>
          {i<2&&<small>{t(`ConnectorUsage.step${i+1}Expect`)}</small>}
          </div></details>
        </li>)}
      </ol>
      {copyFailed&&<p role="alert">{t("ConnectorUsage.copyFailed")}</p>}
      {copied&&<p role="status">{t("ConnectorUsage.copied")}</p>}
      <small>{t("ConnectorUsage.noAutoSend")}</small>
      <details className="connector-subscription-setup connector-step" aria-label={t("ConnectorUsage.subscribeTitle")}>
        <summary><span className="studio-step-number">4</span><h4>{t("ConnectorUsage.subscribeTitle")}</h4></summary><div className="connector-step-body">
        <p>{t(value.events?.callback_policy_configured?"ConnectorUsage.serverPrepared":"ConnectorUsage.serverNotReady")}</p>
        <p>{t("ConnectorUsage.subscribeHow")}</p>
        <textarea readOnly rows={5} aria-label={t("ConnectorUsage.subscribePrompt")} value={connectorTestPrompt("subscribe",slug,agent.name,zh)} onFocus={e=>e.currentTarget.select()}/>
        <button className="d-btn" type="button" disabled={!subscribable} onClick={()=>void copy("subscribe")}>{t("ConnectorUsage.copySubscription")}</button>
        {!subscribable&&<small>{t("ConnectorUsage.subscriptionBlocked")}</small>}
        <small>{t("ConnectorUsage.subscribeExpected")}</small>
        </div>
      </details>
    </>}
  </section>;
}
