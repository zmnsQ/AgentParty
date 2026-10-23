import {useState} from "react";
import {lastMessagePreview,PresenceDots} from "../components/ChannelList";
import {StudioIcon} from "../components/StudioIcon";
import type {ChannelInfo} from "../lib/api";
import {useT} from "../i18n/useT";
import "../i18n/strings/Home";
import "../i18n/strings/Studio";
interface Props {channels:ChannelInfo[]|null;onOpen(slug:string):void;onCreate?():void;}
function ChannelCard({c,onOpen}:{c:ChannelInfo;onOpen(slug:string):void}){
 const t=useT(),preview=lastMessagePreview(c);
 return <button type="button" className="d-card home-card" onClick={()=>onOpen(c.slug)}>
  <header className="studio-group-card-head"><span className="studio-group-symbol"><StudioIcon name="group"/></span><span className="studio-privacy">{t(c.archived_at!==null?"Studio.archived":c.visibility==="public"?"Studio.public":c.visibility==="public_watch"?"Studio.publicWatch":"Studio.private")}</span><PresenceDots channel={c}/></header>
  <h3 className="home-card-title">{c.title?.trim()||c.slug}</h3>
  {c.topic&&<p className="home-card-topic">{c.topic}</p>}
  <p className="home-card-last">{preview??t("Studio.noMessages")}</p><span className="studio-group-open"><StudioIcon name="arrow"/></span>
 </button>;
}
export function Home({channels,onOpen,onCreate}:Props){
 const t=useT(),[showArchived,setShowArchived]=useState(false),[query,setQuery]=useState("");
 const live=channels?.filter(c=>c.archived_at===null)??null,archived=channels?.filter(c=>c.archived_at!==null)??[];
 const matches=live?.filter(c=>(c.title??c.slug).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))??[];
 return <div className="home studio-home">
  <section className="home-hero"><img className="workspace-hero-art" src="/brand/workspace.png" alt="" width="1448" height="1086"/><p className="studio-eyebrow">{t("Studio.kicker")}</p><h2 className="home-title">{t("Studio.welcome")}</h2><p className="home-sub">{t("Studio.intro")}</p>
    {onCreate&&<button type="button" className="d-btn d-btn--primary studio-create-cta" onClick={onCreate}><StudioIcon name="plus"/>{t("Studio.create")}</button>}
  </section>
  {live?.length===0&&<ol className="studio-journey">{(["group","agent","message"] as const).map((name,index)=><li key={name}><span className="studio-step-icon"><StudioIcon name={name}/></span><div><strong>{t(`Studio.step${index+1}`)}</strong><p>{t(`Studio.step${index+1}Hint`)}</p></div></li>)}</ol>}
  <section className="studio-groups" aria-label={t("Studio.groups")}>
   <header className="studio-section-heading"><h3>{t("Studio.groups")}{live&&<span>{live.length}</span>}</h3>{(live?.length??0)>0&&<label className="studio-search"><StudioIcon name="search"/><input type="search" value={query} placeholder={t("Studio.search")} aria-label={t("Studio.search")} onChange={e=>setQuery(e.target.value)}/></label>}</header>
   {channels===null?<div className="home-grid" role="status" aria-label={t("Home.loading")}>{[1,2,3].map(n=><div key={n} className="studio-skeleton-card" aria-hidden="true"/>)}</div>:<div className="home-grid">{matches.map(c=><ChannelCard key={c.slug} c={c} onOpen={onOpen}/>)}</div>}
   {live?.length===0&&<div className="studio-empty-group"><StudioIcon name="message"/><h3>{t("Studio.empty")}</h3><p>{t("Studio.emptyHint")}</p></div>}
   {(live?.length??0)>0&&matches.length===0&&<p className="d-empty" role="status">{t("Studio.noMatches")}</p>}
  </section>
  {archived.length>0&&<div className="home-archived"><button type="button" className="home-archived-toggle" aria-expanded={showArchived} onClick={()=>setShowArchived(v=>!v)}>{showArchived?"−":"+"} {t("Home.archivedToggle",{count:archived.length})}</button>{showArchived&&<div className="home-grid">{archived.map(c=><ChannelCard key={c.slug} c={c} onOpen={onOpen}/>)}</div>}</div>}
 </div>;
}
