import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "highlight.js/styles/github.css";
import "../src/styles/tokens.css";
import "../src/styles/foundation.css";
import "../src/styles/app.css";
import "../src/styles/studio.css";
import "../src/styles/management.css";
import "../src/styles/workspace.css";
import "../src/styles/mobile-shell.css";
import "../src/styles/chat-first.css";
import "../src/styles/progressive-blur.css";
import "../src/styles/prototype-shell.css";
import "../src/styles/prototype-sidebar.css";
import "../src/styles/prototype-chat.css";
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceShell} from '../src/components/WorkspaceShell';
import {ChannelList} from '../src/components/ChannelList';
import {MessageCard} from '../src/components/MessageCard';
import {Composer} from '../src/components/Composer';
import {LocaleProvider} from '../src/i18n/locale';
import {StudioIcon} from '../src/components/StudioIcon';
import {Brand} from '../src/components/Brand';
import {installMobileViewport} from '../src/lib/mobileViewport';
import type {MsgFrame} from '@agentparty/shared';
import type {ChannelInfo} from '../src/lib/api';

// Explicit local-only acceptance fixture. No App bootstrap, auth, credential
// provider, API/WebSocket client or production route is imported. Block optional
// component requests too (e.g. client version), in addition to the HTML CSP.
window.fetch = async () => {throw new Error('TEST_FIXTURE_NETWORK_DISABLED');};
installMobileViewport();
const noop=()=>{};
const channels:ChannelInfo[]=['品牌灵感实验室 · 测试','产品讨论 · 测试','视觉方向 · 测试'].map((title,i)=>({
 slug:`fixture-${i}`,title,topic:'TEST FIXTURE — synthetic content only',kind:'standing',mode:'normal',visibility:'private',
 owned:true,member:true,created_at:1,archived_at:null,presence:[],last_message:null,
}));
const messages:MsgFrame[]=[
 {type:'msg',seq:1,ts:1793091000000,sender:{name:'fixture-self',kind:'human'},kind:'message',body:'【测试消息】想做一个自然、有温度的生活方式品牌。\n我们一起找找方向？',mentions:[],reply_to:null,state:null,note:null,status:null},
 {type:'msg',seq:2,ts:1793091060000,sender:{name:'Muse · 测试',kind:'agent'},kind:'message',body:'【测试消息】不如从「给日常留一点空隙」开始。\n\n不追求更多，而是让每一件小事，都刚刚好。',mentions:[],reply_to:null,state:null,note:null,status:null},
 {type:'msg',seq:3,ts:1793091120000,sender:{name:'Atlas · 测试',kind:'agent'},kind:'message',body:'【测试消息】一个很有意思的方向：从「拥有更多」转向「感受更多」。\n\n**把自然，带回日常。**\n\n- 柔和的颜色\n- 清晰的内容层级\n- 紧凑但不拥挤的空间',mentions:[],reply_to:null,state:null,note:null,status:null},
];
function Preview(){
 const [active,setActive]=useState('fixture-0');const [draft,setDraft]=useState('');const [notice,setNotice]=useState('');
 const title=channels.find(c=>c.slug===active)?.title??'测试';
 return <><div style={{position:'fixed',bottom:0,right:0,zIndex:1000,background:'#f2d99c',color:'#29231f',padding:'2px 7px',fontSize:10,pointerEvents:'none'}}>TEST FIXTURE · 无网络 / 非真实账户</div>
 <div className="app app--channel">
  <header className="app-head prototype-rail">
   <a className="d-title app-logo" href="#fixture" onClick={e=>e.preventDefault()} aria-label="TEST FIXTURE"><Brand/></a>
   <nav className="prototype-rail-nav" aria-label="测试工作区">
    <button className="prototype-rail-button" aria-label="测试聊天"><StudioIcon name="message"/></button>
    <details className="prototype-rail-more"><summary className="prototype-rail-button" aria-label="测试工具"><StudioIcon name="tools"/></summary><div className="prototype-rail-popover">TEST FIXTURE — 所有操作仅本地预览。</div></details>
   </nav>
   <button className="prototype-rail-account" aria-label="测试账户" onClick={()=>setNotice('TEST FIXTURE — 不连接任何账户')}><StudioIcon name="human"/></button>
  </header>
  <WorkspaceShell route={active} title={title} navigation={<ChannelList scopeKey="test-fixture" channels={channels} active={active} error={null} onOpen={setActive} agents={[{name:'Muse · 测试'},{name:'Atlas · 测试'}]}/> }>
   <main className="app-main"><div className="chan">
    <header className="workspace-context"><h1>{title}</h1><small>TEST FIXTURE</small></header>
    {notice&&<div role="status" style={{padding:'4px 24px',color:'#c6afa2',fontSize:12}}>{notice}</div>}
    <div className="stream">{messages.map(msg=><MessageCard key={msg.seq} msg={msg} self="fixture-self" quotedMessage={null} canModerate={false} onReply={()=>setDraft(`回复测试消息 #${msg.seq}：`)} onEdit={noop} onRetract={noop} canCreateTask={false} onCreateTask={noop} editing={false} editDraft="" editSaving={false} actionError={null} busy={false} onEditDraftChange={noop} onEditCancel={noop} onEditSave={noop}/>)}</div>
    <Composer draft={draft} setDraft={setDraft} onSend={()=>setNotice('TEST FIXTURE — 未发送；保留草稿供布局检查')} ready candidates={[]} mentionStatuses={[]} nativeClipboard={null} secureContext={false}/>
   </div></main>
  </WorkspaceShell>
 </div></>;
}
createRoot(document.getElementById('root')!).render(<LocaleProvider><Preview/></LocaleProvider>);
