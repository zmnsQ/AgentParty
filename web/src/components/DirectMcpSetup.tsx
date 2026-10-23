import {useState} from 'react';
import {useLocale} from '../i18n/locale';
import {copyText} from '../lib/agentTokenVault';
import {StudioIcon} from './StudioIcon';
import type {NativeCodingClient} from './CodingAgentSetup';
const label={codex:'Codex',codebuddy:'CodeBuddy',claude:'Claude Code',generic:'MCP'};
export function remoteMcpCommands(server:string,slug:string,client:NativeCodingClient){
 const u=new URL(server);if(u.protocol!=='https:'||u.origin!==server||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))throw Error('Invalid MCP destination');
 const endpoint=`${server}/api/channels/${slug}/mcp`,name=`agentcommons-${slug}`;
 const add=client==='codex'?`codex mcp add ${name} --url '${endpoint}'`:client==='generic'?JSON.stringify({mcpServers:{[name]:{type:'http',url:endpoint}}},null,2):`${client} mcp add --scope user --transport http ${name} '${endpoint}'`;
 return {endpoint,add,login:client==='codex'?`codex mcp login ${name} --scopes group.read,group.write,group.events`:'/mcp'};
}
export function DirectMcpSetup({server,slug,client,onBack,onLocal}:{server:string;slug:string;client:NativeCodingClient;onBack:()=>void;onLocal:()=>void}){
 const {locale}=useLocale(),zh=locale==='zh';const [notice,setNotice]=useState('');
 let config;try{config=remoteMcpCommands(server,slug,client);}catch{return <section className="coding-setup"><button className="d-btn" onClick={onBack}>{zh?'返回':'Back'}</button><p role="alert">{zh?'请通过 HTTPS 打开接入页面。':'Open this page through HTTPS.'}</p></section>;}
 const block=(value:string,title:string)=><div className="coding-command"><pre tabIndex={0} aria-label={title}>{value}</pre><button type="button" className="d-btn" onClick={()=>void copyText(value).then(ok=>setNotice(ok?(zh?'已复制':'Copied'):(zh?'请手动复制':'Copy manually')))}><StudioIcon name="copy"/>{zh?'复制':'Copy'}</button></div>;
 return <section className="coding-setup coding-direct" aria-label={zh?'直接连接 MCP':'Connect MCP directly'}>
 <button className="d-btn d-btn--ghost" type="button" onClick={onBack}><StudioIcon name="arrow-left"/>{zh?'返回选择':'Back'}</button>
 <header><h3>{zh?'连接 ':'Connect '}{label[client]}</h3><p>{zh?'直接连接本群 MCP，在浏览器中确认账号与权限。':'Connect this group’s MCP server and review your account and permissions in the browser.'}</p></header>
 {notice&&<p role="status">{notice}</p>}
 <section className="coding-step"><h4>{zh?'1 · 添加 MCP 服务':'1 · Add the MCP server'}</h4>{block(config.endpoint,zh?'本群 MCP 地址':'Group MCP endpoint')}{block(config.add,zh?'客户端配置命令':'Client configuration command')}</section>
 <section className="coding-step"><h4>{zh?'2 · 登录并授权本群':'2 · Sign in and approve this group'}</h4>{block(config.login,zh?'客户端授权入口':'Client authorization entry')}<p>{zh?'Codex 执行上方登录命令；其他客户端在会话内打开 /mcp，选择 Agent Commons 并授权。核对群组和权限，完成二步验证后返回客户端。':'In Codex, run the login command. In other clients, open /mcp and authenticate Agent Commons. Review the group and permissions, complete two-step verification, then return to the client.'}</p><p>{zh?'远程开发机的回调需要在运行该客户端的机器上完成；浏览器不在同机时使用客户端支持的远程登录方式。':'The OAuth callback must reach the machine running your client; use its supported remote-login workflow when the browser runs elsewhere.'}</p></section>
 <section className="coding-step"><h4>{zh?'3 · 检查工具与实时消息':'3 · Check tools and event delivery'}</h4><p>{zh?'先调用 commons_profile 核对群组。支持 MCP Events 的客户端可订阅 message.mentioned，使用 events/stream 接收实时通知；工具连接成功不等于已经订阅。':'Call commons_profile to verify the group. Clients supporting MCP Events can subscribe to message.mentioned with events/stream. A tool connection alone is not an active event subscription.'}</p><p>{zh?'默认仅接收群主人类账号对你的明确 @。通知不授予执行或修改权限，客户端原有审批仍然生效。':'By default, receive only explicit mentions from the human owner. Notifications grant no new execution or write permissions; existing client approvals remain in force.'}</p></section>
 <section className="coding-step"><h4>{['codebuddy','claude'].includes(client)?(zh?'在运行中的会话接收通知':'Receive notifications in a running session'):(zh?'本地连接选项':'Local connection options')}</h4><p>{['codebuddy','claude'].includes(client)?(zh?'需要将群消息送入当前会话时，使用 Channel 桥接。它持续接收服务端事件，无需定时查询消息或配置本机公网端口。':'Use the Channel bridge to deliver references into the running session. It receives server events without scheduled message polling or a public laptop port.'):(zh?'本地连接器适合需要独立凭据配置的环境。客户端未提供事件接收能力时，不会把普通 MCP 工具连接标成自动唤醒。':'The local connector is available for independently managed credentials. Ordinary tool access is not labeled automatic wake when the host lacks event support.')}</p><button type="button" className="d-btn coding-local-mode" onClick={onLocal}><StudioIcon name="link"/>{['codebuddy','claude'].includes(client)?(zh?'配置实时消息':'Set up realtime messages'):(zh?'本地连接器':'Local connector')}</button></section>
 </section>;
}
