import { describe, expect, test } from "bun:test";
import { publishMuseAnswer, runMuseCode } from "./bridge.js";
import type { spawnMspConnection } from "@muse-code/sdk";

function fakeHost(terminal = "completed") {
  let notification: ((x:{method:string;params:Record<string,unknown>})=>void)|undefined;
  let closeCount=0;
  const commands:string[]=[];
  const fake=(() => ({
    initialize: async () => ({
      connection: {
        onNotification: (fn:typeof notification)=>{notification=fn;},
        command: async (method:string,args:Record<string,unknown>)=>{
          commands.push(method);
          if(method==="session/start")return {session:{sessionId:"muse-session-1"}};
          if(method==="session/resume")return {session:{sessionId:args.sessionId}};
          if(method==="turn/start"){
            queueMicrotask(()=>{
              notification?.({method:"item/completed",params:{item:{kind:"agentMessage",status:"completed",messagePhase:"commentary",text:"private commentary"}}});
              notification?.({method:"item/completed",params:{item:{kind:"agentMessage",status:"completed",messagePhase:"finalAnswer",text:"Reviewed file safely"}}});
              notification?.({method:"turn/completed",params:{turnId:"muse-turn-1",terminal}});
            });
            return {disposition:"started",turnId:"muse-turn-1"};
          }
          throw new Error("unexpected command");
        },
      },
      close:async()=>{closeCount++;},
    }),
  })) as unknown as typeof spawnMspConnection;
  return {fake,commands,closeCount:()=>closeCount};
}
const input={bin:"/opt/bin/muse",workspace:"/safe/project",prompt:"Review the README",requestId:"review-123"};
describe("official Muse Code MSP bridge",()=>{
  test("calls the real SDK's session and turn contracts, returns only final answer and closes host",async()=>{
    const stub=fakeHost();
    const out=await runMuseCode(input,stub.fake);
    expect(out).toEqual({status:"completed",sessionId:"muse-session-1",turnId:"muse-turn-1",answer:"Reviewed file safely"});
    expect(stub.commands).toEqual(["session/start","turn/start"]);
    expect(stub.closeCount()).toBe(1);
  });
  test("resumes an explicitly selected existing SDK session without creating another one",async()=>{
    const stub=fakeHost();
    const out=await runMuseCode({...input,sessionId:"previous-session"},stub.fake);
    expect(out.sessionId).toBe("previous-session");
    expect(stub.commands).toEqual(["session/resume","turn/start"]);
  });
  test("refuses a failed/approval-required turn instead of auto-approving or inventing a reply",async()=>{
    const stub=fakeHost("approval_required");
    await expect(runMuseCode(input,stub.fake)).rejects.toThrow("muse_turn_approval_required");
    expect(stub.closeCount()).toBe(1);
  });
  test("never starts a binary for a malformed task",async()=>{
    const stub=fakeHost();
    await expect(runMuseCode({...input,bin:"muse"},stub.fake)).rejects.toThrow("invalid_muse_task");
    expect(stub.commands).toEqual([]);
  });
  test("posts only completed results as the scoped agent, with a stable idempotency key",async()=>{
    const payloads:unknown[]=[];
    const fetcher=(async(_url: string|URL|Request,options?:RequestInit)=>{
      const data=JSON.parse(String(options?.body));
      payloads.push(data);
      expect(options?.headers).toMatchObject({authorization:"Bearer ap_agent_fixture"});
      return Response.json({seq:123});
    }) as typeof fetch;
    const out=await publishMuseAnswer({
      server:"https://commons.example",group:"dev",token:"ap_agent_fixture",requestId:"request-01",replyTo:42
    },{status:"completed",sessionId:"session",turnId:"turn",answer:"Review completed"},fetcher);
    expect(out.seq).toBe(123);
    expect(payloads).toEqual([{kind:"message",body:"Review completed",mentions:[],reply_to:42,idempotency_key:"muse-code:request-01"}]);
  });
  test("does not expose a provider response body when group posting fails",async()=>{
    await expect(publishMuseAnswer({
      server:"https://commons.example",group:"dev",token:"ap_agent_fixture",requestId:"abc"
    },{status:"completed",sessionId:"s",turnId:"t",answer:"secret chat"},async()=>new Response("secret-provider-response",{status:403})))
      .rejects.toThrow("muse_group_delivery_unconfirmed");
  });
});
