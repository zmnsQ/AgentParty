import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {useLocale} from "../i18n/locale";
import {COMPACT_MEDIA,isCompactViewport} from "../lib/mobileViewport";
import {ModalPortal} from "./ModalPortal";
import {useModalFocusTrap} from "./useModalFocusTrap";
import {StudioIcon} from "./StudioIcon";

/** Keep the desktop sidebar, but give phones a real group-switching drawer. */
export function ResponsiveSidebar({children,activeSlug,title,requestOpen=0,mobileActions}:{children:ReactNode;activeSlug:string|null;title?:string|null;requestOpen?:number;mobileActions?:ReactNode}){
 const {locale}=useLocale(),zh=locale==="zh";
 const [compact,setCompact]=useState(isCompactViewport),[open,setOpen]=useState(false);
 const drawerId=useId();
 const [triggerHost,setTriggerHost]=useState<HTMLElement|null>(null);
 const dialog=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(typeof window==="undefined"||typeof window.matchMedia!=="function")return;const q=window.matchMedia(COMPACT_MEDIA),sync=()=>setCompact(q.matches);sync();q.addEventListener?.("change",sync);return()=>q.removeEventListener?.("change",sync);},[]);
 useEffect(()=>{
  if(!compact||!activeSlug||typeof document==='undefined'){setTriggerHost(null);return;}
  const sync=()=>setTriggerHost(document.getElementById('mobile-navigation-trigger-slot'));
  sync();
  if(typeof MutationObserver==='undefined'||!document.body)return;
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
 },[compact,activeSlug]);
 useEffect(()=>setOpen(false),[activeSlug,compact]);
 useEffect(()=>{if(requestOpen>0)setOpen(true);},[requestOpen]);
 useModalFocusTrap({active:compact&&open,containerRef:dialog,returnFocusRef:trigger,onEscape:()=>setOpen(false)});
 if(!compact)return <aside className="app-side">{children}</aside>;
 const label=zh?"群组":"Groups",close=zh?"关闭群组列表":"Close group list";
 const toggle=<button ref={trigger} type="button" className={activeSlug?"mobile-group-toggle mobile-navigation-icon":"mobile-group-toggle"} aria-label={zh?"打开群组列表":"Open group list"} aria-controls={open?drawerId:undefined} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(true)}><StudioIcon name="group"/>{!activeSlug&&<><span>{title||label}</span><StudioIcon name="chevron-down"/></>}</button>;
 return <>{activeSlug?(triggerHost?createPortal(toggle,triggerHost):<div className="mobile-navigation-fallback">{toggle}</div>):<div className="mobile-groupbar">{toggle}</div>}
 {open&&<ModalPortal><div id={drawerId} ref={dialog} className="mobile-groups-overlay prototype-native-drawer" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
 <button type="button" className="mobile-groups-scrim" tabIndex={-1} aria-label={close} onClick={()=>setOpen(false)}/>
 <aside className="app-side mobile-groups-drawer"><header><h2>{label}</h2><button className="d-btn" type="button" aria-label={close} onClick={()=>setOpen(false)}><StudioIcon name="close"/></button></header><div className="mobile-groups-content" onClick={e=>{if((e.target as HTMLElement).closest(".chan-pill"))setOpen(false);}}>{children}{mobileActions&&<div className="mobile-drawer-actions" onClick={e=>{if((e.target as HTMLElement).closest("button,a"))setOpen(false);}}>{mobileActions}</div>}</div></aside>
 </div></ModalPortal>}</>;
}
