import {useEffect,useRef,useState} from 'react';
import {restoreChannelAgent,type ChannelAgentInfo} from '../lib/api';
import {useLocale} from '../i18n/locale';
import {apiOrigin} from '../lib/base';

/** Explicit moderator action; never coupled to token issuance or rotation. */
export function RemovedAgentAccess({agent,token,slug,onRestored}:{agent:ChannelAgentInfo;token:string;slug:string;onRestored():void|Promise<void>}){
 const {locale}=useLocale(),zh=locale==='zh';
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),epoch=useRef(0),key=JSON.stringify([token,slug,agent.name,agent.owner,apiOrigin()]);
 const scope=useRef(key);if(scope.current!==key){scope.current=key;epoch.current++;}
 useEffect(()=>{setBusy(false);setError('');},[key]);
 useEffect(()=>()=>{epoch.current++;},[]);
 async function restore(){
  if(pending.current||!agent.can_restore||!agent.removal_epoch)return;
  if(!window.confirm(zh?`仅允许 ${agent.nickname??agent.name} 这个 Agent 身份重新加入本群？不会恢复其他身份、解除账号封禁、复活已撤销 Token 或修改 MCP 权限。`:`Re-add only the Agent identity ${agent.nickname??agent.name} to this group? This does not restore other identities, clear account bans, revive revoked tokens, or change MCP permissions.`))return;
  pending.current=true;setBusy(true);setError('');const version=epoch.current,origin=apiOrigin();
  const active=()=>version===epoch.current&&origin===apiOrigin();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  try{await restoreChannelAgent(token,slug,agent.name,agent.removal_epoch,controller.signal);if(active())await onRestored();}
  catch{if(active())setError(zh?'重新加入未完成。请刷新核对成员状态；权限或身份归属不符合时不会恢复，也不要轮换 Token 代替。':'Re-adding was not confirmed. Refresh membership status; insufficient permission or identity ownership does not restore access. Do not rotate a token instead.');}
  finally{clearTimeout(timer);pending.current=false;if(active())setBusy(false);}
 }
 return <section className="agentmanager-detail-section agentmanager-callout" role="status">
  <strong>{zh?'已被移出本群':'Removed from this group'}</strong>
  <p>{zh?'凭据可能仍存在，但这个身份不能访问本群。重新生成 Token 不会恢复成员资格。':'A credential may still exist, but this identity cannot access this group. Regenerating a token does not restore membership.'}</p>
  {agent.can_restore&&agent.removal_epoch?<button className="d-btn" type="button" disabled={busy} onClick={()=>void restore()}>{busy?(zh?'正在重新加入…':'Re-adding…'):(zh?'确认重新加入此 Agent':'Re-add this Agent')}</button>:<p>{zh?'请让群管理员明确重新加入；此处不会自动解除移除或封禁。':'Ask a group moderator to explicitly re-add it. Removal or bans are never cleared automatically.'}</p>}
  {agent.credential_revoked&&<p>{zh?'旧凭据已撤销。恢复成员资格后仍需另行创建凭据，旧 Token 不会复活。':'The old credential is revoked. After membership is restored, create a credential separately; the old token will not be revived.'}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
