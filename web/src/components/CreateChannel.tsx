import {useCallback,useEffect,useRef,useState} from "react";
import {AuthError,ConflictError,createChannel,ForbiddenError,ValidationError,type Visibility} from "../lib/api";
import {forbiddenText} from "../lib/forbidden";
import {isCompositionKey} from "../lib/compositionGuard";
import {StudioIcon} from "./StudioIcon";
import {useT} from "../i18n/useT";
import "../i18n/strings/CreateChannel";
import "../i18n/strings/Studio";
interface Props {token:string;onCreated(slug:string):void;requestOpen?:number;}
const VIS_OPTIONS:readonly Visibility[]=["private","public_watch","public"];
export function CreateChannel({token,onCreated,requestOpen=0}:Props){
 const t=useT(),[open,setOpen]=useState(false),[title,setTitle]=useState(""),[visibility,setVisibility]=useState<Visibility>("private"),[party,setParty]=useState(false),[busy,setBusy]=useState(false),[err,setErr]=useState<string|null>(null);
 const dialogRef=useRef<HTMLDialogElement|null>(null),triggerRef=useRef<HTMLButtonElement|null>(null),nameRef=useRef<HTMLInputElement|null>(null),sending=useRef(false);
 const reset=useCallback(()=>{setTitle("");setVisibility("private");setParty(false);setErr(null);},[]);
 const returnFocus=useRef<HTMLElement|null>(null);
 const show=useCallback(()=>{returnFocus.current=typeof document!=="undefined"?document.activeElement as HTMLElement|null:null;reset();setOpen(true);},[reset]);
 useEffect(()=>{if(requestOpen>0)show();},[requestOpen,show]);
 useEffect(()=>{
  if(!open)return;
  const el=dialogRef.current;
  // Native top layer gives inert background, focus containment, Escape and mobile scrolling.
  if(el&&!el.open){if(typeof el.showModal==="function")el.showModal();else el.setAttribute("open","");}
  nameRef.current?.focus?.();
  return()=>{if(el?.open)el.close?.();const target=returnFocus.current; if(target?.isConnected)target.focus?.();else triggerRef.current?.focus?.();};
 },[open]);
 const close=()=>{if(sending.current)return;setOpen(false);reset();};
 const submit=useCallback(async()=>{
  if(sending.current)return;
  const name=title.trim();if(!name||name.length>80){setErr(t("CreateChannel.nameInvalid"));return;}
  sending.current=true;setErr(null);setBusy(true);
  try{
   const created=await createChannel(token,{title:name,visibility,mode:party?"party":"normal"});
   if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(created.slug))throw Error("invalid generated channel identifier");
   setOpen(false);reset();onCreated(created.slug);
  }catch(e){setErr(e instanceof ConflictError?t("CreateChannel.errConflict"):e instanceof ForbiddenError?forbiddenText(e,t,"CreateChannel.errForbidden"):e instanceof ValidationError?t("CreateChannel.errValidation"):e instanceof AuthError?t("CreateChannel.errAuth"):t("CreateChannel.errGeneric"));}
  finally{sending.current=false;setBusy(false);}
 },[title,visibility,party,token,onCreated,reset,t]);
 return <>
  <button ref={triggerRef} type="button" className="d-pill chan-pill newchan-open" onClick={show}><span className="chan-head"><StudioIcon name="plus"/><span className="chan-name">{t("CreateChannel.new")}</span></span></button>
  {open&&<dialog ref={dialogRef} className="studio-create-modal" aria-labelledby="newchan-dialog-title" aria-describedby="newchan-dialog-help" aria-modal="true"
    onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>{if(e.key==="Escape"&&isCompositionKey(e)){e.preventDefault();e.stopPropagation();}}}>
   <div className="d-card newchan-card">
    <header className="studio-create-heading"><span className="studio-step-icon"><StudioIcon name="group"/></span><button type="button" className="studio-close" onClick={close} disabled={busy} aria-label={t("CreateChannel.cancel")}>×</button></header>
    <h2 id="newchan-dialog-title">{t("Studio.newGroupTitle")}</h2><p id="newchan-dialog-help" className="studio-form-lead">{t("Studio.newGroupHint")}</p>
    <label className="newchan-name-label" htmlFor="newchan-name">{t("CreateChannel.nameLabel")}</label>
    <input ref={nameRef} id="newchan-name" className="newchan-input" autoFocus maxLength={80} value={title} placeholder={t("CreateChannel.titlePlaceholder")} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!isCompositionKey(e)){e.preventDefault();void submit();}}} disabled={busy}/>
    <p className="newchan-help" id="newchan-identifier-help">{t("CreateChannel.generatedHint")}</p>
    <div className="newchan-opts"><div className="newchan-seg" role="group" aria-label={t("CreateChannel.visibilityLabel")}><span className="newchan-segk">{t("CreateChannel.visibilityLabel")}</span>{VIS_OPTIONS.map(opt=><button key={opt} type="button" className={"newchan-choice"+(visibility===opt?" is-on":"")} onClick={()=>setVisibility(opt)} disabled={busy} aria-pressed={visibility===opt}>{t(`CreateChannel.vis.${opt}`)}</button>)}</div></div>
    <p className="newchan-help">{t(`CreateChannel.help.${visibility}`)}</p>
    <details className="studio-create-advanced"><summary>{t("Studio.advanced")}</summary><label className="newchan-check"><input type="checkbox" checked={party} onChange={e=>setParty(e.target.checked)} disabled={busy}/><span>{t("CreateChannel.party")}</span></label></details>
    {err!==null&&<p className="banner banner--red newchan-err" role="alert">{err}</p>}
    <div className="newchan-actions"><button type="button" className="d-btn newchan-cancel" onClick={close} disabled={busy}>{t("CreateChannel.cancel")}</button><button type="button" className="d-btn d-btn--primary" onClick={submit} disabled={busy||!title.trim()}>{busy?t("CreateChannel.creating"):t("CreateChannel.create")}</button></div>
   </div>
  </dialog>}
 </>;
}
