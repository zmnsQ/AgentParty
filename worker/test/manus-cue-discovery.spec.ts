import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { fetchMock } from "./fetch-mock";
import { api, createChannel, seedToken, uniq } from "./helpers";

const KEY="synthetic-test-cue-api-credential";
beforeEach(()=>{fetchMock.activate();fetchMock.disableNetConnect();});
afterEach(()=>{try{fetchMock.assertNoPendingInterceptors();}finally{fetchMock.deactivate();}});
describe("Manus/Cue existing personal agent discovery",()=>{
  it("human group owner discovers Cue agents via official agent.list without returning/storing API key",async()=>{
    const owner=await seedToken("human",uniq("cue-owner"),{owner:uniq("account")});
    const slug=await createChannel(owner.token);
    const path=`/api/channels/${slug}/bridges/manus/discover`;
    fetchMock.get("https://api.manus.ai").intercept({path:"/v2/agent.list",method:"GET"}).reply(200,(req)=>{
      expect(req.headers["x-manus-api-key"]).toBe(KEY);
      expect(req.headers.authorization).toBeUndefined();
      return {ok:true,data:[{id:"existing-cue-1",nickname:"My real Cue",task_id:"persistent-task-1"}]};
    });
    const res=await api(path,owner.token,{method:"POST",body:JSON.stringify({credential:KEY})});
    expect(res.status).toBe(200);
    const text=await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({agents:[{id:"existing-cue-1",name:"My real Cue",conversation_id:"persistent-task-1"}],requires_api_key:true});
    const agent=await seedToken("agent",uniq("forbidden"),{owner:uniq("different-account"),channelScope:slug});
    expect((await api(path,agent.token,{method:"POST",body:JSON.stringify({credential:KEY})})).status).toBe(403);
    const outsider=await seedToken("human",uniq("outside"),{owner:uniq("different-account")});
    expect((await api(path,outsider.token,{method:"POST",body:JSON.stringify({credential:KEY})})).status).toBe(403);
  });
});
