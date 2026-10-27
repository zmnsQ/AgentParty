import {connectionFailure,automationDeliveryLabel} from "../lib/connectionGuidance";
import {MuseCloudPanel} from "./MuseCloudPanel";
import {ProviderMark} from "./ProviderMark";
import "../i18n/strings/Studio";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../i18n/locale";
import { apiBase } from "../lib/base";
import { listChannelAgents, type ChannelAgentInfo } from "../lib/api";
import { cloudBridgesApi, type CueAgent, type EventBridgeState, type GrokBridgeState } from "../lib/cloudBridgesApi";
import { ConnectorGrants } from "./ConnectorGrants";
import { ChatGptQuickStart } from "./ChatGptQuickStart";
import "../i18n/strings/ConnectorUsage";
import {McpSecurityPanel} from "./McpSecurityPanel";
import {useT} from "../i18n/useT";
import type {CloudAgentChoice} from "./AgentConnectionPicker";
import "../i18n/strings/AgentConnect";
import "../styles/cloud-bridges.css";

interface Props { token:string;slug:string;canManage:boolean;canRun:boolean;initialProvider?:CloudAgentChoice;onConfigureApi?(provider:"hermes"|"manus"):void; }
export function CloudBridges({token,slug,canManage,canRun,initialProvider,onConfigureApi}:Props){
  const t=useT();
  const [selected,setSelected]=useState<CloudAgentChoice>(initialProvider??"dot");
  const {locale}=useLocale();const zh=locale==="zh";
  const [state,setState]=useState<GrokBridgeState|null>(null);
  const [events,setEvents]=useState<EventBridgeState|null>(null);
  const [authorizedAgents,setAuthorizedAgents]=useState<ChannelAgentInfo[]|null>(null);
  const [cue,setCue]=useState<CueAgent[]>([]);
  const [name,setName]=useState("Grok Automation");
  const [endpoint,setEndpoint]=useState("");
  const [secret,setSecret]=useState("");
  const [apiKey,setApiKey]=useState("");
  const [prompt,setPrompt]=useState("");
  const [pendingId,setPendingId]=useState<{prompt:string;id:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const alive=useRef(true);
  const scope=useRef({token,slug,base:apiBase()});
  scope.current={token,slug,base:apiBase()};
  const isActive=useCallback(()=>alive.current&&scope.current.token===token&&scope.current.slug===slug&&apiBase()===scope.current.base,[slug,token]);
  const reload=useCallback(async(signal?:AbortSignal)=>{
    const [grok,eventState,connections]=await Promise.all([
      cloudBridgesApi.grok(token,slug,signal),
      canManage ? cloudBridgesApi.events(token,slug,signal) : Promise.resolve(null),
      // Read-only status discovery: this is not a WebSocket heartbeat.
      canManage ? listChannelAgents(token,slug).catch(()=>null) : Promise.resolve(null),
    ]);
    if(isActive()&&!signal?.aborted){setState(grok);setEvents(eventState);setAuthorizedAgents(connections);setError("");}
  },[token,slug,canManage,isActive]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();
    void reload(controller.signal).catch(e=>{if(isActive()&&!controller.signal.aborted)setError(connectionFailure(e,zh));});
    return()=>{alive.current=false;controller.abort();};
  },[reload,isActive]);
  const task=async(fn:()=>Promise<void>)=>{
    if(busy||!isActive())return;
    setBusy(true);setError("");setNotice("");
    try{await fn();}catch(e){if(isActive())setError(connectionFailure(e,zh));}
    finally{if(isActive())setBusy(false);}
  };
  const saveGrok=(e:FormEvent)=>{e.preventDefault();void task(async()=>{
    if(!canManage)throw new Error("owner_only");
    await cloudBridgesApi.connectGrok(token,slug,{name:name.trim(),endpoint:endpoint.trim(),signing_secret:secret.trim()});
    if(isActive()){setSecret("");setEndpoint("");setNotice(zh?"已保存加密配置":"Encrypted configuration saved");}
    await reload();
  });};
  const discover=(e:FormEvent)=>{e.preventDefault();void task(async()=>{
    if(!canManage)throw new Error("owner_only");
    const result=await cloudBridgesApi.cue(token,slug,apiKey);
    if(isActive()){setCue(result.agents);setApiKey("");setNotice(zh?"已从 Manus API 读取 Agent 列表。请在云端 Agent 页面使用对应 ID 建立连接。":"Retrieved your Cue agents via Manus API. Use their IDs in the Cloud agents tab.");}
  });};
  const send=(e:FormEvent)=>{e.preventDefault();void task(async()=>{
    if(!canRun)throw new Error("human_member_required");
    const text=prompt.trim();
    if(!text)throw new Error("prompt_required");
    const id=pendingId?.prompt===text?pendingId.id:crypto.randomUUID();
    setPendingId({id,prompt:text});
    const r=await cloudBridgesApi.sendToGrok(token,slug,{prompt:text,request_id:id});
    if(isActive()){
      setNotice(zh?`投递状态：${automationDeliveryLabel(r.delivery.state,zh)}（不代表 Bot 已完成）`:`Delivery: ${automationDeliveryLabel(r.delivery.state,zh)} (not proof of Bot completion)`);
      setPrompt("");setPendingId(null);
    }
    await reload();
  });};
  return <section className="cloud-bridges" aria-label={zh?"Agent 接入指南":"Agent connection guides"}>
    <h2>{zh?"选择平台，再按步骤接入":"Choose a platform, then follow its steps"}</h2>
    <p>{zh?"先确认你已有的工具和账号。安装、授权、绑定本群与实际运行是不同步骤；查看说明不会启动任务。":"Check the tools and accounts you already have. Installation, authorization, group binding and running a task are separate steps. Viewing a guide does not start work."}</p>
    {error&&<p role="alert" className="commons-error">{error}</p>}
    {notice&&<p role="status" className="commons-success">{notice}</p>}
    {canManage && <details className="cloud-bridge-card connector-presence-overview" aria-label={t("ConnectorUsage.connectionOverviewTitle")}>
      <summary>{t("ConnectorUsage.connectionOverviewTitle")}</summary>
      <p>{t("ConnectorUsage.connectionOverviewHint")}</p>
      {authorizedAgents===null && <p role="status">{t("ConnectorUsage.connectionStatusUnknown")}</p>}
      {authorizedAgents?.filter(item=>item.credential_kind==="oauth").length===0 && (
        <p>{t("ConnectorUsage.noneConnected")}</p>
      )}
      {authorizedAgents && <dl className="connector-presence-list">
        {authorizedAgents.filter(item=>item.credential_kind==="oauth").map(item=>{
          const count=events?.agents?.find(sub=>sub.agent_name===item.name)?.active_subscriptions;
          const authorized=item.oauth?.status==="authorized";
          return <div key={item.name} className="connector-presence-item">
            <dt>
              <strong>{item.nickname??item.oauth?.client_name??item.name}</strong>
              <code>{item.name}</code>
            </dt>
            <dd>{t(authorized?"ConnectorUsage.authorized":"ConnectorUsage.reconnect")}</dd>
            <dd>{count===undefined
              ?t("ConnectorUsage.unknown")
              :count>0?t("ConnectorUsage.subscribed"):t("ConnectorUsage.notSubscribed")}</dd>
            <dd>{t("ConnectorUsage.notWebsocketPresence")}</dd>
          </div>;
        })}
      </dl>}
    </details>}
    <p className="commons-note">{t("AgentConnect.testWarning")}</p>
    <div className="agent-connect-tabs" aria-label={t("AgentConnect.cloud")}>
      {(["dot","muse","cue","hermes","grok"] as const).map(provider=><button className="d-btn" type="button" key={provider}
        aria-pressed={selected===provider} onClick={()=>setSelected(provider)}><ProviderMark provider={provider}/>{t(`AgentConnect.${provider}`)}</button>)}
    </div>
    {selected==="dot"&&<ChatGptQuickStart key={`${slug}:${token}`} token={token} slug={slug} canManage={canManage} />}
    {(selected==="dot"||selected==="muse")&&<details className="cloud-bridge-card"><summary>{t("AgentConnect.security")}</summary>
      <McpSecurityPanel token={token} slug={slug} canManage={canManage} />
    </details>}
    {(selected==="dot"||selected==="muse")&&<details className="studio-grants-details"><summary>{zh?"已授权连接 · 管理与撤销":"Authorized connections · manage and revoke"}</summary><ConnectorGrants slug={slug} /></details>}
    {selected==="dot"&&<details className="cloud-bridge-card studio-diagnostics">
      <summary>{zh?"首次连接教程与事件诊断":"First-time setup and event diagnostics"}</summary>
      <details><summary>{t("ConnectorUsage.firstConnection")}</summary>
        <ol className="agent-connect-steps">{[1,2,3,4].map(n=><li key={n}>{t(`AgentConnect.dotStep${n}`).replace(/^\d\. /,"")}</li>)}</ol>
      </details>
      <a href="https://developers.openai.com/plugins/build/plugins" target="_blank" rel="noopener noreferrer">{t("AgentConnect.dotDocs")}</a>
      <p>{zh?"已实现 MCP 2.0 事件订阅、签名 Webhook 和 @ 唤醒队列。服务端已加入 MCP OAuth 2.1 授权与按群 consent；还需用户在 ChatGPT 中安装插件并完成真实账号验收。":"MCP 2.0 subscriptions, signed webhooks and @-mention wake delivery are implemented. OAuth 2.1 authorization and group consent are implemented; real dot account/plugin installation remains to be accepted."}</p>
      {events&&<p>{zh?"有效订阅":"Subscriptions"}: {events.active_subscriptions} · {zh?"待投递":"Queued"}: {events.pending_deliveries}</p>}
      {canRun&&<button type="button" className="d-btn" disabled={busy||!events?.pending_deliveries} onClick={()=>void task(async()=>{
        const r=await cloudBridgesApi.flushEvents(token,slug);
        if(isActive())setNotice(zh?`已检查 ${r.attempted} 个事件，成功送达 ${r.delivered} 个`:`Checked ${r.attempted} events, acknowledged ${r.delivered}`);
        await reload();
      })}>{t("ConnectorUsage.retry")}</button>}
      {events?.pending_deliveries===0&&<p><small>{t("ConnectorUsage.noQueue")}</small></p>}
      <p><small>{zh?"实际 dot 订阅未完成前，不显示在线或已接通。":"No dot-online claim before OAuth and real subscription acceptance."}</small></p>
    </details>}
    {selected==="hermes"&&<article className="cloud-bridge-card">
      <h3>Hermes Agent</h3>
      <p>{zh?"用于向已运行的 Hermes API Server 提交任务，并同步结果回群。不会导入你原有的 CLI 私聊。":"Send tasks to your running Hermes API Server and synchronize results to this group. Existing CLI conversations are not imported."}</p>
      <ol><li>{zh?"先由管理员准备运行中的 API 服务、服务地址与凭据。没有服务时，请先完成部署；本页面不会替你安装。":"Have your administrator prepare the running API service, its address and credential. This page does not install the server."}</li><li>{zh?"在 API 连接中填写信息，验证后绑定本群。":"Enter the details in API connections to verify and bind this group."}</li><li>{zh?"绑定不代表运行。明确发送任务后，再查看进度和回群结果。":"Binding is not running. Send an explicit task, then check its progress and returned result."}</li></ol>
      {onConfigureApi&&<button type="button" className="d-btn" onClick={()=>onConfigureApi("hermes")}>{zh?"配置 Hermes API 连接":"Configure Hermes API connection"}</button>}
    </article>}
    {selected==="cue"&&<article className="cloud-bridge-card">
      <h3>Manus / Cue · <a href="https://open.manus.ai/docs/v2/agent.list" target="_blank" rel="noreferrer">API v2 ↗</a></h3>
      <p>{zh?"通过 Manus 官方 Agent API 查找你现有的 Cue Agent。API Key 仅用于这次查询，不保存在浏览器或数据库。":"Discover your existing Cue agents through the official Manus Agent API. The API key is used for this one lookup only."}</p>
      {canManage&&<form onSubmit={discover} className="cloud-bridge-form">
        <label>{zh?"Manus API Key":"Manus API key"}<input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} required disabled={busy}/></label>
        <button className="d-btn" disabled={busy||!apiKey}>{zh?"查找我的 Cue Agent":"Discover my Cue agents"}</button>
      </form>}
      {cue.length>0&&<ul>{cue.map(agent=><li key={agent.id}><strong>{agent.name}</strong> · <code>{agent.id}</code> <button className="d-btn" type="button" onClick={()=>void navigator.clipboard?.writeText(agent.id)}>{zh?"复制 ID":"Copy ID"}</button></li>)}</ul>}
      {onConfigureApi&&<button type="button" className="d-btn" onClick={()=>onConfigureApi("manus")}>{zh?"已有 Agent ID，配置 Cue 连接":"Have an agent ID? Configure Cue connection"}</button>}
      <p><small>{zh?"向已有个人 Cue 主会话投递任务已支持；不自动导入无法确定归属的私人聊天回复。":"Send to existing Cue main tasks is supported; private replies without reliable request correlation are not imported."}</small></p>
    </article>}
    {selected==="grok"&&<article className="cloud-bridge-card">
      <h3>Grok · Automation Webhook</h3>
      <p>{zh?"此方式需要你已有的 Automation HTTPS 触发地址、签名密钥，并由服务器管理员批准该地址来源。它不是个人 Grok Bot 登录；若账号没有这些能力，请勿填写猜测的地址。保存不验证任务完成，回复也不会自动回群。":"This requires an existing Automation HTTPS trigger, signing secret and server administrator approval of its origin. It is not a personal Grok Bot login. If your account lacks these capabilities, do not guess an endpoint. Saving does not verify task completion; replies are not automatically imported."}</p>
      <p>{state?.connection?zh?`配置已保存：${state.connection.name}`:`Configured: ${state.connection.name}`:zh?"尚未绑定":"Not configured"}</p>
      {canManage&&<form onSubmit={saveGrok} className="cloud-bridge-form">
        <label>{zh?"显示名称":"Name"}<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} disabled={busy} required/></label>
        <label>{zh?"Automation HTTPS 触发地址":"Automation HTTPS trigger URL"}<input type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} disabled={busy} required/></label>
        <label>{zh?"签名密钥 whsec_…":"Webhook signing secret whsec_…"}<input type="password" value={secret} onChange={e=>setSecret(e.target.value)} disabled={busy} required autoComplete="new-password"/></label>
        <button className="d-btn" disabled={busy||!endpoint||!secret}>{zh?"加密保存连接":"Save encrypted connection"}</button>
      </form>}
      {canRun&&state?.connection&&<form onSubmit={send} className="cloud-bridge-form">
        <label>{zh?"明确投递的任务":"Task to dispatch"}<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={busy} rows={3} required maxLength={12_000}/></label>
        <button className="d-btn" disabled={busy||!prompt.trim()}>{zh?"发送到 Automation":"Send to Automation"}</button>
      </form>}
      {state?.deliveries.slice(0,5).map(d=><p key={d.id}><small>{d.request_id}: {automationDeliveryLabel(d.state,zh)}</small></p>)}
      {canManage&&state?.connection&&<button type="button" className="d-btn" disabled={busy} onClick={()=>void task(async()=>{
        if(!confirm(zh?"取消此群 Grok Automation 绑定？已发送的远程任务不会自动取消。":"Disconnect Grok Automation for this group? In-flight remote work is not cancelled."))return;
        await cloudBridgesApi.disconnectGrok(token,slug);await reload();
      })}>{zh?"断开连接":"Disconnect"}</button>}
    </article>}
    {selected==="muse"&&<MuseCloudPanel key={`${slug}:${token}`} token={token} slug={slug} canManage={canManage}/>}
  </section>;
}
