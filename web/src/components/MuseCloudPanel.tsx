import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useT} from '../i18n/useT';
import {useLocale} from '../i18n/locale';
import {apiBase} from '../lib/base';
import {copyText} from '../lib/agentTokenVault';
import {cloudBridgesApi,type MuseConnectorState} from '../lib/cloudBridgesApi';
import {StudioIcon,type StudioIconName} from './StudioIcon';
import {PersonalMusePanel} from './PersonalMusePanel';
import {ProviderMark} from './ProviderMark';
import '../i18n/strings/MuseCloud';
import '../styles/muse-cloud.css';
export function MuseCloudPanel({token,slug,canManage}:{token:string;slug:string;canManage:boolean}){
 const t=useT(),{locale}=useLocale();const [state,setState]=useState<MuseConnectorState|null>(null);
 const [method,setMethod]=useState<'mcp'|'gadget'|'personal'|null>(null);
 const [revision,update]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [callback,setCallback]=useState(''),[created,setCreated]=useState<{client_id:string;client_secret:string}|null>(null);
 const epoch=useRef(0),base=apiBase();
 const scope=JSON.stringify([base,slug]),currentScope=useRef(scope);currentScope.current=scope;
 const inFlight=useRef(new Set<string>()),uncertain=useRef(new Set<string>()),revocationTarget=useRef(new Map<string,string>());
 const [blocked,setBlocked]=useState(false);
 const uncertainText=locale==='zh'?'上次变更结果待确认。请检查现有客户端，不要重复创建或撤销。':'The previous change needs confirmation. Inspect existing clients; do not repeat creation or revocation.';
 useEffect(()=>{const n=++epoch.current,abort=new AbortController();setState(null);setCreated(null);setCallback('');setNotice('');setError('');setBusy(inFlight.current.has(scope));setBlocked(uncertain.current.has(scope));
  if(canManage)void cloudBridgesApi.muse(token,slug,abort.signal).then(data=>{if(epoch.current===n&&!abort.signal.aborted&&base===apiBase()){
    setState(data);
    const target=revocationTarget.current.get(scope);
    // A disabled exact client is affirmative revocation evidence. Absence or a
    // new client ID is not proof of what happened to an ambiguous creation.
    if(!inFlight.current.has(scope)&&target&&data.clients.some(client=>client.client_id===target&&client.disabled)){
     uncertain.current.delete(scope);revocationTarget.current.delete(scope);setBlocked(false);
    }
   }})
   .catch(()=>{if(!abort.signal.aborted&&epoch.current===n)setError(t('Muse.error'));});
  return()=>{abort.abort();++epoch.current;};
 },[token,slug,canManage,revision,base,locale]);
 useEffect(()=>{setMethod(null);},[token,slug,base]);
 const copy=async(value:string)=>{const n=epoch.current;try{if(await copyText(value)&&epoch.current===n&&currentScope.current===scope&&base===apiBase())setNotice(t('Muse.copied'));}catch{/* clipboard failure is not a successful copy */}};
 const run=async(action:()=>Promise<void>,mutation=false)=>{
  if(!canManage||currentScope.current!==scope||base!==apiBase()||inFlight.current.has(scope)||(mutation&&uncertain.current.has(scope)))return;
  const n=epoch.current;inFlight.current.add(scope);setBusy(true);setError('');
  if(mutation)uncertain.current.add(scope);
  try{await action();if(epoch.current===n&&base===apiBase()&&mutation){uncertain.current.delete(scope);revocationTarget.current.delete(scope);}}
  catch{if(epoch.current===n)setError(t('Muse.error'));}
  finally{inFlight.current.delete(scope);if(currentScope.current===scope){setBusy(false);setBlocked(uncertain.current.has(scope));}}
 };
 const create=(e:FormEvent)=>{e.preventDefault();if(created||!callback.trim()||!state?.can_configure)return;void run(async()=>{
  const n=epoch.current;const result=await cloudBridgesApi.createMuseClient(token,slug,callback.trim());
  if(epoch.current!==n||base!==apiBase())return;setCreated(result);setCallback('');setNotice(t('Muse.created'));
  const latest=await cloudBridgesApi.muse(token,slug);if(epoch.current===n&&base===apiBase())setState(latest);
 },true);};
 const prompt=locale==='zh'?`使用已授权的 Agent Commons 连接。先调用 party_profile，确认群组是 ${slug}。只读取最近 5 条消息，不发帖、不修改文件、不通知其他智能体；不匹配就停止。`:
  `Use your authorized Agent Commons connector. First call party_profile and verify group ${slug}. Read only the latest 5 messages. Do not post, change files or notify agents; stop on a group mismatch.`;
 const clients=state?.clients.filter(x=>!x.disabled)??[],authorized=state?.native_authorized===true||clients.some(x=>x.active_grants>0);
 const oauthState=state?.native_oauth?.status;
 const oauthText=oauthState==='access_valid'?(locale==='zh'?'服务端凭证有效 · 客户端未核验':'Server credential valid · client unverified'):
  oauthState==='refresh_required'?(locale==='zh'?'访问凭证已过期 · 等待客户端续期':'Access expired · client refresh required'):
  oauthState==='reauthorization_required'?(locale==='zh'?'授权已过期或不可用 · 需重新授权':'Authorization expired or unusable · reauthorization required'):
  authorized?(locale==='zh'?'已保存授权 · 当前可用性未核验':'Authorization saved · current usability unverified'):
  t(clients.length?'Muse.configured':'Muse.unconfigured');
 const status=(icon:StudioIconName,label:string,text:string)=><div><StudioIcon name={icon}/><div><dt>{label}</dt><dd>{text}</dd></div></div>;
 if(!canManage)return <p className="commons-note">{t('Muse.noManage')}</p>;
 return <section className="muse-connect" aria-label={t('Muse.title')}>
  <header className="muse-connect-heading"><ProviderMark provider="muse"/><div><h3>{t('Muse.title')}</h3><p>{locale==='zh'?'先选一种接入方式。工具访问、设备唤醒和实际在线是不同状态。':'Choose one connection method. Tool access, device wake-ups and being online are different states.'}</p></div>
   <button type="button" className="d-btn d-btn--ghost" onClick={()=>update(x=>x+1)} aria-label={t('Muse.refresh')} disabled={busy}><StudioIcon name="refresh"/></button></header>
  {!state&&!error&&<p role="status">{t('Muse.loading')}</p>}{error&&<p role="alert" className="commons-error">{error}</p>}
  {blocked&&<p role="alert" className="commons-error">{uncertainText}</p>}
  {notice&&<p role="status" className="muse-notice">{notice}</p>}
  {!method&&<div className="muse-methods" aria-label={locale==='zh'?'选择 Muse 接入方式':'Choose a Muse connection method'}>
   <button type="button" className="muse-method" onClick={()=>setMethod('mcp')}><strong>{locale==='zh'?'MCP · 让 Muse 访问本群工具':'MCP · Let Muse use group tools'}</strong><span>{locale==='zh'?'用途：在 Muse 中读取本群，按授权回帖。':'Use: read this group from Muse and reply when authorized.'}</span><span>{locale==='zh'?'前提：Muse 支持自定义 MCP；你在 Muse 中添加连接器，并授权本群。':'Requires: custom MCP support in Muse; add its connector there and authorize this group.'}</span><small>{locale==='zh'?'状态：可查看接入步骤；个人 Muse 是否可用尚未核验。授权不等于实时唤醒。':'Status: setup instructions available; personal Muse connectivity unverified. Authorization does not imply real-time wake-ups.'}</small></button>
   <button type="button" className="muse-method" onClick={()=>setMethod('gadget')}><strong>{locale==='zh'?'Gadget · 经已配对设备转发群任务':'Gadget · Relay tasks through a paired device'}</strong><span>{locale==='zh'?'用途：通过设备桥接把明确 @任务送到个人 Muse。':'Use: relay explicitly mentioned tasks to your personal Muse through a device bridge.'}</span><span>{locale==='zh'?'前提：隔离 Linux / BLE 设备、运行中的桥接服务，以及 Muse App 本人配对。':'Requires: an isolated Linux / BLE device, a running bridge service and your pairing confirmation in Muse App.'}</span><small>{locale==='zh'?'状态：本群设备条件未核验；不能在此网页登录 Muse 后直接连接。没有设备时请勿选这条路。':'Status: device prerequisites unverified. This is not web sign-in to Muse. Do not choose this route without a device.'}</small></button>
   <button type="button" className="muse-method" onClick={()=>setMethod('personal')}><strong>{t('Muse.personalTitle')}</strong><span>{t('Muse.personalCard')}</span></button>
  </div>}
  {method==='personal'&&<PersonalMusePanel token={token} slug={slug} canManage={canManage}/>}
  {method&&<button className="d-btn muse-method-back" type="button" onClick={()=>setMethod(null)}>{locale==='zh'?'← 返回选择接入方式':'← Choose a different method'}</button>}
  {method==='gadget'&&<section className="muse-gadget-primary" aria-label={locale==='zh'?'Gadget 设备桥接指南':'Gadget device bridge guide'}>
   <h4>{locale==='zh'?'这不是网页授权登录':'This is not web authorization'}</h4>
   <p className="muse-safety">{locale==='zh'?'Gadget 需要真实设备和 Muse App 配对。本页不能代替设备配对，也没有“点击即连接”的网页登录入口。':'Gadget requires a real device and pairing in Muse App. This page cannot replace pairing and has no one-click web sign-in connection.'}</p>
   <dl className="muse-guide-evidence"><div><dt>{locale==='zh'?'当前可用性':'Current availability'}</dt><dd>{locale==='zh'?'设备、桥接、订阅均未在本页核验':'Device, bridge and subscription are unverified here'}</dd></div><div><dt>{locale==='zh'?'实际连接':'Actual connection'}</dt><dd>{locale==='zh'?'未验证真实投递与回帖，不显示在线':'Delivery and replies unverified; not marked online'}</dd></div></dl>
   <ol className="muse-simple-steps"><li><strong>{locale==='zh'?'先确认有桥接设备':'First confirm a bridge device exists'}</strong><p>{locale==='zh'?'让管理员提供隔离宿主和本群桥接服务。仅部署这个网站不等于准备好了设备。没有设备，先停在这里。':'An administrator must provide an isolated host and this group’s bridge service. Deploying this website alone does not provide a device. Stop here if none is available.'}</p></li><li><strong>{locale==='zh'?'在 Muse App 完成本人配对':'Pair it yourself in Muse App'}</strong><p>{locale==='zh'?'设备准备好后，在 Muse App 的“设置 → 设备 → Developer mode / 添加设备”确认它。凭据留在设备，不粘贴到群聊。':'Once the device is ready, confirm it in Muse App: Settings → Devices → Developer mode / Add Device. Keep credentials on the device, not in group chat.'}</p></li><li><strong>{locale==='zh'?'由管理员绑定当前群和事件订阅':'Have the administrator bind this group and its subscription'}</strong><p>{locale==='zh'?'只授权当前群的专用 Agent，明确允许哪些消息触发。配置保存不是 Muse 已连接，也不会自动替你配对。':'Authorize only the dedicated agent for this group and explicitly select eligible messages. Saved configuration is not proof of a Muse connection and does not pair for you.'}</p></li><li><strong>{locale==='zh'?'最后核验真实投递和回帖':'Finally verify actual delivery and replies'}</strong><p>{locale==='zh'?'由你发起获准的实际任务，核对 Muse 收到、回复回到同群且没有重复。只看到进程运行或投递退出码不能算接通。':'Initiate an authorized real task yourself and verify Muse receives it and replies once in the same group. A running process or a delivery exit code is not enough.'}</p></li></ol>
   <details className="muse-technical"><summary>{locale==='zh'?'管理员 / 开发者资料（不是连接按钮）':'Administrator / developer references (not a connect button)'}</summary><p>{t('Muse.gadgetWarning')}</p><a target="_blank" rel="noopener noreferrer" href="https://github.com/facebookincubator/muse-gadget-sdk/tree/main/linux">{locale==='zh'?'官方设备安装与配对说明':'Official device setup and pairing documentation'}</a><br/><a target="_blank" rel="noopener noreferrer" href="https://github.com/zmnsQ/AgentParty/blob/codex/web-design-system/bridges/muse-cloud/README.md">{t('Muse.bridgeDocs')}</a></details>
  </section>}
  {method==='mcp'&&state&&<section className="muse-legacy" aria-label={locale==='zh'?'MCP 工具访问指南':'MCP tool access guide'}><h4>{locale==='zh'?'在 Muse 中添加本群工具':'Add this group’s tools inside Muse'}</h4><p>{locale==='zh'?'方向是 Muse 访问 Agent Commons，不是本网站登录并控制你的个人 Muse。实时消息订阅取决于 Muse 客户端实际支持，不能据此保证即时唤醒。':'The direction is Muse accessing Agent Commons, not this website signing in to control your personal Muse. Real-time subscriptions depend on the Muse client’s actual support; immediate wake-ups are not guaranteed.'}</p>
   <dl className="muse-state-grid">
    {status(authorized?'check':'link',t('Muse.oauth'),oauthText)}

   </dl>
   {state.native_oauth&&<small>{locale==='zh'?'服务端状态快照，请刷新复查：':'Server status snapshot; refresh to recheck: '}{new Date(state.native_oauth.checked_at).toLocaleString()}</small>}
   <p className="commons-note">{locale==="zh"?"从 Muse 发起自定义连接器授权，核对当前群组和权限；下方地址只定位本群，不是访问凭据。":"Start custom-connector authorization from Muse and review this group and its permissions. This endpoint identifies the group; it is not an access credential."}</p><div className="muse-endpoint"><label>{t('Muse.endpoint')}<input readOnly value={state.mcp_endpoint} onFocus={e=>e.currentTarget.select()}/></label><button className="d-btn" onClick={()=>void copy(state.mcp_endpoint)}><StudioIcon name="copy"/>{t('Muse.copy')}</button></div>
   <ol className="muse-native-steps"><li>{locale==="zh"?"让 Muse 创建或配置自定义连接器，并提供上方本群 MCP 地址；以你的客户端实际支持为准。":"Ask Muse to create or configure a custom connector with this group MCP endpoint; follow what your client actually supports."}</li><li>{locale==="zh"?"从 Muse 打开登录授权页，核对群组与权限后点击允许，再返回 Muse。无需手工复制授权网址。":"Open sign-in and consent from Muse, review the group and permissions, approve, then return to Muse. No hand-copied authorization link is needed."}</li></ol>
   <details className="muse-native-client"><summary>{locale==="zh"?"Muse 要求填写 Client ID？":"Does Muse ask for a Client ID?"}</summary><p>{locale==="zh"?"为这个群组准备原生公共客户端。Client ID 不是访问密钥；创建后仍须在 Muse 中完成登录、二步验证和授权。":"Prepare a native public client for this group. A Client ID is not an access key; sign-in, MFA and consent are still required in Muse."}</p>
   {!state.can_configure?<p>{t('Muse.mfa')} <a href="/auth/security">{t('Muse.security')}</a></p>:state.native_client_id?<div className="muse-endpoint"><label>Client ID<input readOnly value={state.native_client_id} onFocus={e=>e.currentTarget.select()}/></label><button className="d-btn" onClick={()=>void copy(state.native_client_id!)}>{t('Muse.copy')}</button></div>:<button type="button" className="d-btn" disabled={busy} onClick={()=>void run(async()=>{await cloudBridgesApi.createMuseNativeClient(token,slug);update(x=>x+1);})}>{locale==="zh"?"准备 Muse Client ID":"Prepare Muse Client ID"}</button>}
   </details>
   <details className="muse-recovery"><summary>{locale==='zh'?'凭证过期 / Muse 显示「已添加凭证」？':'Credential expired / Muse says “already added”?'}</summary><p>{locale==='zh'?'这里仅显示服务端授权状态，不代表 Muse 安全凭证库已更新或实时连接正常。访问凭证需由客户端使用续期凭证刷新；不要把短期访问凭证复制进定时任务。':'This is server-side authorization state, not proof that Muse updated its credential vault or that real-time delivery works. The client must refresh access credentials; do not copy a short-lived access token into scheduled tasks.'}</p><p>{locale==='zh'?'若 Muse 的授权卡无法再次打开，请保留原连接，并通过 Muse 官方支持处理凭证库恢复。不要创建新 Client ID、修改地址或删除授权来绕过。管理员可检查脱敏 OAuth 续期诊断；本页面不能修复 Muse App 的授权卡。':'If Muse will not reopen its authorization card, keep the existing connection and contact official Muse support for vault recovery. Do not bypass it with new Client IDs, changed URLs or deleted grants. An administrator can inspect sanitized OAuth refresh diagnostics; this page cannot repair the Muse app’s authorization card.'}</p></details>
   <details className="muse-native-check"><summary>{locale==="zh"?"连接后验证（只读）":"Verify the connection (read-only)"}</summary><textarea readOnly value={prompt} rows={4} aria-label={t('Muse.testPrompt')}/><button className="d-btn" onClick={()=>void copy(prompt)}>{t('Muse.copy')}</button></details>
   <details className="muse-technical"><summary>{locale==="zh"?"高级：OAuth 客户端注册与调试":"Advanced OAuth client registration"}</summary><ol className="muse-steps">
    <li><span className="muse-step-index">1</span><div><h4>{t('Muse.step1')}</h4><p>{t('Muse.step1Help')}</p>
     {!state.can_configure?<p className="commons-note">{t('Muse.mfa')} <a href="/auth/security">{t('Muse.security')}</a></p>:
      <form onSubmit={create} className="muse-oauth-form"><label>{t('Muse.callback')}<input type="url" autoComplete="off" value={callback} onChange={e=>setCallback(e.target.value)} required maxLength={1400}/></label>
      <button className="d-btn d-btn--primary" disabled={busy||blocked||!!created||!callback.trim()}><StudioIcon name="key"/>{t('Muse.create')}</button></form>}
     {created&&<div className="muse-secret-once"><strong>{t('Muse.secret')}</strong><p>{t('Muse.secretHint')}</p>
       <label>{t('Muse.client')}<input readOnly value={created.client_id}/></label>
       <label>{t('Muse.secret')}<input type="password" readOnly value={created.client_secret} autoComplete="new-password"/></label>
       <div className="muse-inline-actions"><button className="d-btn" onClick={()=>void copy(created.client_secret)}><StudioIcon name="copy"/>{t('Muse.copy')}</button><button className="d-btn" onClick={()=>setCreated(null)}><StudioIcon name="check"/>{t('Muse.saved')}</button></div>
     </div>}
     <details className="muse-technical"><summary>{t('Muse.authDetails')}</summary><dl>{Object.entries(state.configuration).filter(([,v])=>typeof v==='string').map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></details>
     {clients.map(client=><div className="muse-client-row" key={client.client_id}><div><strong>{client.name}</strong><code>{client.client_id}</code></div><button className="d-btn d-btn--ghost" disabled={busy||blocked} onClick={()=>{
       if(!confirm(t('Muse.revokeConfirm')))return;void run(async()=>{revocationTarget.current.set(scope,client.client_id);const n=epoch.current;await cloudBridgesApi.revokeMuseClient(token,slug,client.client_id);if(epoch.current!==n||base!==apiBase())return;setCreated(null);update(x=>x+1);},true);
     }}><StudioIcon name="unlink"/>{t('Muse.revoke')}</button></div>)}
    </div></li>
    <li><span className="muse-step-index">2</span><div><h4>{t('Muse.step2')}</h4><p>{t('Muse.step2Help')}</p><textarea readOnly value={prompt} rows={3} aria-label={t('Muse.testPrompt')}/><button className="d-btn" onClick={()=>void copy(prompt)}><StudioIcon name="copy"/>{t('Muse.copy')}</button></div></li>
    <li><span className="muse-step-index">3</span><div><h4>{t('Muse.step4')}</h4><p>{t('Muse.step4Help')}</p><div className="muse-inline-actions"><button className="d-btn" disabled={busy} onClick={()=>void run(async()=>{
      const n=epoch.current;const data=await cloudBridgesApi.museReview(token,slug);if(epoch.current!==n||base!==apiBase())return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='agent-commons-muse-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    })}><StudioIcon name="download"/>{t('Muse.download')}</button><a className="d-btn" href="https://platform.muse.ai/login?return_to=%2Fsubmission" target="_blank" rel="noopener noreferrer"><StudioIcon name="external"/>{t('Muse.portal')}</a></div><small>{t('Muse.noFakeApproval')}</small></div></li>
   </ol></details>
   <details className="muse-technical"><summary>{t('Muse.codeSeparate')}</summary><p>{t('Muse.codeHint')}</p><a href="https://github.com/meta-models/muse-code-sdk" target="_blank" rel="noopener noreferrer">Muse Code SDK <StudioIcon name="external" size={14}/></a></details>
  </section>}
 </section>;
}
