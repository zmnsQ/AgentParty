import {useEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {useLocale} from "../i18n/locale";
import {ModalPortal} from "./ModalPortal";
import {StudioIcon} from "./StudioIcon";
import {useModalFocusTrap} from "./useModalFocusTrap";

/** Keep feature components mounted: closing this sheet must not destroy the
 * AgentJoin / AgentTokens state or their body-level portal dialogs. */
export function MobileChannelMenu({buttons,actions}:{buttons:ReactNode;actions:ReactNode}) {
 const {locale}=useLocale(),zh=locale==="zh";
 const [open,setOpen]=useState(false),[slot,setSlot]=useState<HTMLElement|null>(null);
 const panel=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),handoff=useRef(false);
 useEffect(()=>{setSlot(document.getElementById("mobile-channel-menu-slot"));},[]);
 useModalFocusTrap({active:open,containerRef:panel,returnFocusRef:trigger,
  onEscape:()=>setOpen(false),shouldRestoreFocus:()=>!handoff.current});
 const label=zh?"群组功能":"Group actions";
 const button=<button ref={trigger} type="button" className="mobile-channel-more" aria-label={label} title={label}
  aria-haspopup="dialog" aria-expanded={open} onClick={()=>{handoff.current=false;setOpen(true);}}><StudioIcon name="more"/></button>;
 return <>{slot?createPortal(button,slot):button}<ModalPortal>
  <div className="mobile-channel-menu-overlay" hidden={!open} role="dialog" aria-modal="true" aria-label={label}>
   <button type="button" className="mobile-channel-menu-scrim" tabIndex={-1} aria-label={zh?"关闭":"Close"} onClick={()=>setOpen(false)}/>
   <div ref={panel} tabIndex={-1} className="mobile-channel-menu-sheet">
    <header><h2>{label}</h2><button type="button" className="mobile-icon-button" aria-label={zh?"关闭功能菜单":"Close actions"} onClick={()=>setOpen(false)}><StudioIcon name="close"/></button></header>
    <div className="mobile-channel-menu-body" onClick={event=>{
     // Portal clicks bubble through React; only actual sheet DOM actions hand off.
     if(!event.currentTarget.contains(event.target as Node))return;
     const action=(event.target as Element).closest("button:not([disabled])");
     if(action){handoff.current=true;setOpen(false);}
    }}>
     <section className="mobile-menu-navigation"><h3>{zh?"查看群组":"Explore group"}</h3><div className="chan-tool-buttons">{buttons}</div></section>
     <section className="mobile-menu-management"><h3>{zh?"Agent 与管理":"Agents & management"}</h3><div className="chan-tool-actions">{actions}</div></section>
    </div>
   </div>
  </div>
 </ModalPortal></>;
}
