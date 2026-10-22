import { AuthError, ForbiddenError } from "./api";
import { apiUrl } from "./base";

export interface GrokAutomationConnection { name:string; configured:true; configured_at:number; }
export interface GrokDelivery {
  id:string; request_id:string; state:"submitting"|"submitted"|"rejected"|"unknown";
  error:string|null; created_at:number;updated_at:number;
}
export interface GrokBridgeState {
  connection:GrokAutomationConnection|null;deliveries:GrokDelivery[];
  mode:"grok-automation-webhook";personal_bot_direct_api:false;automatic_result_import:false;
}
export interface CueAgent { id:string; name:string; conversation_id:string|null; }
export interface EventBridgeState {active_subscriptions:number;pending_deliveries:number;}
export interface McpPolicy {enabled:boolean;allow_write:boolean;allow_events:boolean;owner_mfa_enabled:boolean;require_mfa:true;updated_at:number|null;}
export interface McpPolicyResponse {policy:McpPolicy;can_manage:boolean;}

async function request<T>(token:string,path:string,method="GET",body?:unknown,signal?:AbortSignal):Promise<T>{
  const r=await fetch(apiUrl(path),{method,signal:signal??AbortSignal.timeout(20_000),
    headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{"content-type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value:unknown=await r.json().catch(()=>null);
  if(!r.ok){
    const error=(value as {error?:{code?:unknown;message?:unknown}}|null)?.error;
    const code=typeof error?.code==="string"?error.code:"operation_failed";
    if(r.status===401)throw new AuthError("Session expired");
    if(r.status===403)throw new ForbiddenError("Not allowed",code);
    throw new Error(code);
  }
  return value as T;
}
const root=(slug:string)=>`/api/channels/${encodeURIComponent(slug)}/bridges`;
export const cloudBridgesApi={
  security: (token:string,slug:string,signal?:AbortSignal)=>request<McpPolicyResponse>(token,`/api/channels/${encodeURIComponent(slug)}/mcp-security`,"GET",undefined,signal),
  saveSecurity: (token:string,slug:string,input:Pick<McpPolicy,"enabled"|"allow_write"|"allow_events">)=>request<McpPolicyResponse>(token,`/api/channels/${encodeURIComponent(slug)}/mcp-security`,"PUT",input),
  grok: (token:string,slug:string,signal?:AbortSignal)=>request<GrokBridgeState>(token,`${root(slug)}/grok-automation`,"GET",undefined,signal),
  connectGrok: (token:string,slug:string,input:{name:string;endpoint:string;signing_secret:string})=>
    request<{configured:boolean}>(token,`${root(slug)}/grok-automation`,"PUT",input),
  disconnectGrok: (token:string,slug:string)=>request<{removed:boolean}>(token,`${root(slug)}/grok-automation`,"DELETE"),
  sendToGrok: (token:string,slug:string,input:{prompt:string;request_id:string})=>
    request<{delivery:GrokDelivery;reused:boolean;completion_confirmed:boolean}>(token,`${root(slug)}/grok-automation/dispatch`,"POST",input),
  cue: (token:string,slug:string,credential:string)=>request<{agents:CueAgent[];requires_api_key:true}>(
    token,`${root(slug)}/manus/discover`,"POST",{credential}),
  events: (token:string,slug:string,signal?:AbortSignal)=>request<EventBridgeState>(
    token,`${root(slug)}/events/status`,"GET",undefined,signal),
  flushEvents: (token:string,slug:string)=>request<{attempted:number;delivered:number}>(
    token,`${root(slug)}/events/flush`,"POST",{}),
};
