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
 const clients=state?.clients.filter(x=>!x.disabled)??[],authorized=clients.some(x=>x.active_grants>0);
 const status=(icon:StudioIconName,label:string,text:string)=><div><StudioIcon name={icon}/><div><dt>{label}</dt><dd>{text}</dd></div></div>;
 if(!canManage)return <p className="commons-note">{t('Muse.noManage')}</p>;
 return <section className="muse-connect" aria-label={t('Muse.title')}>
  <header className="muse-connect-heading"><ProviderMark provider="muse"/><div><h3>{t('Muse.title')}</h3><p>{t('Muse.intro')}</p></div>
   <button type="button" className="d-btn d-btn--ghost" onClick={()=>update(x=>x+1)} aria-label={t('Muse.refresh')} disabled={busy}><StudioIcon name="refresh"/></button></header>
  {!state&&!error&&<p role="status">{t('Muse.loading')}</p>}{error&&<p role="alert" className="commons-error">{error}</p>}
  {notice&&<p role="status" className="muse-notice">{notice}</p>}
  {state&&<>
   <dl className="muse-state-grid">
    {status(authorized?'check':'link',t('Muse.oauth'),t(authorized?'Muse.ready':clients.length?'Muse.configured':'Muse.unconfigured'))}
    {status('bell-on',t('Muse.wake'),t('Muse.pairRequired'))}{status('shield',t('Muse.review'),t('Muse.reviewUnknown'))}
   </dl>
   <p className="commons-note">{locale==="zh"?"推荐：在 Muse 中直接添加下方 MCP 服务地址，并在 Muse 内完成连接授权。独立 OAuth 客户端注册属于高级选项。":"Recommended: add the MCP endpoint below directly in Muse and authorize there. OAuth client registration is optional."}</p><div className="muse-endpoint"><label>{t('Muse.endpoint')}<input readOnly value={state.mcp_endpoint} onFocus={e=>e.currentTarget.select()}/></label><button className="d-btn" onClick={()=>void copy(state.mcp_endpoint)}><StudioIcon name="copy"/>{t('Muse.copy')}</button></div>
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
      <a className="d-btn" target="_blank" rel="noopener noreferrer" href="https://github.com/zmnsQ/AgentParty/blob/feat/agent-commons-provider-bridges-20261021/bridges/muse-cloud/README.md"><StudioIcon name="external"/>{t('Muse.bridgeDocs')}</a>
    </div></li>
    <li><span className="muse-step-index">4</span><div><h4>{t('Muse.step4')}</h4><p>{t('Muse.step4Help')}</p><div className="muse-inline-actions"><button className="d-btn" disabled={busy} onClick={()=>void run(async()=>{
      const data=await cloudBridgesApi.museReview(token,slug);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='agent-commons-muse-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    })}><StudioIcon name="download"/>{t('Muse.download')}</button><a className="d-btn" href="https://platform.muse.ai/login?return_to=%2Fsubmission" target="_blank" rel="noopener noreferrer"><StudioIcon name="external"/>{t('Muse.portal')}</a></div><small>{t('Muse.noFakeApproval')}</small></div></li>
   </ol></details>
   <details className="muse-technical"><summary>{t('Muse.codeSeparate')}</summary><p>{t('Muse.codeHint')}</p><a href="https://github.com/meta-models/muse-code-sdk" target="_blank" rel="noopener noreferrer">Muse Code SDK <StudioIcon name="external" size={14}/></a></details>
  </>}
 </section>;
}
