import {useEffect,useRef,useState} from 'react';
import {fetchChannelAgentAccess,restoreChannelAgent,type ChannelAgentInfo} from '../lib/api';
import {useLocale} from '../i18n/locale';
import {apiOrigin} from '../lib/base';

/** Explicit moderator action, with readback before any retry. Never issues credentials. */
export function RemovedAgentAccess({agent,token,slug,onRestored,onBusyChange}:{agent:ChannelAgentInfo;token:string;slug:string;onRestored():void|Promise<void>;onBusyChange?(busy:boolean):void}){
 const {locale}=useLocale(),zh=locale==='zh';
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const pending=useRef<number|null>(null),epoch=useRef(0),key=JSON.stringify([token,slug,agent.name,agent.owner,apiOrigin()]);
 const scope=useRef(key);if(scope.current!==key){scope.current=key;epoch.current++;}
 useEffect(()=>{pending.current=null;setBusy(false);setError('');setUncertain(false);},[key]);
 useEffect(()=>()=>{epoch.current++;},[]);
 async function restore(){
  if(pending.current!==null)return;
  pending.current=epoch.current;setBusy(true);onBusyChange?.(true);setError('');
  const version=epoch.current,origin=apiOrigin(),active=()=>version===epoch.current&&origin===apiOrigin();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  const read=async()=>{
   const row=await fetchChannelAgentAccess(token,slug,agent.name,controller.signal);
   if(row.name!==agent.name||row.owner!==agent.owner||row.channel_scope!==slug)throw Error('Identity changed');
   return row;
  };
  try{
   const current=await read();if(!active())return;
   if(current.access_status==='active'){setUncertain(false);await onRestored();return;}
   // After an uncertain write, this click only reads status. A later explicit
   // click and fresh confirmation are required before another restore request.
   if(uncertain){setUncertain(false);setError(zh?'已核对：仍被移除。可再次明确确认恢复。':'Checked: still removed. Confirm explicitly again to restore.');return;}
   if(!current.can_restore||!current.removal_epoch){setError(zh?'请让有权限的群管理员恢复这个身份；此处不能解除账户移除或封禁。':'Ask an authorized moderator to restore this identity; account removal or bans cannot be cleared here.');return;}
   if(!window.confirm(zh?`将群 ${slug} 中的 Agent 身份 ${agent.name}（所属账号 ${agent.owner}）恢复？仅恢复这一个身份，不恢复其他成员、解除账户封禁或创建/轮换 Token。`:`Restore Agent ${agent.name} (owner ${agent.owner}) in group ${slug}? Only this identity is restored; no other members, account bans or credentials are changed.`))return;
   try{await restoreChannelAgent(token,slug,agent.name,current.removal_epoch,controller.signal,agent.owner);}catch{/* Read back even if the response was lost. */}
   const result=await read();if(!active())return;
   if(result.access_status==='active'){setUncertain(false);await onRestored();}
   else setError(zh?'恢复未完成。已核对仍被移除，请检查权限或重新确认；不会自动重试。':'Restoration did not complete. Readback still shows removal; review permission or confirm again. No automatic retry.');
  }catch{if(active()){setUncertain(true);setError(zh?'暂时无法确认恢复状态。请先核对状态，不要重复提交恢复或创建凭据。':'Restoration status is unknown. Recheck status before submitting another restore or creating credentials.');}}
  finally{clearTimeout(timer);if(pending.current===version)pending.current=null;if(active()){setBusy(false);onBusyChange?.(false);}}
 }
 return <section className="agentmanager-detail-section agentmanager-callout agent-access-recovery" role="status">
  <strong>{zh?'恢复此身份':'Restore this identity'}</strong>
  <p>{zh?`身份：${agent.name}；频道：${slug}`:`Identity: ${agent.name}; group: ${slug}`}</p>
  <p>{zh?'凭据可能仍存在，但这个身份已被移出本群。重新生成 Token 不会恢复成员资格。':'A credential may still exist, but this identity was removed from this group. Regenerating a token does not restore membership.'}</p>
  {agent.can_restore&&agent.removal_epoch?<button className="d-btn" type="button" disabled={busy} onClick={()=>void restore()}>{busy?(zh?'正在核对…':'Checking…'):uncertain?(zh?'核对恢复状态':'Recheck restoration status'):(zh?'确认重新加入此 Agent':'Re-add this Agent')}</button>:<p>{zh?'请让群管理员明确重新加入；此处不会自动解除移除或封禁。':'Ask a group moderator to explicitly re-add it. Removal or bans are never cleared automatically.'}</p>}
  {agent.credential_revoked&&<p>{zh?'旧凭据已撤销。恢复后仍需你再次点击创建，旧 Token 不会复活。':'The old credential is revoked. Click Create separately after restoration; the old token will not be revived.'}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
