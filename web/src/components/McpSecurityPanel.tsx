import { StudioIcon } from "./StudioIcon";
import {useEffect,useRef,useState} from "react";
import {useT} from "../i18n/useT";
import {apiOrigin,apiBase} from "../lib/base";
import {ForbiddenError} from "../lib/api";
import {cloudBridgesApi,type McpPolicyResponse} from "../lib/cloudBridgesApi";
import "../i18n/strings/AgentConnect";
import "../i18n/strings/CollaborationHub";
import "../styles/agent-connect.css";
export function McpSecurityPanel({token,slug,canManage}:{token:string;slug:string;canManage:boolean}){
  const t=useT(),[value,setValue]=useState<McpPolicyResponse|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[note,setNote]=useState("");
  const [revision,setRevision]=useState(0),[saved,setSaved]=useState<McpPolicyResponse|null>(null);
  const alive=useRef(true),base=useRef(apiBase()),generation=useRef(0);
  useEffect(()=>{
    alive.current=true;const current=++generation.current;const abort=new AbortController();base.current=apiBase();setValue(null);setSaved(null);setError("");setNote("");setBusy(false);
    void cloudBridgesApi.security(token,slug,abort.signal).then(result=>{
      if(!abort.signal.aborted&&generation.current===current&&apiBase()===base.current){setValue(result);setSaved(result);}
    }).catch(()=>{if(!abort.signal.aborted)setError(t("AgentConnect.error"));});
    return()=>{alive.current=false;abort.abort();};
  },[token,slug,t,revision]);
  const endpoint=`${apiOrigin()}/api/channels/${encodeURIComponent(slug)}/mcp`;
  const save=async()=>{
    if(!value||!canManage||!value.can_manage||busy)return;
    const current=generation.current,server=apiBase();
    const relevant=()=>alive.current&&generation.current===current&&apiBase()===server;
    setBusy(true);setError("");setNote("");
    const {enabled,allow_write,allow_events}=value.policy;
    try{
      const saved=await cloudBridgesApi.saveSecurity(token,slug,{enabled,allow_write,allow_events});
      if(relevant()){setValue(saved);setSaved(saved);setNote(t("AgentConnect.saved"));}
    }catch(cause){if(relevant())setError(cause instanceof ForbiddenError&&cause.code==="mfa_required"?t("AgentConnect.mfaFailure"):t("AgentConnect.error"));}
    finally{if(relevant())setBusy(false);}
  };
  const change=(key:"enabled"|"allow_write"|"allow_events",checked:boolean)=>{
    setValue(current=>current?{...current,policy:{...current.policy,[key]:checked,
      ...(key==="enabled"&&!checked?{allow_write:false,allow_events:false}:{})}}:null);setNote("");
  };
  const editable=canManage&&value?.can_manage===true;
  return <section className="cloud-bridge-card mcp-security" aria-label={t("AgentConnect.security")}>
    <h3>{t("AgentConnect.security")}</h3><p>{t("AgentConnect.urlWarning")}</p>
    {error&&<p role="alert" className="commons-error">{error}</p>}
    {note&&<p role="status">{note}</p>}
    {!value&&!error&&<p role="status">{t("AgentConnect.loading")}</p>}
    {value&&<>
      <strong className="mcp-security-status">{t(!saved?.policy.enabled||!saved.policy.owner_mfa_enabled?"AgentConnect.disabled":saved?.policy.allow_write?"AgentConnect.readwrite":"AgentConnect.readonly")}</strong>
      <p>{t("AgentConnect.mfa")}</p>
      {!value.policy.owner_mfa_enabled&&<p className="commons-note">{t("AgentConnect.noMfa")} <a href="/auth/security">{t("AgentConnect.setupMfa")}</a></p>}
      {editable?<div className="mcp-security-options">
        <label><input type="checkbox" checked={value.policy.enabled} onChange={e=>change("enabled",e.target.checked)} disabled={busy||(!value.policy.owner_mfa_enabled&&!value.policy.enabled)}/><span>{t("AgentConnect.enable")}</span></label>
        <label><input type="checkbox" checked={value.policy.allow_write} onChange={e=>change("allow_write",e.target.checked)} disabled={busy||!value.policy.enabled}/><span>{t("AgentConnect.write")}</span></label>
        <label><input type="checkbox" checked={value.policy.allow_events} onChange={e=>change("allow_events",e.target.checked)} disabled={busy||!value.policy.enabled}/><span>{t("AgentConnect.events")}</span></label>
        <div className="commons-actions"><button className="d-btn" type="button" disabled={busy} onClick={()=>void save()}><StudioIcon name="check" />{t("AgentConnect.save")}</button>
          <button className="d-btn" type="button" disabled={busy} onClick={()=>setRevision(n=>n+1)}><StudioIcon name="refresh" />{t("Collab.refresh")}</button></div>
      </div>:<p>{t("AgentConnect.ownerOnly")}</p>}
    </>}
    <label className="mcp-endpoint-label">{t("AgentConnect.endpoint")}<input readOnly type="url" value={endpoint} onFocus={e=>e.currentTarget.select()} /></label>
    <button type="button" className="d-btn" onClick={()=>{void (navigator.clipboard? navigator.clipboard.writeText(endpoint):Promise.reject(new Error("clipboard_unavailable"))).then(()=>setNote(t("AgentConnect.copied"))).catch(()=>setError(t("AgentConnect.copyFailed")));}}><StudioIcon name="copy" />{t("AgentConnect.copy")}</button>
  </section>;
}
