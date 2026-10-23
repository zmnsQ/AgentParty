// Isolated synthetic UI: real Composer, PresenceBar, menus, onboarding and dialogs.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {LocaleProvider} from "../../src/i18n/locale";
import {MessageCard} from "../../src/components/MessageCard";
import type {MsgFrame} from "@agentparty/shared";
import {Composer} from "../../src/components/Composer";
import {PresenceBar} from "../../src/components/PresenceBar";
import {ChannelToolstrip} from "../../src/components/ChannelToolstrip";
import {ResponsiveSidebar} from "../../src/components/ResponsiveSidebar";
import {AgentJoin} from "../../src/components/AgentJoin";
import {ChannelPanelModal} from "../../src/pages/Channel";
import {MuseCloudPanel} from "../../src/components/MuseCloudPanel";
import {SectionedDialog} from "../../src/components/SectionedDialog";
import {StudioIcon} from "../../src/components/StudioIcon";
import {installMobileViewport} from "../../src/lib/mobileViewport";
import "../../src/styles/tokens.css";import "../../src/styles/foundation.css";
import "../../src/styles/app.css";import "../../src/styles/studio.css";
import "../../src/styles/management.css";import "../../src/styles/workspace.css";
import "../../src/styles/mobile-shell.css";
import "../../src/styles/chat-first.css";
import "../../src/styles/progressive-blur.css";
const lang=new URLSearchParams(location.search).get("lang")||"zh";
localStorage.setItem("ap_locale",lang);document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")||"doodle";
installMobileViewport();
function Fixture(){
 const [panel,setPanel]=useState(""),[draft,setDraft]=useState(""),[sent,setSent]=useState(0),[picked,setPicked]=useState(0),[slug,setSlug]=useState("qa-chat");
 return <div className="app app--channel" data-sent={sent} data-picked={picked}>
 <header className="app-head"><a className="app-logo">Agent Commons</a><button className="app-settings-btn" onClick={()=>setPanel("settings")}><StudioIcon name="settings"/></button></header>
 <div className="app-shell"><ResponsiveSidebar activeSlug={slug} title="测试群组 · 消息优先" mobileActions={<button className="d-btn" data-test="settings" onClick={()=>setPanel("settings")}><StudioIcon name="settings"/>设置</button>}>
 <button className="d-btn newchan-open">新建群组</button><div className="side"><div className="studio-channel-items">{[1,2,3].map(n=><button key={n} className="chan-pill" onClick={()=>setSlug("qa-"+n)}><span className="chan-name">测试群组 {n}</span></button>)}</div></div></ResponsiveSidebar>
 <main className="app-main"><div className="chan">
 <PresenceBar presence={{}} participants={[{name:"owner",kind:"human"},{name:"helper",kind:"agent"}]} status="open" attentionCount={1} focus={<div className="focus-inline"><button className="d-btn" onClick={()=>setPanel("状态详情")}>Host 0 · 1 项告警</button></div>}/>
 <ChannelToolstrip buttons={<>{(["announcement","group","tasks","search","coordination"] as const).map((icon,n)=><button className="d-btn chan-tool-btn" key={icon} onClick={()=>setPanel(["公告","团队","任务","消息","协作空间"][n]!)}><StudioIcon name={icon}/><span>{["公告","团队","任务","消息","协作空间"][n]}</span></button>)}</>}
 actions={<div className="chan-admin-actions"><div className="chan-admin-group"><AgentJoin slug="qa-chat" token="qa-synthetic" accountKey="qa" namePrefix="tester" inviterName="tester" charter={null} onCloudConnect={setPanel}/><button className="d-btn agenttokens-btn" onClick={()=>setPanel("settings")}><StudioIcon name="agent"/>我的 Agent</button><button className="d-btn chan-tool-btn" onClick={()=>setPanel("settings")}><StudioIcon name="settings"/>管理</button></div></div>}/>
 <div className="stream">{Array.from({length:16},(_,n)=>{
 const msg:MsgFrame={type:"msg",seq:n+1,sender:{name:n%3===2?"test-user":"test-helper",kind:n%3===2?"human":"agent",display_name:n%3===2?"测试用户":"测试助手"},kind:"message",body:n%3===0?"这是一条合成测试消息。手机上应先看清对话，不被群组管理和状态信息占满屏幕。":n%3===1?"附件、Agent 接入与设置仍然可用，分别从底部加号和顶部更多打开。":"请保留足够的阅读空间，也要能顺畅查看较长的聊天记录。",mentions:[],reply_to:null,state:null,note:null,status:null,ts:1792718400000+n*60000};
 return <MessageCard key={n} msg={msg} self="test-user" quotedMessage={null} canModerate={false} onReply={()=>setDraft("回复测试消息")} onEdit={()=>{}} onRetract={()=>{}} canCreateTask={false} onCreateTask={()=>{}} editing={false} editDraft="" editSaving={false} actionError={null} busy={false} onEditDraftChange={()=>{}} onEditCancel={()=>{}} onEditSave={()=>{}}/>;
 })}</div>
 <Composer draft={draft} setDraft={setDraft} onSend={()=>{setSent(n=>n+1);setDraft("");}} ready candidates={[{name:"qa-helper",display:"测试助手",kind:"agent",tier:"online",group:"qa"}]} mentionStatuses={[]} onPickFiles={files=>setPicked(files.length)} readClipboard={async()=>({text:"synthetic pasted text",files:[]})}/>
 </div></main></div>
 {panel&&panel!=="settings"&&<ChannelPanelModal title={panel} onClose={()=>setPanel("")}>{panel==="muse"?<MuseCloudPanel slug="qa-chat" token="qa-synthetic" canManage/>:<p>合成面板：{panel}</p>}</ChannelPanelModal>}
 {panel==="settings"&&<SectionedDialog idPrefix="qa-settings" title="设置" closeLabel="关闭" navigationLabel="设置" initialSection="general" onClose={()=>setPanel("")} sections={[{id:"general",label:"常规",content:<p>常规设置</p>},{id:"agents",label:"我的 Agent",content:<p>测试 Agent</p>}]}/>}
 </div>;
}
createRoot(document.getElementById("root")!).render(<LocaleProvider><Fixture/></LocaleProvider>);
