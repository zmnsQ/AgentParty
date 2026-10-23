/** Local-only synthetic UI service. No upstream calls, credentials or persistence.
 * bun scripts/web-ui-fixture.ts; cd web && COMMONS_API_PROXY=http://127.0.0.1:18951 bun run dev */
import {PERSONAL_AGENT_PROVIDERS} from "../shared/src/collaboration";
const now = Date.now();
const people = [{name:"studio-owner",display_name:"林舟",kind:"human",handle:"linzhou"},{name:"design-agent",display_name:"设计助手",kind:"agent",owner:"studio-owner"},{name:"code-agent",display_name:"开发助手",kind:"agent",owner:"studio-owner"}];
const presence = people.map((p,i)=>({...p,state:i===2?"working":"idle",last_seen:now,connected_at:now,account:"local-review"}));
const messages = [
 "这次把 Web 和移动端的体验统一起来。导航可以收起，让对话成为工作区的中心。",
 "我整理了视觉方向：暖白底色、陶土色强调，以及更清楚的文字层次。任务、文件和连接入口放在工具区，需要时展开。",
 "已完成公共组件和布局调整。接下来检查窄屏、键盘操作与减少动态效果设置。\n\n- 工作区导航保留折叠偏好\n- 授权、事件订阅和在线状态分别展示\n- 重要错误始终可见",
 "很好。也请保留长文本和附件的阅读空间，先把本地验收做完整。"
].map((body,i)=>({type:"msg",seq:i+1,sender:people[i===3?0:i],kind:"message",body,mentions:[],reply_to:null,state:null,note:null,status:null,ts:now-(4-i)*60000}));
const channels = ["一起打磨工作区","产品与设计","发布准备"].map((title,i)=>({slug:`local-group-${i+1}`,title,topic:["让对话、任务和成果井然有序。","从想法到可以使用的体验。","记录检查结果与下一步。 "][i],kind:"standing",mode:"normal",visibility:"private",can_moderate:true,owned:true,member:true,created_at:now,archived_at:null,last_message:{...messages[2],sender:"开发助手"},presence}));
const tasks = ["统一 Web 与移动端视觉","检查窄屏和键盘操作","整理本地验收记录"].map((title,i)=>({type:"task",id:i+1,channel:channels[0].slug,title,desc:"本地合成任务，仅用于界面验证。",state:["done","in_progress","needs_review"][i],assignee:{name:people[i===0?1:2].name,kind:"agent"},created_by:people[0].name,created_by_kind:"human",priority:1,labels:["界面"],parent_id:null,anchor_seqs:[2],scope:[],blocked_reason:null,external_ref:null,completion_artifact:null,workflow_id:null,created_at:now,updated_at:now,completed_at:i===0?now:null}));
const summary = {type:"task_summary",channel:channels[0].slug,total:3,open:2,triage:0,backlog:0,assigned:0,in_progress:1,needs_review:1,blocked:0,done:1,mine:0};
const repository = {id:"local-repo",channel:channels[0].slug,full_name:"local-review/workspace",html_url:"https://example.invalid/local-review/workspace",base_branch:"main",private:true,credential_configured:false,created_at:now};
const proposal = {id:"local-proposal",repository_id:repository.id,channel:channels[0].slug,title:"统一工作区导航与公共样式",description:"本地合成提案，用于验证变更阅读与人工审批入口。",base_sha:"a".repeat(40),base_branch:"main",digest:"b".repeat(64),state:"proposed",created_by:"code-agent",approved_by:null,file_count:1,branch:null,commit_sha:null,pull_request_url:null,pull_request_number:null,error:null,created_at:now,updated_at:now};
const oauthAgents = [{name:"chatgpt-local",nickname:"ChatGPT · 本地合成授权",owner:"local-review",channel_scope:channels[0].slug,created_at:now,credential_kind:"oauth",oauth:{client_name:"ChatGPT",provider:"chatgpt",status:"authorized",scopes:["group.read","group.write"]}}];
function json(value:unknown,status=200){return Response.json(value,{status});}
Bun.serve({hostname:"127.0.0.1",port:18951,fetch(req,server){
 const u=new URL(req.url),p=u.pathname;
 if(p.endsWith("/ws") && server.upgrade(req)) return;
 if(req.method!=="GET") return json({error:{code:"fixture_read_only",message:"本地预览不执行外部操作。"}},403);
 if(p==="/api/version") return json({version:"0.0.0-local-review"});
 if(p==="/oauth/grants") return json({connections:[]});
 if(p==="/api/config") return json({providers:[],oidc:null});
 if(p==="/api/auth/github/session") return json({configured:true,status:"signed_out"});
 if(p==="/api/me") return json({...people[0],name:people[0].name,display_name:"本地界面验收",email:null,avatar_url:null,avatar_thumb:null,provider:"github",tenant_key:null,role:"human",owner:"local-review",caps:{send:true,create_channel:true,mint_agents:true,scoped_to:null}});
 if(p==="/api/channels") return json({channels});
 if(p.endsWith("/messages")) return json({messages});
 if(p.endsWith("/tasks/summary")) return json(summary);
 if(p.endsWith("/tasks")) return json({tasks});
 if(p.endsWith("/identities")) return json({identities:people.map(p=>({...p,display:p.display_name,account:"local-review"}))});
 if(p.endsWith("/presence")) return json({presence});
 if(p.endsWith("/pending-decisions")) return json({decisions:[],next_after:null});
 if(p.endsWith("/charter")) return json({charter:"先聚焦对话，再按需展开任务与协作工具。",charter_rev:1,updated_at:now,updated_by:people[0].name});
 if(p.endsWith("/collaboration")) return json({providers:PERSONAL_AGENT_PROVIDERS,connections:[],repositories:[repository],permissions:{manage:true,run:true,upload:true},mcp_endpoint:"http://127.0.0.1:18951/mcp",execution:"manual-sync"});
 if(p.endsWith("/proposals/local-proposal")) return json({proposal:{...proposal,files:[{path:"src/theme.css",content:":root { --accent: #a95338; }"}],originals:[{path:"src/theme.css",content:":root { --accent: blue; }"}]}});
 if(p.endsWith("/proposals")) return json({proposals:[proposal]});
 if(p.endsWith("/pulls")) return json({repository,pulls:[]});
 if(p.endsWith("/files")) return json({files:[{key:"local-guide",filename:"工作区视觉规范.md",mime:"text/markdown",size:2840,url:"/api/channels/local-group-1/attachments/local-guide",uploaded_by:"design-agent",uploaded_at:new Date(now).toISOString(),created_at:now,shared_in:[]}],cursor:null});
 if(p.endsWith("/mcp-security")) return json({policy:{enabled:true,allow_write:true,allow_events:false,owner_mfa_enabled:true,require_mfa:true,updated_at:now},can_manage:true});
 if(p.endsWith("/grok-automation")) return json({connection:null,deliveries:[],mode:"grok-automation-webhook",personal_bot_direct_api:false,automatic_result_import:false});
 if(p.endsWith("/events/status")) return json({active_subscriptions:0,pending_deliveries:0,agents:[{agent_name:"chatgpt-local",active_subscriptions:0}],callback_policy_configured:false});
 if(p.endsWith("/roles")) return json({roles:[]});
 if(p.endsWith("/squads")) return json({squads:[]});
 if(p.endsWith("/agents")) return json({agents:oauthAgents});
 if(p.endsWith("/members")) return json({members:[]});
 if(p.endsWith("/wake-deliveries")) return json({deliveries:[]});
 if(p.includes("connector")||p.includes("mcp")) return json({connections:[],subscriptions:[],grants:[],clients:[],events:[]});
 if(req.method!=="GET") return json({error:{code:"fixture_read_only",message:"本地预览不执行外部操作。"}},403);
 return json({error:{code:"fixture_unimplemented",message:`Local fixture: ${p}`}},404);
},websocket:{open(ws){ws.send(JSON.stringify({type:"welcome",channel:channels[0].slug,self:people[0].name,role:"human",participants:people,presence,last_seq:4,last_rev_seq:0,charter_rev:1}));},message(ws,data){const v=JSON.parse(String(data));if(v.type==="ping")ws.send('{"type":"pong"}');},close(){}}});
console.log("Synthetic UI fixture: http://127.0.0.1:18951 (no external actions)");
