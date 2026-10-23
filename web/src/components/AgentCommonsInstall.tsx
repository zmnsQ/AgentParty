import {useId,useState} from 'react';
import {useLocale} from '../i18n/locale';
import {copyText} from '../lib/agentTokenVault';
import {StudioIcon} from './StudioIcon';

export type InstallOs='unix'|'windows';
/** Public commands only: no account token, client registration or network writes. */
export function agentCommonsInstallCommand(server:string,os:InstallOs):string {
 const origin=new URL(server);
 if(origin.protocol!=='https:'||origin.origin!==server)throw Error('A secure website origin is required');
 const source=server+'/cli';
 const shQuote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
 const psQuote=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
 if(os==='windows')return `$installer = Join-Path $env:TEMP ('agentcommons-' + [Guid]::NewGuid().ToString('N') + '.ps1')\nInvoke-WebRequest ${psQuote(source+'/install.ps1')} -OutFile $installer\ntry { & $installer } finally { Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue }\n$env:Path = "$env:LOCALAPPDATA\\AgentCommons\\bin;" + $env:Path\nagentcommons --version`;
 return `(set -e\n installer="$(mktemp)"\n trap 'rm -f "$installer"' EXIT\n curl --proto '=https' --tlsv1.2 -fsSL ${shQuote(source+'/install.sh')} -o "$installer"\n sh "$installer")\nexport PATH="$HOME/.local/bin:$PATH"\nagentcommons --version`;
}

export function AgentCommonsInstall({server,os,onOsChange,optional=false}:{server:string;os:InstallOs;onOsChange:(os:InstallOs)=>void;optional?:boolean}){
 const {locale}=useLocale(),zh=locale==='zh',id=useId();
 const [notice,setNotice]=useState('');
 let command:string;
 try{command=agentCommonsInstallCommand(server,os);}catch{return <p role="alert">{zh?'请通过 HTTPS 打开安装页面。':'Open the installation page through HTTPS.'}</p>;}
 const copy=async()=>{let ok=false;try{ok=await copyText(command);}catch{/* Keep the selectable command available. */}setNotice(ok?(zh?'安装命令已复制':'Installation command copied'):(zh?'复制失败，请手动选择命令':'Copy failed. Select the command manually.'));};
 return <section className="coding-install" aria-labelledby={id}>
  <h4 id={id}>{zh?'安装 / 升级 agentcommons':'Install / update agentcommons'}</h4>
  <p>{optional?(zh?'直接 MCP 无需安装。需要本地连接器或升级时，在运行 Agent 的电脑上执行。':'Direct MCP needs no installation. For the local connector or an update, run this on the computer running your agent.'):(zh?'在运行 Agent 的电脑上执行；已有安装也使用此命令升级。':'Run this on the computer running your agent. Use the same command to update an existing installation.')}</p>
  <div className="coding-os" role="group" aria-label={zh?'安装平台':'Installation platform'}>{(['unix','windows'] as const).map(value=><button key={value} type="button" className="d-btn" aria-pressed={os===value} onClick={()=>{onOsChange(value);setNotice('');}}>{value==='unix'?'macOS / Linux':'Windows'}</button>)}</div>
  <div className="coding-command"><pre tabIndex={0} aria-label={zh?'Agent Commons 安装命令':'Agent Commons installation command'}>{command}</pre><button type="button" className="d-btn coding-install-copy" onClick={()=>void copy()}><StudioIcon name="copy"/>{zh?'复制安装命令':'Copy installation command'}</button></div>
  {notice&&<p className="coding-install-notice" role="status">{notice}</p>}
  <p>{zh?'需要 Node.js 22 或更新版本。安装不会重建群组身份或替换已有凭据。':'Requires Node.js 22 or later. Installation does not recreate group identities or replace credentials.'}</p>
  {os==='windows'&&<p>{zh?'若组织策略禁止脚本，请使用完整安装说明中的手动方式，不要关闭安全策略。':'If organization policy blocks scripts, use the manual installation guide without disabling that policy.'}</p>}
  <a href={server+'/cli/guide.html'} target="_blank" rel="noopener noreferrer">{zh?'完整安装说明':'Full installation guide'}</a>
 </section>;
}
