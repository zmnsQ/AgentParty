import {useEffect,useRef,useState,type FormEvent} from 'react';
import {apiBase} from '../lib/base';
import {useT} from '../i18n/useT';
import '../i18n/strings/MuseCloud';
const states=['unconfigured','auth_required','ready_readonly','active','polling','reconnect_required','submission_unknown','disconnected'] as const;
type GatewayState=typeof states[number];
type Snapshot={state:GatewayState;lastChecked:number|null;configured:boolean;labels:{account:string;sidechat:string}|null};
export function PersonalMusePanel({token,slug,canManage}:{token:string;slug:string;canManage:boolean}){
 const t=useT(),base=apiBase();
 const [account,setAccount]=useState(''),[sidechat,setSidechat]=useState(''),[sidechatId,setSidechatId]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[feedback,setFeedback]=useState(''),[uncertain,setUncertain]=useState(false);
 const scope=useRef(0),inFlight=useRef(false);
 useEffect(()=>{++scope.current;setAccount('');setSidechat('');setSidechatId('');setConfirm(false);setFeedback('');setUncertain(false);setBusy(false);inFlight.current=false;return()=>{++scope.current;};},[token,slug,base,canManage]);
 const [revision,refresh]=useState(0),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[status,setStatus]=useState('loading');
 useEffect(()=>{
  const abort=new AbortController();setSnapshot(null);setStatus('loading');
  if(!canManage)return()=>abort.abort();
  void (async()=>{
   try{
    const response=await fetch(`${base}/api/channels/${encodeURIComponent(slug)}/bridges/muse-personal`,{method:'GET',headers:{Authorization:`Bearer ${token}`},signal:abort.signal,cache:'no-store'});
    if(abort.signal.aborted||base!==apiBase())return;
    if(response.status===404){setStatus('disabled');return;}
    if(response.status===401||response.status===403){setStatus('forbidden');return;}
    if(!response.ok)throw Error('status_unavailable');
    const data:unknown=await response.json();
    if(abort.signal.aborted||base!==apiBase())return;
    if(!data||typeof data!=='object')throw Error('invalid_status');
    const d=data as Record<string,unknown>;
    if(typeof d.enabled!=='boolean'||typeof d.configured!=='boolean')throw Error('invalid_status');
    if(!d.enabled){setStatus('disabled');return;}
    if(d.configured&&!states.includes(d.state as GatewayState))throw Error('invalid_status');
    // Consume only bounded display labels from the binding; never arbitrary reason or secret fields.
    const binding=d.binding as Record<string,unknown>|null;
    const label=(v:unknown)=>typeof v==='string'&&v.length<=80&&!/[\x00-\x1f\x7f]/.test(v)?v:'';
    setSnapshot({labels:binding&&typeof binding==='object'?{account:label(binding.account_label),sidechat:label(binding.sidechat_label)}:null,configured:d.configured,state:d.configured?d.state as GatewayState:'unconfigured',lastChecked:typeof d.last_checked_at==='number'&&Number.isFinite(d.last_checked_at)&&d.last_checked_at>0&&d.last_checked_at<8640000000000000?d.last_checked_at:null});setStatus('loaded');
   }catch{if(!abort.signal.aborted)setStatus('unknown');}
  })();return()=>abort.abort();
 },[token,slug,canManage,base,revision]);
 const mutate=async(method:'PUT'|'DELETE')=>{
  if(inFlight.current||uncertain||!canManage||status!=='loaded')return;
  const n=scope.current;inFlight.current=true;setBusy(true);setFeedback('');
  const url=`${base}/api/channels/${encodeURIComponent(slug)}/bridges/muse-personal`;
  try{
   const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(method==='PUT'?{body:JSON.stringify({account_label:account.trim(),sidechat_label:sidechat.trim(),sidechat_id:sidechatId.trim()})}:{})});
   if(n!==scope.current||base!==apiBase())return;
   if(response.status===403){setFeedback('mfa');return;}
   if(response.status>=500)throw Error('outcome_unknown');
   if(!response.ok){setFeedback('saveFailed');return;}
   const result=await response.json();
   const check=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
   if(!check.ok)throw Error('readback_failed');
   const current=await check.json();
   if(n!==scope.current||base!==apiBase())return;
   if(method==='PUT'?(typeof result.binding_id!=='string'||!result.binding_id||current.enabled!==true||current.configured!==true||current.binding?.binding_id!==result.binding_id):(result.removed!==true||current.binding!==null||current.configured!==false))throw Error('readback_mismatch');
   setFeedback(method==='PUT'?'saved':'unbound');setSidechatId('');setConfirm(false);refresh(x=>x+1);
  }catch{if(n===scope.current){setFeedback('mutationUnknown');setUncertain(true);}}
  finally{if(n===scope.current){inFlight.current=false;setBusy(false);}}
 };
 const submit=(e:FormEvent)=>{e.preventDefault();if(account.trim()&&sidechat.trim()&&/^[A-Za-z0-9_-]{1,128}$/.test(sidechatId.trim()))void mutate('PUT');};
 if(!canManage)return <p>{t('Muse.noManage')}</p>;
 return <section className="muse-personal-guide" aria-label={t('Muse.personalTitle')}>
  <h4>{t('Muse.personalTitle')}</h4><p className="muse-safety">{t('Muse.personalWarning')}</p>
  <p role="status">{t(`Muse.personal.${snapshot?.state??status}`)}</p>
  <p>{t('Muse.personalEvidence')}</p>
  {snapshot?.lastChecked&&<small>{t('Muse.personalChecked')} {new Date(snapshot.lastChecked).toLocaleString()}</small>}
  <button type="button" className="d-btn" onClick={()=>{setUncertain(false);setFeedback('');refresh(x=>x+1);}} disabled={busy||status==='loading'}>{t('Muse.refresh')}</button>
  {feedback&&<p role={['saved','unbound'].includes(feedback)?'status':'alert'}>{t(`Muse.personal.${feedback}`)}</p>}
  {status==='loaded'&&snapshot&&<details className="muse-technical"><summary>{t('Muse.personal.configure')}</summary>
   <p>{t('Muse.personal.bindingHelp')}</p>
   {snapshot.labels&&<dl><dt>{t('Muse.personal.accountLabel')}</dt><dd>{snapshot.labels.account||'—'}</dd><dt>{t('Muse.personal.sidechatLabel')}</dt><dd>{snapshot.labels.sidechat||'—'}</dd></dl>}
   <form onSubmit={submit}>
    <label>{t('Muse.personal.accountLabel')}<input name="account_label" value={account} onChange={e=>setAccount(e.currentTarget.value)} maxLength={80} required autoComplete="off" disabled={busy}/></label>
    <label>{t('Muse.personal.sidechatLabel')}<input name="sidechat_label" value={sidechat} onChange={e=>setSidechat(e.currentTarget.value)} maxLength={80} required autoComplete="off" disabled={busy}/></label>
    <label>{t('Muse.personal.sidechatId')}<input name="sidechat_id" value={sidechatId} onChange={e=>setSidechatId(e.currentTarget.value)} maxLength={128} pattern="[A-Za-z0-9_-]{1,128}" required autoComplete="off" disabled={busy}/></label>
    <button type="submit" className="d-btn" disabled={busy||uncertain}>{t('Muse.personal.save')}</button>
   </form>
   {snapshot.configured&&!confirm&&<button type="button" className="d-btn" disabled={busy||uncertain} onClick={()=>setConfirm(true)}>{t('Muse.personal.unbind')}</button>}
   {confirm&&<div><p>{t('Muse.personal.unbindConfirm')}</p><button type="button" className="d-btn" disabled={busy||uncertain} onClick={()=>void mutate('DELETE')}>{t('Muse.personal.confirmUnbind')}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>{t('Muse.personal.cancel')}</button></div>}
  </details>}
  <ol className="muse-simple-steps"><li>{t('Muse.personalPrepare')}</li><li>{t('Muse.personalAuthorize')}</li><li>{t('Muse.personalVerify')}</li></ol>
 </section>;
}
