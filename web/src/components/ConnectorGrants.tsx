import { useEffect, useState } from "react";
import { useLocale } from "../i18n/locale";
import { isTauriEnvironment } from "../lib/desktopUpdater";

interface Grant { id:string;group:string;agent_name:string;client_name:string;scopes:string[];updated_at:number; }
export function ConnectorGrants() {
  const {locale}=useLocale(),zh=locale==="zh";
  const [grants,setGrants]=useState<Grant[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{
    if(isTauriEnvironment()){setLoading(false);return;}
    const controller=new AbortController();
    void fetch("/oauth/grants",{credentials:"same-origin",signal:controller.signal,cache:"no-store"})
      .then(async r=>{if(!r.ok)throw new Error("not_authenticated");return r.json() as Promise<{connections:Grant[]}>;})
      .then(data=>{if(!controller.signal.aborted)setGrants(data.connections);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"unknown_error");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[]);
  if(isTauriEnvironment())return null;
  const revoke=async(grant:Grant)=>{
    if(!confirm(zh?`撤销 ${grant.client_name} 对 ${grant.group} 的连接？`:
      `Revoke ${grant.client_name}'s connection to ${grant.group}?`))return;
    setBusy(grant.id);setError(null);
    try {
      const result=await fetch("/oauth/grants/revoke",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({grant_id:grant.id}),
      });
      if(!result.ok)throw new Error("revoke_failed");
      setGrants(current=>current.filter(item=>item.id!==grant.id));
    }catch(e){setError(e instanceof Error?e.message:"revoke_failed");}
    finally{setBusy(null);}
  };
  return <section className="cloud-bridge-card" aria-label={zh?"已授权的云端插件":"Authorized cloud plugins"}>
    <h3>{zh?"已授权的云端插件":"Authorized cloud plugins"}</h3>
    <p>{zh?"GitHub 登录后，可查看每个群授予 ChatGPT dot、Muse 或其他连接器的权限，并随时撤销。":"Once signed in with GitHub, review each plugin's group permissions and revoke a connector at any time."}</p>
    {loading?<p role="status">{zh?"正在读取连接…":"Loading connections…"}</p>:null}
    {error&&<p role="alert" className="commons-error">{error}</p>}
    {!loading&&!error&&grants.length===0&&<p>{zh?"暂无授权连接":"No authorized connectors"}</p>}
    {grants.map(grant=><div className="cloud-bridge-grant" key={grant.id}>
      <p><strong>{grant.client_name}</strong> · #{grant.group}</p>
      <small>{grant.scopes.join(", ")} · {grant.agent_name}</small>
      <button type="button" className="d-btn" disabled={busy!==null} onClick={()=>void revoke(grant)}>
        {zh?"撤销连接":"Revoke connection"}</button>
    </div>)}
  </section>;
}
