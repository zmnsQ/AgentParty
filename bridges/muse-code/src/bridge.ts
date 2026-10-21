import { spawnMspConnection } from "@muse-code/sdk";
type MuseSpawn = typeof spawnMspConnection;

export interface MuseCodeTask {
  bin: string; workspace: string; prompt: string; requestId: string;
  /** A pre-existing session can be resumed by the official MSP host. */
  sessionId?: string;
  timeoutMs?: number;
}
export interface MuseCodeAnswer {
  sessionId: string;
  turnId: string;
  answer: string;
  /** Nothing is published unless the real host confirmed completion. */
  status: "completed";
}
const KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CLIENT={name:"agent-commons-muse-bridge",version:"0.1.0"};
function text(value:unknown,label:string): string {
  if (typeof value !== "string" || !value) throw new Error("invalid_"+label);
  return value;
}
function record(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("unexpected_muse_response");
  return value as Record<string,unknown>;
}
function bounded<T>(task:Promise<T>, ms:number, message:string):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  return Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})])
    .finally(()=>clearTimeout(timer));
}
/**
 * Official @muse-code/sdk / MSP host protocol: session/start, turn/start, item
 * completed and turn/completed. No approval is granted automatically.
 */
export async function runMuseCode(task:MuseCodeTask, spawn:MuseSpawn=spawnMspConnection):Promise<MuseCodeAnswer> {
  if (!task.bin.startsWith("/") || !task.workspace.startsWith("/") || !KEY.test(task.requestId) ||
    !task.prompt.trim() || task.prompt.length>20_000) throw new Error("invalid_muse_task");
  const ms=task.timeoutMs ?? 600_000;
  if (!Number.isInteger(ms) || ms<1_000 || ms>3_600_000) throw new Error("invalid_timeout");
  const stderr:string[]=[];
  const host=spawn({command:task.bin,args:["serve"],cwd:task.workspace,
    env:{...process.env,MUSE_EXPERIMENTAL_SDK_ENABLED:"on"},
    onStderr:(chunk)=>{if(stderr.join("").length<2048)stderr.push(chunk);},shutdownTimeoutMs:30_000});
  let msp:Awaited<ReturnType<typeof host.initialize>>|undefined;
  try {
    msp=await bounded(host.initialize({clientInfo:CLIENT}),30_000,"muse_handshake_timeout");
    const result= task.sessionId
      ? await bounded(msp.connection.command("session/resume",{sessionId:task.sessionId},{maxAttempts:1}),30_000,"muse_resume_timeout")
      : await bounded(msp.connection.command("session/start",{workspaceRoot:task.workspace},{maxAttempts:1}),30_000,"muse_session_timeout");
    const session=text(task.sessionId??record(result.session).sessionId,"session_id");
    const messages:string[]=[];
    let finish!:(value:{terminal:string})=>void;
    const ended=new Promise<{terminal:string}>(resolve=>{finish=resolve;});
    const eventBuffer:Array<{method:string;params:Record<string,unknown>}>=[];
    let startedId:string|undefined;
    msp.connection.onNotification(notification=>{
      const params=record(notification.params??{});
      if (!startedId){eventBuffer.push({method:notification.method,params});return;}
      if (notification.method==="item/completed"){
        const item=record(params.item);
        if(item.kind==="agentMessage"&&item.status==="completed"&&item.messagePhase!=="commentary"&&typeof item.text==="string")
          messages.push(item.text);
      }
      if(notification.method==="turn/completed"&&params.turnId===startedId)
        finish({terminal:String(params.terminal)});
    });
    const ack=await bounded(msp.connection.command("turn/start",{
      sessionId:session,input:[{type:"text",text:task.prompt}]
    },{maxAttempts:1}),30_000,"muse_start_timeout");
    if(!["started","queued"].includes(String(ack.disposition))) throw new Error("muse_turn_not_started");
    startedId=text(ack.turnId,"turn_id");
    for(const event of eventBuffer){
      if(event.method==="item/completed"){
        const item=record(event.params.item);
        if(item.kind==="agentMessage"&&item.status==="completed"&&item.messagePhase!=="commentary"&&typeof item.text==="string")
          messages.push(item.text);
      }
      if(event.method==="turn/completed"&&event.params.turnId===startedId) finish({terminal:String(event.params.terminal)});
    }
    const done=await bounded(ended,ms,"muse_turn_timeout");
    if(done.terminal!=="completed") throw new Error("muse_turn_"+done.terminal.replace(/[^a-z_]/g,""));
    const answer=messages.join("\n\n").trim();
    if(!answer) throw new Error("muse_no_final_answer");
    return {sessionId:session,turnId:startedId,answer,status:"completed"};
  } finally {
    // The official SDK owns process lifecycle. Never leave the child running
    // unattended after a local task/approval timeout or bridge exit.
    if(msp) await msp.close().catch(()=>undefined);
  }
}
export async function publishMuseAnswer(
  task:{server:string;group:string;token:string;requestId:string;replyTo?:number},
  answer:MuseCodeAnswer, fetcher:typeof fetch=fetch,
):Promise<{seq:number}> {
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(task.server) || !KEY.test(task.requestId) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(task.group) || !task.token.startsWith("ap_"))
    throw new Error("invalid_group_destination");
  const body={kind:"message",body:answer.answer,mentions:[],reply_to:task.replyTo??null,
    idempotency_key:"muse-code:"+task.requestId};
  const response=await fetcher(`${task.server}/api/channels/${encodeURIComponent(task.group)}/messages`,{
    method:"POST",redirect:"manual",
    headers:{authorization:`Bearer ${task.token}`,"content-type":"application/json"},
    body:JSON.stringify(body),
  });
  if(!response.ok) throw new Error("muse_group_delivery_unconfirmed");
  const receipt:unknown=await response.json();
  const seq=record(receipt).seq;
  if(typeof seq!=="number"||!Number.isSafeInteger(seq)||seq<1) throw new Error("muse_group_delivery_unconfirmed");
  return {seq};
}
