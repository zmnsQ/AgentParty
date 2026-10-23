import {afterEach,describe,expect,test} from "bun:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EXIT_ARCHIVED,type MsgFrame} from "@agentparty/shared";
import {runServe} from "../src/commands/serve";
import {startMockServer,msgFrame,welcomeFrame,type MockServer} from "./mock-server";
let server:MockServer|null=null;const dirs:string[]=[];
afterEach(()=>{server?.stop();server=null;for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});

describe("cloud-planner to coding-runner handoff",()=>{
  for(const executor of ["developer-codex","reviewer-claude"]){
    test(`${executor}: an explicit mention from a different agent reaches the existing runner exactly once`,async()=>{
      const cloud="ac-oauth-cloud-planner",seen:MsgFrame[]=[];
      const approved=msgFrame(1,"Implement the approved task in the project workspace; report tests.",{
        sender:{name:cloud,kind:"agent"},mentions:[executor],reply_to:7,
      });
      server=startMockServer((frame,sock)=>{
        if(frame.type!=="hello")return;
        sock.send(welcomeFrame(0,executor));
        setTimeout(()=>sock.send(approved),15);
        setTimeout(()=>sock.send(approved),35);
        setTimeout(()=>sock.send(msgFrame(2,"Discussion without assigning this runner",{sender:{name:cloud,kind:"agent"}})),45);
        setTimeout(()=>sock.send(msgFrame(3,"My own reply must not cause another run",{sender:{name:executor,kind:"agent"},mentions:[executor]})),65);
        setTimeout(()=>sock.send({type:"error",code:"archived",message:"fixture complete"}),110);
      });
      const lockDir=mkdtempSync(join(tmpdir(),"ap-mixed-handoff-"));dirs.push(lockDir);
      const result=await runServe({server:server.url,token:"ap_synthetic",channel:"dev",since:0,cmd:"",
        mentionsOnly:true,lockDir,out:()=>{},runCommand:async(frame,ctx)=>{
          expect(ctx.self).toBe(executor);seen.push(frame);
        }});
      expect(result).toBe(EXIT_ARCHIVED);expect(seen).toHaveLength(1);
      expect(seen[0]!.sender).toMatchObject({kind:"agent",name:cloud});
      expect(seen[0]!.mentions).toEqual([executor]);expect(seen[0]!.reply_to).toBe(7);
    });
  }
});
