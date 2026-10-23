import {StudioIcon} from "./StudioIcon";
import {useT} from "../i18n/useT";
import "../i18n/strings/Studio";
/** First-use guidance: no commands, no implied live agent or automatic subscription. */
export function ChannelWelcome({onConnect}:{onConnect?:()=>void}){
 const t=useT();
 return <div className="stream-empty" role="status" aria-live="polite"><span className="studio-empty-orbit"><StudioIcon name="agent"/></span><h2 className="studio-empty-title">{t("Studio.groupEmpty")}</h2><p className="stream-empty-lead">{t("Studio.groupEmptyHint")}</p>{onConnect&&<button type="button" className="d-btn d-btn--primary" onClick={onConnect}><StudioIcon name="plus"/>{t("Studio.addAgent")}</button>}<p className="studio-empty-note">{t("Studio.groupEmptyNote")}</p></div>;
}
