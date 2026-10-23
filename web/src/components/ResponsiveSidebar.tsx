import {useEffect,useRef,useState,type ReactNode} from "react";
import {useLocale} from "../i18n/locale";
import {COMPACT_MEDIA,isCompactViewport} from "../lib/mobileViewport";
import {ModalPortal} from "./ModalPortal";
import {useModalFocusTrap} from "./useModalFocusTrap";
import {StudioIcon} from "./StudioIcon";

/** Keep the desktop sidebar, but give phones a real group-switching drawer. */
export function ResponsiveSidebar({children,activeSlug,title,requestOpen=0}:{children:ReactNode;activeSlug:string|null;title?:string|null;requestOpen?:number}){
 const {locale}=useLocale(),zh=locale==="zh";
 const [compact,setCompact]=useState(isCompactViewport),[open,setOpen]=useState(false);
 const dialog=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(typeof window.matchMedia!=="function")return;const q=window.matchMedia(COMPACT_MEDIA),sync=()=>setCompact(q.matches);sync();q.addEventListener?.("change",sync);return()=>q.removeEventListener?.("change",sync);},[]);
 useEffect(()=>setOpen(false),[activeSlug,compact]);
 useEffect(()=>{if(requestOpen>0)setOpen(true);},[requestOpen]);
 useModalFocusTrap({active:compact&&open,containerRef:dialog,returnFocusRef:trigger,onEscape:()=>setOpen(false)});
 if(!compact)return <aside className="app-side">{children}</aside>;
 const label=zh?"群组":"Groups",close=zh?"关闭群组列表":"Close group list";
 return <><div className="mobile-groupbar"><button ref={trigger} type="button" className="mobile-group-toggle" aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(true)}><StudioIcon name="group"/><span>{title||activeSlug||label}</span><small>{zh?"切换群组":"Switch group"}</small><StudioIcon name="chevron-down"/></button></div>
 {open&&<ModalPortal><div ref={dialog} className="mobile-groups-overlay" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
 <button type="button" className="mobile-groups-scrim" tabIndex={-1} aria-label={close} onClick={()=>setOpen(false)}/>
 <aside className="app-side mobile-groups-drawer"><header><h2>{label}</h2><button className="d-btn" type="button" aria-label={close} onClick={()=>setOpen(false)}><StudioIcon name="close"/></button></header><div className="mobile-groups-content" onClick={e=>{if((e.target as HTMLElement).closest(".chan-pill"))setOpen(false);}}>{children}</div></aside>
 </div></ModalPortal>}</>;
}
