import {Brand} from "./Brand";
import { useEffect, useState } from 'react';
import { useLocale } from '../i18n/locale';
import { LanguageSwitcher } from './LanguageSwitcher';
import { OriginalProjectCredit } from './OriginalProjectCredit';
import { browserAuthRequest, githubLoginUrl, securityError } from '../lib/browserAuth';
import './browser-auth.css';

/** Current author and original-project attribution, localized on every auth page. */
function AuthPageFooter() {
  return <footer className="browser-auth-attribution">
    <LanguageSwitcher />
    <OriginalProjectCredit compact />
  </footer>;
}

export function SecondFactorGate({ onVerified, onCancel }: { onVerified(): Promise<unknown>; onCancel(): Promise<unknown> }) {
  const { locale } = useLocale(); const zh = locale === 'zh';
  const [code, setCode] = useState(''), [recovery, setRecovery] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  return <main className="gate"><Brand/><section className="d-card browser-security"><h1>{zh ? '二步验证' : 'Two-step verification'}</h1>
    <p>{zh ? 'GitHub 身份已确认。请输入验证器中的 6 位验证码，完成本次登录。' : 'GitHub identity confirmed. Enter the six-digit authenticator code to finish signing in.'}</p>
    <form className="browser-auth-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(null); try { await browserAuthRequest('/verify', { code, recovery }); setCode(''); await onVerified(); } catch (err) { setError(err); } finally { setBusy(false); } }}>
      <label>{recovery ? (zh ? '一次性恢复码' : 'One-time recovery code') : (zh ? '验证器验证码' : 'Authenticator code')}
        <input className="gate-input" aria-label={recovery ? 'Recovery code' : 'Authenticator code'} type="text" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={recovery ? 39 : 6} value={code} onChange={e=>setCode(e.target.value)} autoFocus required />
      </label>
      {error !== null && <p className="banner banner--red" role="alert">{securityError(error, zh)}</p>}
      <button className="d-btn d-btn--primary" disabled={busy || !code.trim()}>{busy ? (zh ? '正在验证…' : 'Verifying…') : (zh ? '验证并登录' : 'Verify and sign in')}</button>
      <button type="button" className="d-btn" disabled={busy} onClick={()=>{ setRecovery(!recovery);setCode('');setError(null); }}>{recovery ? (zh ? '改用验证器' : 'Use authenticator') : (zh ? '无法使用验证器？使用恢复码' : 'Use a recovery code instead')}</button>
      <button type="button" className="d-btn" disabled={busy} onClick={async()=>{setBusy(true);try{await onCancel();}catch(e){setError(e);}finally{setBusy(false);}}}>{zh ? '取消登录' : 'Cancel sign-in'}</button>
    </form><AuthPageFooter /></section></main>;
}
interface SecurityStatus { enabled: boolean; recovery_remaining: number; recent_login: boolean; login: string; }
export function BrowserSecurity() {
  const {locale}=useLocale();const zh=locale==='zh';
  const [status,setStatus]=useState<SecurityStatus|null>(null),[setup,setSetup]=useState<{secret:string;otpauth_uri:string}|null>(null);
  const [qr,setQr]=useState(''),[code,setCode]=useState(''),[recovery,setRecovery]=useState(false),[codes,setCodes]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[action,setAction]=useState<'disable'|'recovery-codes'|null>(null);
  async function reload() { const s=await browserAuthRequest<SecurityStatus>('/security');setStatus(s); }
  useEffect(()=>{let alive=true;browserAuthRequest<SecurityStatus>('/security').then(s=>{if(alive)setStatus(s);}).catch(e=>{if(alive)setError(e);});return()=>{alive=false;};},[]);
  useEffect(()=>{let alive=true;setQr('');if(setup)void import('qrcode').then(m=>m.default.toDataURL(setup.otpauth_uri,{width:240,margin:2,errorCorrectionLevel:'M'})).then(data=>{if(alive)setQr(data);}).catch(()=>{});return()=>{alive=false;};},[setup]);
  async function perform(fn:()=>Promise<void>) {if(busy)return;setBusy(true);setError(null);try{await fn();}catch(e){setError(e);}finally{setBusy(false);}}
  async function finish(path:string) {
    const result=await browserAuthRequest<{recovery_codes?:string[]}>(path,{code,recovery});setCodes(result.recovery_codes??[]);setCode('');setSetup(null);setAction(null);
    window.dispatchEvent(new Event('commons-auth-refresh'));await reload();
  }
  function downloadCodes(){const blob=new Blob([`Agent Commons — ${status?.login??''}\nOne-time recovery codes. Keep offline and private.\n\n${codes.join('\n')}\n`],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='AgentCommons-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <main className="gate"><Brand/><section className="d-card browser-security"><a href="/">← {zh?'返回协作空间':'Back to workspace'}</a><h1>{zh?'账号安全':'Account security'}</h1>
    <p>{zh?'GitHub 登录负责确认身份；本站验证器是独立的第二道验证。':'GitHub confirms your identity. This authenticator is an independent second verification step.'}</p>
    {error!==null&&<p className="banner banner--red" role="alert">{securityError(error,zh)}</p>}
    {!status&&error===null&&<p role="status">{zh?'正在读取设置…':'Loading settings…'}</p>}
    {status&&<><p className="browser-auth-status">{status.enabled?'✓ ':''}{status.enabled?(zh?'已启用二步验证':'Two-step verification enabled'):(zh?'尚未启用二步验证':'Two-step verification is not enabled')}</p>
      {codes.length>0&&<section className="browser-recovery" aria-label="Recovery codes"><h2>{zh?'保存恢复码':'Save your recovery codes'}</h2><p>{zh?'这些恢复码只在此处显示一次，每个只能使用一次。请离线保存，不要发到群里。':'These codes are shown only once. Each can be used once. Store them offline, never in a group chat.'}</p><pre>{codes.join('\n')}</pre><button className="d-btn" onClick={downloadCodes}>{zh?'保存恢复码文件':'Save recovery-code file'}</button><button className="d-btn" onClick={()=>setCodes([])}>{zh?'我已妥善保存':'I have saved them securely'}</button></section>}
      {!status.enabled&&!setup&&(status.recent_login?<button className="d-btn d-btn--primary" disabled={busy} onClick={()=>void perform(async()=>{setSetup(await browserAuthRequest('/security/setup',{}));setCodes([]);})}>{zh?'绑定验证器':'Set up authenticator'}</button>:<a className="d-btn" href={githubLoginUrl('/auth/security')}>{zh?'重新登录后设置':'Sign in again to continue'}</a>)}
      {setup&&<section className="browser-auth-stack"><h2>{zh?'1. 扫码添加到验证器':'1. Add to your authenticator'}</h2><p>{zh?'使用手机上的 TOTP 验证器扫描二维码；二维码在你的浏览器内生成，不发送给第三方。':'Scan with a TOTP authenticator. The QR code is generated locally in your browser, never by a third-party service.'}</p>{qr&&<img className="browser-auth-qr" src={qr} width="240" height="240" alt={zh?'验证器绑定二维码':'Authenticator enrollment QR code'}/>}<details><summary>{zh?'无法扫码？手动输入密钥':'Cannot scan? Enter the secret manually'}</summary><code className="browser-auth-secret">{setup.secret}</code></details><h2>{zh?'2. 输入验证码，确认绑定':'2. Verify to finish enrollment'}</h2></section>}
      {(setup||action)&&<form className="browser-auth-stack" onSubmit={e=>{e.preventDefault();void perform(()=>finish(setup?'/security/confirm':`/security/${action}`));}}>
        {action&&<p>{action==='disable'?(zh?'关闭二步验证会降低账号保护，请输入当前验证码确认。':'Disabling two-step verification reduces protection. Confirm with your current code.'):(zh?'重新生成后，所有旧恢复码立即失效。':'Generating a new set immediately invalidates every old recovery code.')}</p>}
        <label>{recovery&&!setup?(zh?'恢复码':'Recovery code'):(zh?'6 位验证码':'Six-digit code')}<input className="gate-input" aria-label="Verification code" value={code} onChange={e=>setCode(e.target.value)} autoComplete="one-time-code" inputMode={recovery&&!setup?'text':'numeric'} maxLength={recovery&&!setup?39:6} required /></label>
        {action&&<label><input type="checkbox" checked={recovery} onChange={e=>{setRecovery(e.target.checked);setCode('');}}/>{zh?'使用恢复码':'Use recovery code'}</label>}
        <button className="d-btn d-btn--primary" disabled={busy||!code.trim()}>{busy?(zh?'处理中…':'Working…'):(zh?'确认':'Confirm')}</button><button type="button" className="d-btn" disabled={busy} onClick={()=>{setSetup(null);setAction(null);setCode('');setError(null);}}>{zh?'取消':'Cancel'}</button>
      </form>}
      {status.enabled&&!action&&<div className="browser-auth-stack"><p>{zh?`剩余 ${status.recovery_remaining} 个恢复码。`:`${status.recovery_remaining} recovery codes remaining.`}</p><button className="d-btn" disabled={busy} onClick={()=>{setAction('recovery-codes');setCodes([]);setRecovery(false);}}>{zh?'重新生成恢复码':'Regenerate recovery codes'}</button><button className="d-btn" disabled={busy} onClick={()=>{setAction('disable');setCodes([]);setRecovery(false);}}>{zh?'关闭二步验证':'Disable two-step verification'}</button></div>}
      <p className="browser-auth-muted">{zh?'开启、关闭或重置恢复码后，其他浏览器和已配对桌面会话会退出，需要重新登录。':'Enabling, disabling or resetting recovery codes signs out other browser and paired desktop sessions.'}</p>
    </>}
    <AuthPageFooter />
  </section></main>;
}
export function GithubAuthSetup() {
  const {locale}=useLocale();const zh=locale==='zh';
  const [key]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('key')??'');
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  useEffect(()=>{history.replaceState(null,'',location.pathname);},[]);
  return <main className="gate"><Brand/><section className="d-card browser-security"><h1>{zh?'配置 GitHub 登录':'Configure GitHub sign-in'}</h1><p>{zh?'在你的 GitHub 账号下创建一个专用登录应用。下一页由 GitHub 要求你确认；无需复制 Client Secret。':'Create a dedicated sign-in app under your GitHub account. GitHub will ask you to confirm; no Client Secret copy-pasting is needed.'}</p><p>{zh?'仅验证账号身份，不申请仓库读写权限。应用配置会直接加密保存在本服务器。':'Identity only, with no repository read/write permissions. The app configuration is encrypted on this server.'}</p>
    {!key&&<p className="banner" role="status">{zh?'请使用部署管理员提供的一次性初始化入口。普通登录不需要此步骤。':'Open the one-time setup entry provided by the administrator. Normal sign-in does not require this step.'}</p>}
    {error!==null&&<p className="banner banner--red" role="alert">{securityError(error,zh)}</p>}
    <button className="d-btn d-btn--primary" disabled={busy||!key} onClick={async()=>{setBusy(true);setError(null);try{const data=await browserAuthRequest<{action:string;manifest:Record<string,unknown>}>('/registration/start',{setup_key:key});const target=new URL(data.action);if(target.origin!=='https://github.com'||target.pathname!=='/settings/apps/new')throw new Error('invalid_setup_destination');const form=document.createElement('form');form.method='POST';form.action=target.toString();const field=document.createElement('input');field.type='hidden';field.name='manifest';field.value=JSON.stringify(data.manifest);form.appendChild(field);document.body.appendChild(form);form.submit();}catch(e){setError(e);setBusy(false);}}}>{busy?(zh?'正在前往 GitHub…':'Opening GitHub…'):(zh?'在 GitHub 创建登录应用':'Create sign-in app on GitHub')}</button><p><a href="/">{zh?'返回登录页':'Return to sign-in'}</a></p>
    <AuthPageFooter />
  </section></main>;
}
