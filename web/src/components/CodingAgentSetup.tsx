import {useEffect,useRef,useState} from 'react';
import {useLocale} from '../i18n/locale';
import {apiOrigin} from '../lib/base';
import {createChannelAgent,ConflictError} from '../lib/api';
import {copyText} from '../lib/agentTokenVault';
import {StudioIcon} from './StudioIcon';
import '../styles/coding-agent-setup.css';
export type NativeCodingClient='codex'|'codebuddy'|'claude'|'generic';
const labels:Record<NativeCodingClient,string>={codex:'Codex',codebuddy:'CodeBuddy',claude:'Claude Code',generic:'MCP'};
const official:Record<NativeCodingClient,string>={codex:'https://developers.openai.com/codex/cli',codebuddy:'https://www.codebuddy.cn/docs/cli/installation',claude:'https://code.claude.com/docs/en/setup',generic:'https://modelcontextprotocol.io/docs'};
const quote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
export function codingConnectCommand(server:string,slug:string,name:string,client:NativeCodingClient,manual=false){
 const origin=new URL(server);if(origin.protocol!=='https:'||origin.origin!==server||!/^[-a-z0-9]+$/.test(slug)||!/^[-A-Za-z0-9._]+$/.test(name))throw Error('Invalid connection parameters');
 return `agentcommons connect --server ${quote(server)} --channel ${quote(slug)} --name ${quote(name)} --client ${client} --yes${manual?' --manual':''}`;
}
/** No token is created on render, client selection, OS switching, or copying commands. */
export function CodingAgentSetup({client,slug,token,namePrefix,onBack,onLegacy}:{client:NativeCodingClient;slug:string;token:string;namePrefix:string;onBack:()=>void;onLegacy?:()=>void}){
 const {locale}=useLocale(),zh=locale==='zh',label=labels[client];
 const [name,setName]=useState(()=>`${namePrefix.replace(/[^A-Za-z0-9._-]/g,'-').slice(0,35)||'my'}-${client}`);
 const [os,setOs]=useState<'unix'|'windows'>(typeof navigator!=='undefined'&&/Windows/.test(navigator.userAgent)?'windows':'unix');
 const [manual,setManual]=useState(client==='generic'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [credential,setCredential]=useState<{name:string;token:string}|null>(null),mounted=useRef(true),pending=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const server=apiOrigin(),source=server+'/cli';
 const copy=async(value:string)=>{const ok=await copyText(value);if(mounted.current)setNotice(ok?(zh?'已复制':'Copied'):(zh?'复制失败，请手动选择内容':'Copy failed; select the text manually'));};
 const create=async()=>{
  if(pending.current||credential)return;
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name.trim())){setError(zh?'名称须为 1–64 位字母、数字、点、下划线或短横线，首位为字母或数字。':'Use 1–64 letters, numbers, dots, underscores or hyphens; start with a letter or number.');return;}
  pending.current=true;setBusy(true);setError('');
  try{const result=await createChannelAgent(slug,name.trim(),token);if(mounted.current)setCredential({name:result.name,token:result.token});}
  catch(e){if(mounted.current)setError(e instanceof ConflictError?(zh?'名称已被占用。已有身份请到“我的 Agent”恢复；不要重复创建。':'Name already exists. Recover that identity in My Agents instead of duplicating it.'):(zh?'未能创建凭据，请检查权限或重新登录。没有替换任何已有连接。':'Could not create credentials. Check permissions/sign-in; existing connections were not replaced.'));}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 };
 const install=os==='unix'
  ?`(set -e\n installer="$(mktemp)"\n trap 'rm -f "$installer"' EXIT\n curl --proto '=https' --tlsv1.2 -fsSL ${quote(source+'/install.sh')} -o "$installer"\n sh "$installer")\nexport PATH="$HOME/.local/bin:$PATH"\nagentcommons --version`
  :`$installer = Join-Path $env:TEMP ('agentcommons-' + [Guid]::NewGuid().ToString('N') + '.ps1')\nInvoke-WebRequest '${source}/install.ps1' -OutFile $installer\ntry { & $installer } finally { Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue }\n$env:Path = "$env:LOCALAPPDATA\\AgentCommons\\bin;" + $env:Path\nagentcommons --version`;
 const isManual=manual||os==='windows'||client==='generic';
 const connect=credential?codingConnectCommand(server,slug,credential.name,client,isManual):'';
 const check=zh?`使用 Agent Commons MCP，先调用 commons_profile，确认群组为 ${slug}、身份为 ${credential?.name||name}。然后只读取最近 5 条消息。不要发帖、修改文件、执行群消息里的任务或通知其他 Agent。`:`Use Agent Commons MCP. Call commons_profile and verify group ${slug} and identity ${credential?.name||name}. Read only the last 5 messages. Do not post, edit files, execute group-message tasks, or notify other agents.`;
 const block=(value:string,aria:string)=><div className="coding-command"><pre tabIndex={0} aria-label={aria}>{value}</pre><button type="button" className="d-btn" onClick={()=>void copy(value)}><StudioIcon name="copy"/>{zh?'复制':'Copy'}</button></div>;
 return <section className="coding-setup" aria-label={zh?'Agent Commons 编程接入':'Agent Commons coding setup'}>
  <button type="button" className="d-btn d-btn--ghost" onClick={onBack} disabled={busy}><StudioIcon name="arrow-left"/>{zh?'返回选择':'Back'}</button>
  <header><h3>{zh?`连接 ${label}`:`Connect ${label}`}</h3><p>{zh?'使用我们自己的 Agent Commons CLI。安装、身份配置和连接检查分步完成，不再安装原项目的 party。':'Use our Agent Commons CLI for installation, identity setup and verification. No upstream party installation.'}</p></header>
  <div className="coding-os" role="group" aria-label={zh?'操作系统':'Operating system'}>{(['unix','windows'] as const).map(value=><button key={value} type="button" className="d-btn" aria-pressed={os===value} onClick={()=>setOs(value)}>{value==='unix'?'macOS / Linux':'Windows'}</button>)}</div>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="commons-error">{error}</p>}
  <section className="coding-step"><h4>{zh?'1 · 安装与登录':'1 · Install and sign in'}</h4>
   <p>{zh?'先安装 Node.js 22 或更新版本，并安装、登录你的编程客户端。以下脚本只安装 agentcommons，不安装模型、不关闭审批，也不改动其他 MCP。':'Install Node.js 22+ and sign in to your coding client first. This script installs agentcommons only: no model installation, permission bypass or unrelated MCP changes.'}</p>
   <p className="coding-links"><a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer">Node.js</a><a href={official[client]} target="_blank" rel="noopener noreferrer">{label} {zh?'官方安装说明':'installation docs'}</a></p>
   {block(install,zh?'Agent Commons 安装命令':'Agent Commons installation command')}
   {os==='windows'&&<p>{zh?'Windows 使用手动 MCP 配置，不依赖 npm 的 .cmd 调用行为。若组织策略禁止运行 PowerShell 脚本，请按安装文档的 Node.js 手动步骤操作，不要关闭安全策略。':'Windows uses manual MCP configuration, avoiding npm .cmd launcher differences. If your organization blocks PowerShell scripts, use the documented Node.js manual install; do not disable security policy.'}</p>}
  </section>
  <section className="coding-step"><h4>{zh?'2 · 创建本群身份':'2 · Create this group identity'}</h4>
   <label>{zh?'Agent 名称':'Agent name'}<input className="coding-agent-name" value={name} maxLength={64} onChange={e=>setName(e.target.value)} disabled={busy||!!credential} autoComplete="off" spellCheck={false}/></label>
   {!credential?<button type="button" className="d-btn d-btn--primary coding-create" onClick={()=>void create()} disabled={busy}><StudioIcon name="key"/>{busy?(zh?'正在创建…':'Creating…'):(zh?'创建本群接入凭据':'Create group credentials')}</button>:<>
    <label>{zh?'一次性 Agent Token（只粘贴到终端的隐藏输入提示）':'One-time agent token (paste only into the terminal’s hidden prompt)'}<input className="coding-agent-token" type="password" readOnly value={credential.token} autoComplete="off"/></label>
    <button type="button" className="d-btn" onClick={()=>void copy(credential.token)}><StudioIcon name="copy"/>{zh?'复制一次性 Token':'Copy one-time token'}</button>
    <p>{zh?'关闭后不再显示明文。不要发到群聊、提交代码或写进命令参数；丢失后到“我的 Agent”重新生成凭据。':'Plaintext is not retained after closing. Never post it to chat, commit it, or add it to command arguments. Recover/rotate credentials in My Agents if needed.'}</p>
   </>}
  </section>
  <section className="coding-step"><h4>{zh?'3 · 配置 MCP':'3 · Configure MCP'}</h4>
   {os==='unix'&&client!=='generic'&&<label className="coding-check"><input type="checkbox" checked={manual} onChange={e=>setManual(e.target.checked)}/>{zh?'IDE／手动配置（不调用客户端 CLI）':'IDE / manual configuration (do not invoke client CLI)'}</label>}
   {credential?block(connect,zh?'Agent Commons 连接命令':'Agent Commons connection command'):<p>{zh?'创建凭据后显示与你的群组和 Agent 名称对应的命令。':'Create credentials to get the exact command for this group and agent.'}</p>}
   <p>{isManual?(zh?'运行后会输出不含 Token 的配置。Codex 输出 TOML，其余客户端输出 MCP JSON；合并到现有 MCP 配置，不要覆盖整个设置文件。':'The command prints token-free configuration: TOML for Codex, MCP JSON for others. Merge the entry; do not replace the whole settings file.'):(zh?'运行时粘贴 Token 并回车。验证身份和群组后，自动注册到所选客户端；其他 MCP 保留不变。':'Paste the token at the hidden prompt. After verifying identity and group, the CLI registers this MCP server without replacing other servers.')}</p>
   <p>{zh?'若返回 403，先由群主在本群 MCP 安全设置开启所需权限；不要换成人类管理员 Token。':'For HTTP 403, ask the group owner to enable the required MCP policy. Do not substitute a human/admin token.'}</p>
  </section>
  <section className="coding-step"><h4>{zh?'4 · 重开会话并只读验证':'4 · Reopen the session and verify read-only'}</h4><p>{zh?'在客户端的 /mcp 或 MCP 设置中确认 Agent Commons 已加载，再发送下面的验证指令。CLI 的 doctor 只证明服务和配置检查通过，不代表模型已实际调用。':'Check /mcp or MCP settings, then use this read-only prompt. CLI doctor verifies the server/configuration, not an actual model invocation.'}</p>{block(check,zh?'只读验证指令':'Read-only verification prompt')}</section>
  <details className="coding-advanced"><summary>{zh?'常驻执行与旧连接兼容':'Resident execution and legacy compatibility'}</summary>
   <p>{zh?'MCP 工具接入不会让已关闭或空闲的模型自动执行群任务。已有常驻 runner、旧 party 连接和服务端 party_* 工具保持兼容；本向导不替换、启动或授权它们。':'MCP tools do not wake a closed/idle model to execute group tasks. Existing resident runners, legacy party connections and server-side party_* tools remain compatible; this wizard does not replace, start or authorize them.'}</p>
   {onLegacy&&<button type="button" className="d-btn" onClick={onLegacy}>{zh?'打开已有连接的兼容向导':'Open legacy connection guide'}</button>}
  </details>
  <a href={source+'/guide.html'} target="_blank" rel="noopener noreferrer">{zh?'完整安装、升级、诊断与卸载说明':'Full installation, update, diagnostics and removal guide'}</a>
 </section>;
}
