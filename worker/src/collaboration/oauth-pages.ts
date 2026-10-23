/** Agent Commons by zmnsQ, based on AgentParty. Presentation only: no grant logic. */
export type OAuthLocale = "en" | "zh";
export type OAuthTheme = "doodle" | "midnight";
export interface OAuthPresentation { locale:OAuthLocale; theme:OAuthTheme; }
export interface ConsentView {
  id:string; nonce:string; clientName:string; group:string; groupTitle?:string|null;
  scopes:string[]; account:string; login?:string; redirectUri:string;
  renewal?:"expired"|"session_changed";
}
function esc(s:string):string { return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
/** Untrusted preferences affect appearance only, never auth, scopes or routing. */
export function oauthPresentation(request:Request):OAuthPresentation {
  const value=(key:string)=>{
    const parts=(request.headers.get("cookie")??"").split(";").map(s=>s.trim()).filter(s=>s.startsWith(key+"="));
    return parts.length===1?parts[0]!.slice(key.length+1):null;
  };
  const locale=value("ap_locale"),theme=value("ap_theme");
  return {
    locale:locale==="zh"||locale==="en"?locale:(request.headers.get("accept-language")??"").trim().toLowerCase().startsWith("zh")?"zh":"en",
    theme:theme==="midnight"?"midnight":"doodle",
  };
}
const icons={
  read:'<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z"/><path d="M12 6v15M6 8h3M15 8h3M6 12h3M15 12h3"/>',
  write:'<path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/>',
  events:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  shield:'<path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z"/><path d="m8 12 3 3 5-6"/>',
  alert:'<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 17v1"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
} as const;
function icon(name:keyof typeof icons):string{return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;}
function footer(zh:boolean):string {
  return `<footer class="oauth-footer"><p><strong>${zh?"现项目作者：":"Current project author:"} <a href="https://github.com/zmnsQ" rel="author noopener noreferrer">zmnsQ</a></strong><a href="https://github.com/zmnsQ/AgentParty" rel="noopener noreferrer">${zh?"项目源码":"Project source"} ↗</a></p><p>${zh?"基于":"Based on"} <a href="https://github.com/leeguooooo/AgentParty" rel="noopener noreferrer">AgentParty</a> ${zh?"二次开发 · 原作者：郭立（Guo Li / leeguoo）及贡献者。":"— originally created by Guo Li (leeguoo) and contributors."} <a href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE" rel="noopener noreferrer">BUSL-1.1</a></p><p class="oauth-upstream-note">${zh?"独立衍生项目，非原项目官方版本。":"Independent derivative, not an official upstream release."}</p></footer>`;
}
function documentPage(title:string,body:string,p:OAuthPresentation,referrer:"same-origin"|"no-referrer",status=200,callbackOrigin?:string):Response {
  const zh=p.locale==="zh";
  const csp=`default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'${callbackOrigin?" "+callbackOrigin:""}; frame-ancestors 'none'; base-uri 'none';`;
  const html=`<!doctype html><html lang="${zh?"zh-CN":"en"}" data-theme="${p.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="${referrer}"><meta name="author" content="zmnsQ"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Agent Commons</title><link rel="icon" href="/brand/mark.png"><link rel="stylesheet" href="/commons-consent.css?v=workspace-20261024"></head><body class="commons-consent"><div class="oauth-shell"><header class="oauth-masthead"><a class="oauth-brand" href="/" aria-label="AgentCommons"><img src="/brand/mark.png" width="36" height="36" alt="">AgentCommons</a><span class="oauth-context">${icon("shield")}${zh?"账户授权":"ACCOUNT ACCESS"}</span></header><main id="main-content" class="oauth-card">${body}</main>${footer(zh)}</div></body></html>`;
  return new Response(html,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":referrer,"content-security-policy":csp,"x-content-type-options":"nosniff"}});
}
export function renderOAuthConsent(v:ConsentView,p:OAuthPresentation):Response {
  const zh=p.locale==="zh";
  const title=zh?"确认这次群组连接":"Review this group connection";
  // The route must validate the COMPLETE redirect URI before passing it here.
  const callbackOrigin=new URL(v.redirectUri).origin;
  const host=new URL(v.redirectUri).hostname;
  const labels:Record<string,{name:string;hint:string;icon:keyof typeof icons}>=zh?{
    "group.read":{name:"读取群内容",hint:"读取此群的消息、任务与获准文件。",icon:"read"},
    "group.write":{name:"向群内回帖",hint:"向此群发送消息、上传获准文件及提交工作成果。",icon:"write"},
    "group.events":{name:"订阅群事件",hint:"允许建立本群事件订阅；授权本身不会开启自动响应。",icon:"events"},
  }:{
    "group.read":{name:"Read group content",hint:"Read this group’s messages, tasks and authorized files.",icon:"read"},
    "group.write":{name:"Reply to the group",hint:"Post messages, upload authorized files and submit work results to this group.",icon:"write"},
    "group.events":{name:"Subscribe to events",hint:"Allow event subscriptions for this group. Authorization alone does not enable automatic replies.",icon:"events"},
  };
  const permissions=v.scopes.map(scope=>{
    const item=labels[scope]??{name:scope,hint:zh?"请确认你了解此项权限。":"Review this permission before continuing.",icon:"shield" as const};
    return `<li class="oauth-permission"><span class="oauth-permission-icon">${icon(item.icon)}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.hint)}</p></div><code>${esc(scope)}</code></li>`;
  }).join("");
  const renewal=v.renewal?`<aside class="oauth-notice" role="status">${icon("alert")}<div><strong>${zh?"确认页已更新，请重新核对":"Confirmation updated — please review again"}</strong><p>${zh?"之前的确认页已过期或登录会话已更新。下面是新的授权确认；尚未授予访问权限。":"The previous confirmation expired or your sign-in session changed. This is a fresh request. Access has not been granted."}</p></div></aside>`:"";
  const group=v.groupTitle?.trim()||"#"+v.group;
  const body=`<nav class="oauth-progress" aria-label="${zh?"连接进度":"Connection progress"}"><ol><li class="is-complete"><span>01</span>${zh?"登录账号":"Sign in"}</li><li aria-current="step"><span>02</span>${zh?"确认权限":"Review access"}</li><li><span>03</span>${zh?"返回插件":"Return to plugin"}</li></ol></nav>
<section class="oauth-intro"><p class="oauth-eyebrow">${zh?"连接确认 / OAUTH":"CONNECTION / OAUTH"}</p><h1>${title}</h1><p class="oauth-lead"><strong>${esc(v.clientName)}</strong> ${zh?"希望连接到你的 Agent Commons 群组。请核对下面的账号、群组与权限。":"wants to connect to your Agent Commons group. Review the account, group and permissions below."}</p></section>
${renewal}<dl class="oauth-summary"><div class="oauth-summary-group"><dt>${zh?"仅授权此群组":"THIS GROUP ONLY"}</dt><dd><strong>${esc(group)}</strong><details><summary>${zh?"查看群组 ID":"View group ID"}</summary><code>#${esc(v.group)}</code></details></dd></div><div><dt>${zh?"当前 GitHub 账号":"SIGNED-IN GITHUB ACCOUNT"}</dt><dd><strong>${esc(v.login||v.account)}</strong></dd></div></dl>
<section class="oauth-permissions" aria-labelledby="permissions-heading"><div class="oauth-section-heading"><h2 id="permissions-heading">${zh?"这次允许哪些操作":"Permissions for this connection"}</h2><span>${v.scopes.length} ${zh?"项权限":v.scopes.length===1?"permission":"permissions"}</span></div><ul>${permissions}</ul></section>
<aside class="oauth-boundary">${icon("shield")}<p>${zh?"仅限上方群组，可随时在「平台接入」撤销。不会提供你的 GitHub 仓库凭据或私人 ChatGPT 对话。":"Access is limited to the group above and can be revoked in Platform integrations. Your GitHub repository credentials and private ChatGPT conversations are not shared."}</p></aside>
<section class="oauth-actions-section"><p class="oauth-return">${zh?"确认后返回":"After approval, return to"} <strong>${esc(host)}</strong></p><form method="POST" action="/oauth/authorize"><input type="hidden" name="request_id" value="${esc(v.id)}"><input type="hidden" name="nonce" value="${esc(v.nonce)}"><button class="oauth-button oauth-button-primary" name="decision" value="approve" type="submit">${zh?"允许访问此群组":"Allow access to this group"}${icon("arrow")}</button><button class="oauth-button oauth-button-secondary" name="decision" value="deny" type="submit">${zh?"暂不授权":"Not now"}</button></form><p class="oauth-fineprint">${zh?"确认页有效 10 分钟。只有点击允许并通过服务器校验后，插件才会获得所列权限。":"Valid for 10 minutes. Access is granted only after you approve and the server validates this request."}</p></section>`;
  // Keep native form Origin and the validated cross-site callback CSP intact.
  return documentPage(title,body,p,"same-origin",200,callbackOrigin);
}
const issues={
  invalid_or_expired_consent:{zh:["这次授权确认已失效","此确认单已使用或已失效，不能再次批准。请回到发起连接的插件，重新点击「连接」。","无需删除群组、重置 Token 或重新创建 GitHub 登录应用。"],en:["This confirmation is no longer valid","This one-use confirmation has already been used or expired. Return to the plugin and start a new connection.","You do not need to delete the group, reset a token or recreate the GitHub sign-in app."]},
  mfa_required:{zh:["请先开启二步验证","外部 Agent 访问群组前，需要先为 Agent Commons 账号开启验证器二步验证。","完成设置后，回到插件重新发起授权。"],en:["Set up two-step verification first","An authenticator is required on your Agent Commons account before external agents can access a group.","After setup, return to the plugin and start authorization again."]},
  login_required:{zh:["请先登录账号","此页面需要有效的 Agent Commons 登录状态。","请返回网站登录，再从插件重新发起连接。"],en:["Sign in to continue","This page requires an active Agent Commons sign-in session.","Return to the site, sign in, then reconnect from your plugin."]},
  group_mcp_policy_denied:{zh:["此群暂未允许外部连接","群主需要在此群的 MCP 安全设置中开启对应权限。","不要直接放开全部权限；只开启这次任务需要的操作。"],en:["External access is not allowed yet","The group owner must enable the required permissions in this group’s MCP security settings.","Enable only the permissions needed for this task, not unrestricted access."]},
  group_owner_required:{zh:["需要群主确认","当前账号不能为这个群组批准外部访问。","请使用群主账号，或请群主在自己的账号中完成连接。"],en:["Group owner approval required","This account cannot approve external access to this group.","Use the group owner’s account or ask the owner to authorize the connection."]},
  invalid_origin:{zh:["无法验证这次提交来源","为保护你的账号，这次授权提交已被拒绝。","请从插件重新打开授权页面，不要重发旧表单。"],en:["This submission could not be verified","For your account’s protection, this authorization submission was rejected.","Open a fresh authorization page from the plugin. Do not resubmit the old form."]},
  invalid_authorization_request:{zh:["连接请求无效","这个授权链接缺少必要信息或不匹配已注册的客户端。","请回到插件重新点击连接，不要手动修改授权地址。"],en:["Invalid connection request","This authorization link is incomplete or does not match the registered client.","Start again from your plugin instead of editing the authorization URL."]},
  invalid_request:{zh:["未能确认这次请求","提交的信息不完整，或当前页面已不能继续使用。","请从插件重新发起一次连接。"],en:["This request could not be confirmed","The submitted information is incomplete or the page can no longer be used.","Start a new connection from the plugin."]},
  invalid_scope:{zh:["这次请求的权限不可用","当前请求与此群可授予的权限不匹配。","请检查群组安全设置，再从插件重新连接。"],en:["Requested access is unavailable","The request does not match the permissions available for this group.","Review the group’s security settings, then reconnect from your plugin."]},
  authorization_save_failed:{zh:["暂时无法保存授权","服务器没有完成这次授权保存，请稍后从插件重试。","不要重置已有凭据或关闭二步验证。"],en:["Authorization could not be saved","The server could not finish saving this authorization. Try again from the plugin.","Do not reset existing credentials or turn off two-step verification."]},
} as const;
export type OAuthProblem=keyof typeof issues;
export function renderOAuthProblem(request:Request,code:OAuthProblem,status:number):Response {
  // API clients retain exactly the same status and JSON schema.
  if(!request.headers.get("accept")?.includes("text/html"))return Response.json({error:code},{status,headers:{"cache-control":"no-store","referrer-policy":"no-referrer"}});
  const p=oauthPresentation(request),zh=p.locale==="zh",copy=issues[code][p.locale];
  const primary=code==="mfa_required"?"/auth/security":"/";
  const primaryLabel=code==="mfa_required"?(zh?"设置二步验证":"Set up verification"):(zh?"返回 Agent Commons":"Return to Agent Commons");
  const body=`<section class="oauth-result"><span class="oauth-result-icon">${icon("alert")}</span><p class="oauth-eyebrow">${zh?"连接未完成":"CONNECTION NOT COMPLETED"}</p><h1>${esc(copy[0])}</h1><p class="oauth-lead" role="alert">${esc(copy[1])}</p><p>${esc(copy[2])}</p><aside class="oauth-boundary">${icon("shield")}<p>${zh?"本页面没有授予任何新的访问权限。":"This page has not granted any new access."}</p></aside><a class="oauth-button oauth-button-primary" href="${primary}">${primaryLabel}${icon("arrow")}</a><details class="oauth-error-detail"><summary>${zh?"查看错误标识":"View error reference"}</summary><code>${code}</code></details></section>`;
  return documentPage(copy[0],body,p,"no-referrer",status);
}
