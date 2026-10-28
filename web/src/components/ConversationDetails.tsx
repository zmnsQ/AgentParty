import {useRef,type ReactNode} from 'react';
import {ModalPortal} from './ModalPortal';
import {useModalFocusTrap} from './useModalFocusTrap';
import {useLocale} from '../i18n/locale';
import {StudioIcon} from './StudioIcon';
/** Keep child controllers mounted: AgentJoin and AgentTokens own independent portals.
 * Only the details surface is hidden, never the functional entry points in the header. */
export function ConversationDetails({open,onClose,children,restoreFocus=true,suspended=false}:{open:boolean;onClose():void;children:ReactNode;restoreFocus?:boolean;suspended?:boolean}){
 const ref=useRef<HTMLDivElement>(null),{locale}=useLocale(),zh=locale==='zh';
 useModalFocusTrap({active:open&&!suspended,containerRef:ref,onEscape:onClose,shouldRestoreFocus:()=>restoreFocus&&!suspended});
 return <ModalPortal><div className="conversation-details-overlay" hidden={!open}>
  <button type="button" className="conversation-details-scrim" tabIndex={-1} onClick={onClose} aria-label={zh?'关闭群详情':'Close group details'}/>
  <section ref={ref} className="conversation-details-panel" role="dialog" aria-modal="true" aria-label={zh?'群详情与操作':'Group details and actions'} tabIndex={-1}>
   <header><h2>{zh?'群详情':'Group details'}</h2><button type="button" onClick={onClose} aria-label={zh?'关闭群详情':'Close group details'}><StudioIcon name="close"/></button></header>
   <div className="conversation-details-content">{children}</div>
  </section>
 </div></ModalPortal>;
}
export function ConversationTools({buttons,actions}:{buttons:ReactNode;actions:ReactNode}){
 const {locale}=useLocale();return <section className="conversation-tools"><h3>{locale==='zh'?'群功能':'Group actions'}</h3><div className="conversation-tools-grid">{buttons}</div><div className="conversation-admin-actions">{actions}</div></section>;
}
