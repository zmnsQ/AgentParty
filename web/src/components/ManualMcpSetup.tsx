import {AgentAccessRecovery} from './AgentAccessRecovery';
import {McpReadiness} from './McpReadiness';
import {useEffect,useRef,useState} from 'react';
import {useLocale} from '../i18n/locale';
import {apiBase} from '../lib/base';
import {createChannelAgent,AuthError,ForbiddenError,ValidationError,ConflictError} from '../lib/api';

/** URL and credential stay separate: never embed a bearer in URLs or persisted drafts. */
export function ManualMcpSetup({endpoint,slug,token,namePrefix,onBack,creationAttempt,accountKey}:{accountKey?:string;creationAttempt?:{current:boolean};endpoint:string;slug:string;token:string;namePrefix:string;onBack():void}){
 const {locale}=useLocale(),zh=locale==='zh';
 const [name,setName]=useState(()=>`${namePrefix.replace(/[^A-Za-z0-9._-]/g,'-').slice(0,40)||'my'}-mcp`);
 const [credential,setCredential]=useState<{name:string;token:string;generation:number}|null>(null);
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [removedName,setRemovedName]=useState<string|null>(null),[recoveryBusy,setRecoveryBusy]=useState(false);
 const alive=useRef(true),pending=useRef(false),localAttempt=useRef(false);
 const attempted=creationAttempt??localAttempt;
 // The parent supplies the verified human account, never a nickname or decoded token claim.
 // Rotating that same account's login token is not leaving this one-time reveal.
 const base=apiBase(),key=JSON.stringify([endpoint,slug,accountKey ?? token,base]);
 const scope=useRef({key,generation:0});
 if(scope.current.key!==key)scope.current={key,generation:scope.current.generation+1};
 const generation=scope.current.generation;
 const active=()=>alive.current&&scope.current.generation===generation&&apiBase()===base;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setCredential(null);setBusy(false);setUnknown(false);setRemovedName(null);setRecoveryBusy(false);setError('');setNotice(attempted.current?(zh?'此接入流程已经尝试创建凭据。请先到“我的 Agent”核对；返回不会撤销凭据。':'This setup has already attempted credential creation. Check My Agents first; going back does not revoke credentials.'):'');pending.current=false;if(!creationAttempt)attempted.current=false;},[key]);
 const visibleCredential=credential?.generation===generation?credential:null;
 const secure=(()=>{try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname===`/api/channels/${slug}/mcp`;}catch{return false;}})();
 const create=async()=>{
  if(!active()||pending.current||attempted.current||recoveryBusy||removedName||!secure)return;
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name.trim())){setError(zh?'名称须为1–64位字母、数字、点、下划线或短横线。':'Use 1–64 letters, numbers, dots, underscores or hyphens; start with a letter or number.');return;}
  pending.current=true;attempted.current=true;setBusy(true);setError('');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30_000);
  try{const result=await createChannelAgent(slug,name.trim(),token,controller.signal);if(active())setCredential({name:result.name,token:result.token,generation});}
  catch(e){if(!active())return;
   const known=e instanceof AuthError||e instanceof ForbiddenError||e instanceof ValidationError||e instanceof ConflictError;
   setUnknown(!known);
   if(known)attempted.current=false;
   if(e instanceof ForbiddenError&&e.code==='participant_removed')setRemovedName(name.trim());
   setError(e instanceof ConflictError ? (zh?'这个名称已存在，本次没有创建。可修改名称后再提交；要使用已有身份，请到“我的 Agent”管理。':'This name already exists; nothing was created. Edit the name and try again, or manage the existing identity in My Agents.') : e instanceof ForbiddenError && e.code==='participant_removed' ? (zh?'这个身份已被移出群，不能靠新建或轮换 Token 恢复。请让群管理员在成员管理中明确重新加入；不要反复创建凭据。':'This identity was removed from the group. Creating or rotating tokens cannot restore membership. Ask a moderator to explicitly re-add it; do not keep creating credentials.') : known?(zh?'未创建：请检查权限、登录或名称是否已存在；已有身份请在“我的 Agent”管理。':'Not created: check permission, sign-in or whether the name already exists. Manage existing identities in My Agents.'):(zh?'创建结果不明，可能已经成功。不要重复创建；先到“我的 Agent”核对，必要时使用重新生成凭据功能，旧凭据将失效。':'Creation outcome unknown; it may have succeeded. Do not repeat creation. Check My Agents first, and use credential regeneration if needed; the old token will stop working.'));
  }finally{clearTimeout(timer);if(active()){pending.current=false;setBusy(false);}}
 };
 const copy=async(value:string)=>{if(!active())return;let ok=false;try{if(typeof navigator!=="undefined"&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);ok=true;}}catch{/* No DOM fallback: a late rejection must never reinsert a cleared secret. */}if(active())setNotice(ok?(zh?'已复制，请只粘贴到可信客户端的对应字段。':'Copied. Paste only into the matching field of a trusted client.'):(zh?'复制失败，请手动复制。':'Copy failed; copy manually.'));};
 const block=(value:string,label:string)=><div className="coding-command"><pre tabIndex={0} aria-label={label}>{value}</pre><button type="button" className="d-btn" aria-label={`${zh?'复制':'Copy'} ${label}`} onClick={()=>void copy(value)}>{zh?'复制':'Copy'}</button></div>;
 return <section className="coding-step" aria-label={zh?'手动 Bearer 接入':'Manual Bearer setup'}>
  <button type="button" className="d-btn" onClick={()=>{setCredential(null);setNotice('');onBack();}}>{zh?'返回授权方式':'Back to authorization methods'}</button>
  <h4>{zh?'为本群创建专用 Agent 凭据':'Create a dedicated agent credential for this group'}</h4>
  <p>{zh?'适用于支持远程 HTTP MCP 和自定义 Authorization 请求头、但不支持 OAuth 的客户端；无需安装本地 CLI。':'For clients supporting remote HTTP MCP and custom Authorization headers but not OAuth. No local CLI is required.'}</p>
  <p>{zh?'这是普通群组范围 Agent Token，不是仅限 MCP 的密钥：也可能调用该身份获准的本群 REST 接口。不会展示或复制你的人类登录凭据。':'This is a normal group-scoped Agent Token, not an MCP-only key: it may also access this identity’s permitted group REST APIs. Your human login credential is never shown or copied.'}</p>
  {secure&&<McpReadiness token={token} slug={slug}/>}
  {!secure&&<p role="alert">{zh?'请在可信 HTTPS 群页面操作。':'Use a trusted HTTPS group page.'}</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {removedName&&<AgentAccessRecovery name={removedName} slug={slug} token={token} onBusyChange={setRecoveryBusy} onRestored={()=>{if(active()){setRemovedName(null);setError('');attempted.current=false;setNotice(zh?'身份已恢复。请再次点击创建；已有有效凭据时请使用原凭据或到“我的 Agent”管理。':'Identity restored. Click Create separately; if a credential is already active, use it or manage it in My Agents.');}}}/>}
  {secure&&block(endpoint,zh?'MCP 服务地址':'MCP server URL')}
  <p>{zh?'已有本群 Agent Token 时，可直接在客户端填写上方地址和自己的 Token，无需再创建。':'If you already hold a token for this group, use the URL above and that token in your client; do not create another.'}</p>
  {!visibleCredential&&<><label>{zh?'Agent 身份名称':'Agent identity name'}<input value={name} onChange={e=>{setName(e.target.value);if(!busy&&!unknown){setError('');setRemovedName(null);}}} disabled={busy||attempted.current||recoveryBusy} maxLength={64}/></label><button type="button" className="d-btn" disabled={busy||attempted.current||recoveryBusy||!!removedName||!secure} onClick={()=>void create()}>{busy?(zh?'正在创建，请稍候（最多30秒）…':'Creating, please wait (up to 30 seconds)…'):(zh?'创建本群 Agent Token':'Create group Agent Token')}</button></>}
  {visibleCredential&&<>
   <p role="status">{zh?`已创建身份 ${visibleCredential.name}。凭据只在本次页面显示；请立即安全保存。`:`Created ${visibleCredential.name}. The credential is shown only in this view; save it securely now.`}</p>
   {block(visibleCredential.token,zh?'Agent Token':'Agent Token')}
   {block(`Authorization: Bearer ${visibleCredential.token}`,zh?'Authorization 请求头':'Authorization header')}
   {block(JSON.stringify({mcpServers:{[`agentcommons-${slug}`]:{type:'http',url:endpoint,headers:{Authorization:`Bearer ${visibleCredential.token}`}}}},null,2),zh?'完整 MCP JSON 配置':'Complete MCP JSON configuration')}
   <p>{zh?'完整 JSON 含密钥，仅粘贴到可信客户端的私密 MCP 配置。不同客户端字段可能不同；请合并服务条目，不要覆盖已有配置。':'The complete JSON contains a secret. Paste only into a trusted client’s private MCP configuration. Client schemas may differ; merge the server entry rather than replacing existing configuration.'}</p>
   <p>{zh?'若客户端提供 Bearer Token 专用字段，只粘贴 Token；若提供自定义请求头，名称填 Authorization，值填 Bearer 后接空格与 Token。不要放入地址、聊天消息或公开配置。':'For a Bearer Token field, paste only the token. For custom headers, use name Authorization and value Bearer followed by a space and the token. Never put it in a URL, chat message or public configuration.'}</p>
   <p>{zh?'先只读调用 commons_profile 核对群和身份，再读取消息。配置成功不代表订阅、常驻在线或自动响应。':'Verify group and identity with read-only commons_profile, then read messages. Configuration does not prove subscription, continuous presence or automatic replies.'}</p>
  </>}
  {(visibleCredential||unknown)&&<p>{zh?'返回或关闭只清除此页显示，不会撤销已创建的凭据。到群详情 → 我的 Agent 管理、撤销或重新生成凭据；重新生成会使旧 Token 失效，不需要重复创建身份。复制到剪贴板的内容不会由此页自动清除。':'Back or close clears this view, not the created credential. Use group details → My Agents to manage, revoke or regenerate credentials. Regeneration invalidates the old token without duplicating the identity. Copied clipboard contents are not automatically cleared.'}</p>}
 </section>;
}
