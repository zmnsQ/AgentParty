import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../i18n/locale";
import { apiBase } from "../lib/base";
import { cloudBridgesApi, type CueAgent, type EventBridgeState, type GrokBridgeState } from "../lib/cloudBridgesApi";
import { ConnectorGrants } from "./ConnectorGrants";
import { ChatGptQuickStart } from "./ChatGptQuickStart";
import "../i18n/strings/ConnectorUsage";
import {McpSecurityPanel} from "./McpSecurityPanel";
import {useT} from "../i18n/useT";
import type {CloudAgentChoice} from "./AgentConnectionPicker";
import "../i18n/strings/AgentConnect";
import "../styles/cloud-bridges.css";

interface Props { token:string;slug:string;canManage:boolean;canRun:boolean;initialProvider?:CloudAgentChoice; }
export function CloudBridges({token,slug,canManage,canRun,initialProvider}:Props){
  const t=useT();
  const [selected,setSelected]=useState<CloudAgentChoice>(initialProvider??"dot");
  const {locale}=useLocale();const zh=locale==="zh";
  const [state,setState]=useState<GrokBridgeState|null>(null);
  const [events,setEvents]=useState<EventBridgeState|null>(null);
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
    const [grok,eventState]=await Promise.all([
      cloudBridgesApi.grok(token,slug,signal),
      canManage ? cloudBridgesApi.events(token,slug,signal) : Promise.resolve(null),
    ]);
    if(isActive()&&!signal?.aborted){setState(grok);setEvents(eventState);}
  },[token,slug,canManage,isActive]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();
    void reload(controller.signal).catch(e=>{if(isActive())setError(String(e));});
    return()=>{alive.current=false;controller.abort();};
  },[reload,isActive]);
  const task=async(fn:()=>Promise<void>)=>{
    if(busy||!isActive())return;
    setBusy(true);setError("");setNotice("");
    try{await fn();}catch(e){if(isActive())setError(e instanceof Error?e.message:"Request failed");}
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
      setNotice(zh?`投递状态：${r.delivery.state}（不代表 Bot 已完成）`:`Delivery: ${r.delivery.state} (not proof of Bot completion)`);
      setPrompt("");setPendingId(null);
    }
    await reload();
  });};
  return <section className="cloud-bridges" aria-label={zh?"云端 Agent 官方接入":"Official cloud agent integrations"}>
    <h2>{zh?"官方 Agent 接入":"Official Agent integrations"}</h2>
    <p><a href="https://github.com/zmnsQ/AgentParty/blob/feat/agent-commons-provider-bridges-20261021/docs/agent-commons-onboarding.zh.md" target="_blank" rel="noopener noreferrer">{zh?"查看分平台接入与测试教程 ↗":"Per-platform connection and testing guide (Chinese) ↗"}</a></p>
    {error&&<p role="alert" className="commons-error">{error}</p>}
    {notice&&<p role="status" className="commons-success">{notice}</p>}
    <p className="commons-note">{t("AgentConnect.testWarning")}</p>
    <div className="agent-connect-tabs" aria-label={t("AgentConnect.cloud")}>
      {(["dot","muse","cue","grok"] as const).map(provider=><button className="d-btn" type="button" key={provider}
        aria-pressed={selected===provider} onClick={()=>setSelected(provider)}>{t(`AgentConnect.${provider}`)}</button>)}
    </div>
    {selected==="dot"&&<ChatGptQuickStart key={`${slug}:${token}`} token={token} slug={slug} canManage={canManage} />}
    <details className="cloud-bridge-card"><summary>{t("AgentConnect.security")}</summary>
      <McpSecurityPanel token={token} slug={slug} canManage={canManage} />
    </details>
    <ConnectorGrants slug={slug} />
    {selected==="dot"&&<article className="cloud-bridge-card">
      <h3>ChatGPT dot · MCP Events</h3>
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
    </article>}
    {selected==="cue"&&<article className="cloud-bridge-card">
      <h3>Manus / Cue · <a href="https://open.manus.ai/docs/v2/agent.list" target="_blank" rel="noreferrer">API v2 ↗</a></h3>
      <p>{zh?"通过 Manus 官方 Agent API 查找你现有的 Cue Agent。API Key 仅用于这次查询，不保存在浏览器或数据库。":"Discover your existing Cue agents through the official Manus Agent API. The API key is used for this one lookup only."}</p>
      {canManage&&<form onSubmit={discover} className="cloud-bridge-form">
        <label>{zh?"Manus API Key":"Manus API key"}<input type="password" autoComplete="new-password" value={apiKey} onChange={e=>setApiKey(e.target.value)} required disabled={busy}/></label>
        <button className="d-btn" disabled={busy||!apiKey}>{zh?"查找我的 Cue Agent":"Discover my Cue agents"}</button>
      </form>}
      {cue.length>0&&<ul>{cue.map(agent=><li key={agent.id}><strong>{agent.name}</strong> · <code>{agent.id}</code> <button className="d-btn" type="button" onClick={()=>void navigator.clipboard?.writeText(agent.id)}>{zh?"复制 ID":"Copy ID"}</button></li>)}</ul>}
      <p><small>{zh?"向已有个人 Cue 主会话投递任务已支持；不自动导入无法确定归属的私人聊天回复。":"Send to existing Cue main tasks is supported; private replies without reliable request correlation are not imported."}</small></p>
    </article>}
    {selected==="grok"&&<article className="cloud-bridge-card">
      <h3>Grok · Official Automations Webhook</h3>
      <p>{zh?"这是官方 Automation Webhook，不是个人 Grok Bot 的直接 SDK。Webhook 返回成功仅代表接收任务。":"This is an official Automation webhook, not a direct personal Grok Bot SDK. An accepted webhook does not prove task completion."}</p>
      <p>{state?.connection?zh?`已绑定：${state.connection.name}`:`Configured: ${state.connection.name}`:zh?"尚未绑定":"Not configured"}</p>
      {canManage&&<form onSubmit={saveGrok} className="cloud-bridge-form">
        <label>{zh?"显示名称":"Name"}<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} disabled={busy} required/></label>
        <label>{zh?"官方 HTTPS Webhook 地址":"Official HTTPS webhook URL"}<input type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} disabled={busy} required/></label>
        <label>{zh?"签名密钥 whsec_…":"Webhook signing secret whsec_…"}<input type="password" value={secret} onChange={e=>setSecret(e.target.value)} disabled={busy} required autoComplete="new-password"/></label>
        <button className="d-btn" disabled={busy||!endpoint||!secret}>{zh?"加密保存连接":"Save encrypted connection"}</button>
      </form>}
      {canRun&&state?.connection&&<form onSubmit={send} className="cloud-bridge-form">
        <label>{zh?"明确投递的任务":"Task to dispatch"}<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={busy} rows={3} required maxLength={12_000}/></label>
        <button className="d-btn" disabled={busy||!prompt.trim()}>{zh?"发送到 Automation":"Send to Automation"}</button>
      </form>}
      {state?.deliveries.slice(0,5).map(d=><p key={d.id}><small>{d.request_id}: {d.state}</small></p>)}
      {canManage&&state?.connection&&<button type="button" className="d-btn" disabled={busy} onClick={()=>void task(async()=>{
        if(!confirm(zh?"取消此群 Grok Automation 绑定？已发送的远程任务不会自动取消。":"Disconnect Grok Automation for this group? In-flight remote work is not cancelled."))return;
        await cloudBridgesApi.disconnectGrok(token,slug);await reload();
      })}>{zh?"断开连接":"Disconnect"}</button>}
    </article>}
    {selected==="muse"&&<article className="cloud-bridge-card">
      <h3>Meta Muse · Cloud Connector / Muse Code SDK</h3>
      <p>{zh?"云端 Muse 使用官方 Connector Platform 接入群工具；Muse Code 则可使用已集成的 @muse-code/sdk 本地运行器。两者不是同一个会话。":"Cloud Muse uses the official Connector Platform for group tools. Muse Code uses the included @muse-code/sdk runner on a machine with the Muse host installed. They are separate session types."}</p>
      <p><a href="https://platform.muse.ai/docs" target="_blank" rel="noreferrer">Muse Connector Platform ↗</a> · <a href="https://github.com/meta-models/muse-code-sdk" target="_blank" rel="noreferrer">Muse Code SDK ↗</a></p>
      <p><small>{zh?"Muse Cloud 的个人会话自动唤醒、平台审核及 OAuth 接入未完成；Muse Code 需要本机 muse 可执行程序。":"Muse Cloud automatic wake, approval and OAuth setup are unverified. Muse Code requires an installed local muse binary."}</small></p>
    </article>}
  </section>;
}
