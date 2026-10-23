// Isolated interaction fixture. No real account, model calls or network writes.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {LocaleProvider} from "../../src/i18n/locale";
import {ChannelToolstrip} from "../../src/components/ChannelToolstrip";
import {AgentJoin} from "../../src/components/AgentJoin";
import {ChannelPanelModal} from "../../src/pages/Channel";
import {MuseCloudPanel} from "../../src/components/MuseCloudPanel";
import {SectionedDialog} from "../../src/components/SectionedDialog";
import "../../src/styles/tokens.css";
import "../../src/styles/foundation.css";
import "../../src/styles/app.css";
import "../../src/styles/studio.css";
import "../../src/styles/management.css";
import "../../src/styles/mobile-shell.css";
import {ResponsiveSidebar} from "../../src/components/ResponsiveSidebar";
import {installMobileViewport} from "../../src/lib/mobileViewport";
installMobileViewport();

function Fixture(){
 const [panel,setPanel]=useState("");
 return <div className="app"><header className="app-head"><a className="app-logo">Agent Commons</a><span className="app-tag">Mobile interaction fixture</span><button className="d-btn" data-test="settings" onClick={()=>setPanel("settings")}>设置</button></header>
 <div className="app-shell"><ResponsiveSidebar activeSlug="qa-mobile" title="测试群组"><button className="d-btn newchan-open">新建群组</button><div className="side"><div className="chan-cat-switch">全部 / 创建 / 加入</div><div className="studio-channel-items">{[1,2,3].map(n=><button key={n} className="chan-pill"><span className="chan-name">测试群组 {n}</span></button>)}</div></div></ResponsiveSidebar>
 <main className="app-main"><div className="chan"><div className="presence-bar">测试群组 · 2 位成员</div>
 <ChannelToolstrip buttons={<>{["公告","团队","任务","消息","协作空间"].map(label=><button className="d-btn chan-tool-btn" key={label} onClick={()=>setPanel(label)}>{label}</button>)}</>} actions={<div className="chan-admin-actions"><div className="chan-admin-group"><AgentJoin slug="qa-mobile" token="qa-synthetic" accountKey="qa" namePrefix="tester" inviterName="tester" charter={null} onCloudConnect={provider=>setPanel(provider)}/><button className="d-btn" onClick={()=>setPanel("settings")}>我的 Agent</button></div></div>}/>
 <div className="stream">{[1,2,3,4].map(n=><article className="msg-card" key={n}><header className="msg-head">测试消息 {n}</header><p className="msg-body">这是一条合成消息，用于验证手机布局、滚动和弹窗点击，不读取或发送真实群消息。</p></article>)}</div>
 <div className="composer"><textarea className="composer-input" placeholder="输入测试消息"/><div className="composer-actions"><button className="d-btn">附件</button><button className="d-btn">粘贴</button><button className="d-btn d-btn--primary">发送</button></div></div>
 </div></main></div>
 {panel&&panel!=="settings"&&<ChannelPanelModal title={panel} onClose={()=>setPanel("")}><MuseCloudPanel slug="qa-mobile" token="qa-synthetic" canManage={true}/></ChannelPanelModal>}
 {panel==="settings"&&<SectionedDialog idPrefix="qa-settings" title="设置" closeLabel="关闭" navigationLabel="设置选项" initialSection="general" onClose={()=>setPanel("")} sections={[{id:"general",label:"常规",content:<p>常规设置</p>},{id:"agents",label:"我的 Agent",content:<p>合成 Agent 列表</p>},{id:"security",label:"安全",content:<p>安全设置</p>}]}/>}
 </div>;
}
localStorage.setItem("ap_locale",new URLSearchParams(location.search).get("lang")||"zh");
document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")||"doodle";
createRoot(document.getElementById("root")!).render(<LocaleProvider><Fixture/></LocaleProvider>);
