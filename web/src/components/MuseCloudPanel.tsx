import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useT} from '../i18n/useT';
import {useLocale} from '../i18n/locale';
import {apiBase} from '../lib/base';
import {copyText} from '../lib/agentTokenVault';
import {cloudBridgesApi,type MuseConnectorState} from '../lib/cloudBridgesApi';
import {StudioIcon,type StudioIconName} from './StudioIcon';
import {ProviderMark} from './ProviderMark';
import '../i18n/strings/MuseCloud';
import '../styles/muse-cloud.css';
export function MuseCloudPanel({token,slug,canManage}:{token:string;slug:string;canManage:boolean}){
 const t=useT(),{locale}=useLocale();const [state,setState]=useState<MuseConnectorState|null>(null);
 const [revision,update]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [callback,setCallback]=useState(''),[created,setCreated]=useState<{client_id:string;client_secret:string}|null>(null);
 const epoch=useRef(0),base=apiBase();
 useEffect(()=>{const n=++epoch.current,abort=new AbortController();setState(null);setCreated(null);setError('');
  if(canManage)void cloudBridgesApi.muse(token,slug,abort.signal).then(data=>{if(epoch.current===n&&!abort.signal.aborted&&base===apiBase())setState(data);})
   .catch(()=>{if(!abort.signal.aborted&&epoch.current===n)setError(t('Muse.error'));});
  return()=>{abort.abort();++epoch.current;};
 },[token,slug,canManage,revision,base,locale]);
 const copy=async(value:string)=>{if(await copyText(value))setNotice(t('Muse.copied'));};
 const run=async(action:()=>Promise<void>)=>{if(busy)return;const n=epoch.current;setBusy(true);setError('');
  try{await action();}catch{if(epoch.current===n)setError(t('Muse.error'));}finally{if(epoch.current===n)setBusy(false);}};
 const create=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const n=epoch.current;const result=await cloudBridgesApi.createMuseClient(token,slug,callback.trim());
  if(epoch.current!==n||base!==apiBase())return;setCreated(result);setCallback('');setNotice(t('Muse.created'));
  const latest=await cloudBridgesApi.muse(token,slug);if(epoch.current===n)setState(latest);
 });};
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
  <header className="muse-connect-heading"><ProviderMark provider="muse"/><div><h3>{t('Muse.title')}</h3><p>{t('Muse.intro')}</p></div>
   <button type="button" className="d-btn d-btn--ghost" onClick={()=>update(x=>x+1)} aria-label={t('Muse.refresh')} disabled={busy}><StudioIcon name="refresh"/></button></header>
  {!state&&!error&&<p role="status">{t('Muse.loading')}</p>}{error&&<p role="alert" className="commons-error">{error}</p>}
  {notice&&<p role="status" className="muse-notice">{notice}</p>}
  <section className="muse-gadget-primary" aria-label={t('Muse.gadgetTitle')}>
   <h4>{t('Muse.gadgetTitle')}</h4><p>{t('Muse.gadgetIntro')}</p>
   <p className="commons-note" role="status">{t('Muse.gadgetUnverified')}</p>
   <ol className="muse-steps muse-gadget-steps">
    <li><span className="muse-step-index">1</span><div><h4>{t('Muse.gadgetPair')}</h4><p>{t('Muse.gadgetPairHelp')}</p>
     <a className="d-btn" target="_blank" rel="noopener noreferrer" href="https://github.com/facebookincubator/muse-gadget-sdk"><StudioIcon name="external"/>{t('Muse.gadgetOfficial')}</a></div></li>
    <li><span className="muse-step-index">2</span><div><h4>{t('Muse.gadgetBridge')}</h4><p>{t('Muse.gadgetBridgeHelp')}</p></div></li>
    <li><span className="muse-step-index">3</span><div><h4>{t('Muse.gadgetSubscribe')}</h4><p>{t('Muse.gadgetSubscribeHelp')}</p></div></li>
    <li><span className="muse-step-index">4</span><div><h4>{t('Muse.gadgetVerify')}</h4><p>{t('Muse.gadgetVerifyHelp')}</p></div></li>
   </ol>
   <p className="muse-safety"><StudioIcon name="shield"/>{t('Muse.gadgetWarning')}</p>
   <a className="d-btn" target="_blank" rel="noopener noreferrer" href="https://github.com/zmnsQ/AgentParty/blob/feat/muse-gadget-20261026/bridges/muse-cloud/README.md"><StudioIcon name="external"/>{t('Muse.bridgeDocs')}</a>
  </section>
  {state&&<details className="muse-legacy"><summary>{t('Muse.legacy')}</summary><p>{t('Muse.legacyHelp')}</p>
   <dl className="muse-state-grid">
    {status(authorized?'check':'link',t('Muse.oauth'),oauthText)}
    {status('bell-on',t('Muse.wake'),t('Muse.pairRequired'))}{status('shield',t('Muse.review'),t('Muse.reviewUnknown'))}
   </dl>
   {state.native_oauth&&<small>{locale==='zh'?'服务端状态快照，请刷新复查：':'Server status snapshot; refresh to recheck: '}{new Date(state.native_oauth.checked_at).toLocaleString()}</small>}
   <p className="commons-note">{locale==="zh"?"可选：仅在需要原生 MCP 工具连接时，在 Muse 中添加下方地址并完成授权。Gadget 桥接不依赖此路径。":"Optional: add this endpoint in Muse only if you need its native MCP tool connection. The Gadget bridge does not depend on this path."}</p><div className="muse-endpoint"><label>{t('Muse.endpoint')}<input readOnly value={state.mcp_endpoint} onFocus={e=>e.currentTarget.select()}/></label><button className="d-btn" onClick={()=>void copy(state.mcp_endpoint)}><StudioIcon name="copy"/>{t('Muse.copy')}</button></div>
   <ol className="muse-native-steps"><li>{locale==="zh"?"在 Muse 的自定义连接器中添加上方 MCP 地址。":"Add the MCP endpoint above in Muse’s custom connector settings."}</li><li>{locale==="zh"?"从 Muse 打开登录授权页，核对群组与权限后点击允许，再返回 Muse。无需手工复制授权网址。":"Open sign-in and consent from Muse, review the group and permissions, approve, then return to Muse. No hand-copied authorization link is needed."}</li></ol>
   <details className="muse-native-client"><summary>{locale==="zh"?"Muse 要求填写 Client ID？":"Does Muse ask for a Client ID?"}</summary><p>{locale==="zh"?"为这个群组准备原生公共客户端。Client ID 不是访问密钥；创建后仍须在 Muse 中完成登录、二步验证和授权。":"Prepare a native public client for this group. A Client ID is not an access key; sign-in, MFA and consent are still required in Muse."}</p>
   {!state.can_configure?<p>{t('Muse.mfa')} <a href="/auth/security">{t('Muse.security')}</a></p>:state.native_client_id?<div className="muse-endpoint"><label>Client ID<input readOnly value={state.native_client_id} onFocus={e=>e.currentTarget.select()}/></label><button className="d-btn" onClick={()=>void copy(state.native_client_id!)}>{t('Muse.copy')}</button></div>:<button type="button" className="d-btn" disabled={busy} onClick={()=>void run(async()=>{await cloudBridgesApi.createMuseNativeClient(token,slug);update(x=>x+1);})}>{locale==="zh"?"准备 Muse Client ID":"Prepare Muse Client ID"}</button>}
   </details>
   <details className="muse-recovery"><summary>{locale==='zh'?'凭证过期 / Muse 显示「已添加凭证」？':'Credential expired / Muse says “already added”?'}</summary><p>{locale==='zh'?'这里仅显示服务端授权状态，不代表 Muse 安全凭证库已更新或实时连接正常。访问凭证需由客户端使用续期凭证刷新；不要把短期访问凭证复制进定时任务。':'This is server-side authorization state, not proof that Muse updated its credential vault or that real-time delivery works. The client must refresh access credentials; do not copy a short-lived access token into scheduled tasks.'}</p><p>{locale==='zh'?'若 Muse 的授权卡无法再次打开，请保留原连接，并通过 Muse 官方支持处理凭证库恢复。不要创建新 Client ID、修改地址或删除授权来绕过。管理员可检查脱敏 OAuth 续期诊断；本页面不能修复 Muse App 的授权卡。':'If Muse will not reopen its authorization card, keep the existing connection and contact official Muse support for vault recovery. Do not bypass it with new Client IDs, changed URLs or deleted grants. An administrator can inspect sanitized OAuth refresh diagnostics; this page cannot repair the Muse app’s authorization card.'}</p></details>
   <details className="muse-native-check"><summary>{locale==="zh"?"连接后验证（只读）":"Verify the connection (read-only)"}</summary><textarea readOnly value={prompt} rows={4} aria-label={t('Muse.testPrompt')}/><button className="d-btn" onClick={()=>void copy(prompt)}>{t('Muse.copy')}</button></details>
   <details className="muse-technical"><summary>{locale==="zh"?"高级：OAuth 客户端注册与调试":"Advanced OAuth client registration"}</summary><ol className="muse-steps">
    <li><span className="muse-step-index">1</span><div><h4>{t('Muse.step1')}</h4><p>{t('Muse.step1Help')}</p>
     {!state.can_configure?<p className="commons-note">{t('Muse.mfa')} <a href="/auth/security">{t('Muse.security')}</a></p>:
      <form onSubmit={create} className="muse-oauth-form"><label>{t('Muse.callback')}<input type="url" autoComplete="off" value={callback} onChange={e=>setCallback(e.target.value)} required maxLength={1400}/></label>
      <button className="d-btn d-btn--primary" disabled={busy||!!created||!callback.trim()}><StudioIcon name="key"/>{t('Muse.create')}</button></form>}
     {created&&<div className="muse-secret-once"><strong>{t('Muse.secret')}</strong><p>{t('Muse.secretHint')}</p>
       <label>{t('Muse.client')}<input readOnly value={created.client_id}/></label>
       <label>{t('Muse.secret')}<input type="password" readOnly value={created.client_secret} autoComplete="new-password"/></label>
       <div className="muse-inline-actions"><button className="d-btn" onClick={()=>void copy(created.client_secret)}><StudioIcon name="copy"/>{t('Muse.copy')}</button><button className="d-btn" onClick={()=>setCreated(null)}><StudioIcon name="check"/>{t('Muse.saved')}</button></div>
     </div>}
     <details className="muse-technical"><summary>{t('Muse.authDetails')}</summary><dl>{Object.entries(state.configuration).filter(([,v])=>typeof v==='string').map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></details>
     {clients.map(client=><div className="muse-client-row" key={client.client_id}><div><strong>{client.name}</strong><code>{client.client_id}</code></div><button className="d-btn d-btn--ghost" disabled={busy} onClick={()=>{
       if(!confirm(t('Muse.revokeConfirm')))return;void run(async()=>{await cloudBridgesApi.revokeMuseClient(token,slug,client.client_id);setCreated(null);update(x=>x+1);});
     }}><StudioIcon name="unlink"/>{t('Muse.revoke')}</button></div>)}
    </div></li>
    <li><span className="muse-step-index">2</span><div><h4>{t('Muse.step2')}</h4><p>{t('Muse.step2Help')}</p><textarea readOnly value={prompt} rows={3} aria-label={t('Muse.testPrompt')}/><button className="d-btn" onClick={()=>void copy(prompt)}><StudioIcon name="copy"/>{t('Muse.copy')}</button></div></li>
    <li><span className="muse-step-index">3</span><div><h4>{t('Muse.step3')}</h4><p>{t('Muse.step3Help')}</p><p className="muse-safety"><StudioIcon name="shield"/>{t('Muse.gadgetWarning')}</p>
      <a className="d-btn" target="_blank" rel="noopener noreferrer" href="https://github.com/zmnsQ/AgentParty/blob/feat/muse-gadget-20261026/bridges/muse-cloud/README.md"><StudioIcon name="external"/>{t('Muse.bridgeDocs')}</a>
    </div></li>
    <li><span className="muse-step-index">4</span><div><h4>{t('Muse.step4')}</h4><p>{t('Muse.step4Help')}</p><div className="muse-inline-actions"><button className="d-btn" disabled={busy} onClick={()=>void run(async()=>{
      const data=await cloudBridgesApi.museReview(token,slug);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='agent-commons-muse-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    })}><StudioIcon name="download"/>{t('Muse.download')}</button><a className="d-btn" href="https://platform.muse.ai/login?return_to=%2Fsubmission" target="_blank" rel="noopener noreferrer"><StudioIcon name="external"/>{t('Muse.portal')}</a></div><small>{t('Muse.noFakeApproval')}</small></div></li>
   </ol></details>
   <details className="muse-technical"><summary>{t('Muse.codeSeparate')}</summary><p>{t('Muse.codeHint')}</p><a href="https://github.com/meta-models/muse-code-sdk" target="_blank" rel="noopener noreferrer">Muse Code SDK <StudioIcon name="external" size={14}/></a></details>
  </details>}
 </section>;
}
