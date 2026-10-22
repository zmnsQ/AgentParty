import {describe,expect,it} from "vitest";
import {api,createChannel,seedToken,uniq} from "./helpers";
import {enableMcpFixture} from "./mcp-test-helpers";

/** Real D1/DO HTTP paths, synthetic identities; no real model calls or user data. */
describe("cloud and coding identities coexist in one private group",()=>{
  it("keeps the cloud sender, exact coding target, task reference and dedupe key through MCP and reply",async()=>{
    const account=uniq("mixed-owner");
    const owner=await seedToken("human",uniq("owner"),{owner:account});
    const slug=await createChannel(owner.token);await enableMcpFixture(slug,account);
    const planner=await seedToken("agent",uniq("cloud-planner"),{owner:account,channelScope:slug});
    const executor=await seedToken("agent",uniq("codex"),{owner:account,channelScope:slug});
    const approval=await api(`/api/channels/${slug}/messages`,owner.token,{method:"POST",body:JSON.stringify({
      kind:"message",body:"Approved: update documentation only; no deployment.",mentions:[],reply_to:null,
    })});
    expect(approval.status).toBe(200);const approvalSeq=(await approval.json() as {seq:number}).seq;
    const args={body:"Please implement this approved documentation task and report the result.",
      idempotency_key:uniq("handoff"),reply_to:approvalSeq,mentions:[executor.name]};
    const call=()=>api(`/api/channels/${slug}/mcp`,planner.token,{method:"POST",body:JSON.stringify({
      jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"party_send_message",arguments:args},
    })});
    const response=await call();expect(response.status).toBe(200);
    const data=await response.json() as any;expect(data.result.isError).toBe(false);
    const seq=data.result.structuredContent.seq as number;expect(seq).toBeGreaterThan(approvalSeq);
    const retry=await(await call()).json() as any;expect(retry.result.structuredContent.seq).toBe(seq);
    const read=await api(`/api/channels/${slug}/messages?after=${approvalSeq}`,executor.token);
    expect(read.status).toBe(200);
    const messages=(await read.json() as any).messages;
    const assignment=messages.find((m:any)=>m.seq===seq);
    expect(assignment).toMatchObject({sender:{kind:"agent",name:planner.name},mentions:[executor.name],reply_to:approvalSeq});
    expect(messages.filter((m:any)=>m.seq===seq)).toHaveLength(1);
    const reply=await api(`/api/channels/${slug}/messages`,executor.token,{method:"POST",body:JSON.stringify({
      kind:"message",body:"Documentation updated; checks passed. No deployment performed.",mentions:[],reply_to:seq,idempotency_key:uniq("result"),
    })});expect(reply.status).toBe(200);
    const resultSeq=(await reply.json() as {seq:number}).seq;
    const review=await api(`/api/channels/${slug}/messages?after=${seq}`,planner.token);
    expect((await review.json() as any).messages).toContainEqual(expect.objectContaining({
      seq:resultSeq,sender:expect.objectContaining({name:executor.name}),reply_to:seq,
    }));
    // Knowing another group ID does not turn the same credential into a global executor.
    const other=await createChannel(owner.token);
    const blocked=await api(`/api/channels/${other}/messages`,planner.token);
    expect(blocked.status).toBe(403);
  });
});
