import { PERSONAL_AGENT_PROVIDERS, type CollaborationSummary, type ChannelRepository, type ChannelFilesResponse } from "@agentparty/shared/collaboration";
/** Test transport only. No imports of App internals, no production mocks. */
const self={name:'fixture-human',kind:'human',display:'测试用户'};
const agents=[{name:'fixture-muse',kind:'agent',display:'Muse · 测试'},{name:'fixture-atlas',kind:'agent',display:'Atlas · 测试'}];
const identities=[self,...agents];
const messages=[
 {sender:self,body:'【TEST FIXTURE】想做一个自然、有温度的生活方式品牌。我们一起找找方向？'},
 {sender:agents[0],body:'【TEST FIXTURE】从「给日常留一点空隙」开始。\n\n每一件小事，都刚刚好。'},
 {sender:agents[1],body:'【TEST FIXTURE】**把自然，带回日常。**\n\n- 柔和的颜色\n- 清晰的内容层级\n- 紧凑而不拥挤的空间'},
].map((m,i)=>({...m,type:'msg',seq:i+1,ts:Date.UTC(2026,9,28,0,10+i),kind:'message',mentions:[],reply_to:null,state:null,note:null,status:null}));
const channels=['品牌灵感实验室 · 测试','产品讨论 · 测试'].map((title,i)=>({slug:`fixture-${i}`,title,topic:'TEST FIXTURE',kind:'standing',mode:'normal',visibility:'private',owned:true,member:true,can_moderate:true,created_at:1,archived_at:null,presence:[],last_message:{sender:'fixture-atlas',kind:'message',body:'本地验收数据，非真实消息',ts:1}}));
function memoryStorage(initial:Record<string,string>={}):Storage {
 const values=new Map(Object.entries(initial));return {getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,String(v));},removeItem:k=>{values.delete(k);},clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
}
export function installWorkspaceFixture(theme:'doodle'|'midnight') {
 Object.defineProperty(window,'localStorage',{configurable:true,value:memoryStorage({'ap_onboarded':'1','ap_theme':theme,'ap_theme_ui_version':'prototype-native-v1','ap_locale':'zh'})});
 Object.defineProperty(window,'sessionStorage',{configurable:true,value:memoryStorage()});
 let fixtureCookie='';
 Object.defineProperty(document,'cookie',{configurable:true,get:()=>fixtureCookie,set:(value:string)=>{fixtureCookie=value;}});
 document.documentElement.dataset.theme=theme;
 const requests:string[]=[];
 const scrolling = new URLSearchParams(location.search).get('scroll') === '1';
 const historyMessages = scrolling ? Array.from({length:200},(_,i)=>({...messages[1]!,seq:i+1,body:`【TEST FIXTURE】历史消息 ${i+1}\n\n用于滚动位置验收，不是真实消息。`,ts:Date.UTC(2026,9,28)+i*1000})) : [...messages];
 const sockets=new Set<FixtureSocket>();
 let nextSeq=historyMessages.at(-1)!.seq+1;
 const emit=(frame:unknown)=>{for(const socket of sockets)if(socket.readyState===1)socket.emit(frame);};
 const controls={
  append:(text='【TEST FIXTURE】新增消息')=>{const message={...messages[1]!,seq:nextSeq++,body:text,ts:Date.now()};historyMessages.push(message);emit(message);return message.seq;},
  stream:(seq:number,text:string)=>{const index=historyMessages.findIndex(m=>m.seq===seq);if(index<0)return;const message={...historyMessages[index]!,body:text};historyMessages[index]=message;emit({type:'message_update',message,rev_seq:nextSeq++});},
  streamLatest:()=>{const latest=historyMessages.at(-1)!;controls.stream(latest.seq,`${latest.body}\n\n【TEST FIXTURE】追加流式内容 ${nextSeq}`);},
  status:()=>emit({...messages[1]!,seq:nextSeq++,type:'status',kind:'status',state:'working',body:'',note:'TEST FIXTURE 状态刷新',ts:Date.now()}),
  presence:()=>emit({type:'presence',...agents[0],state:'working',note:'TEST FIXTURE presence',ts:Date.now()}),
 };

 Object.defineProperty(window,'__APP_WORKSPACE_FIXTURE__',{value:{requests,channels,identities,controls},configurable:true});
 window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
  const method=init?.method??(input instanceof Request?input.method:'GET');
  requests.push(`${method} ${url.pathname}`);
  const ok=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  if(method!=='GET')return new Response('{"error":{"code":"test_fixture_read_only"}}',{status:403});
  if(url.pathname==='/api/auth/github/session')return ok({configured:true,status:'authenticated',access_token:'apb_TEST_FIXTURE_NO_VALID_CREDENTIAL',account:self.name,login:'fixture',mfa_enabled:true});
  if(url.pathname==='/oauth/grants')return ok({connections:[]});
  const groupMatch=url.pathname.match(/^\/api\/channels\/(fixture-[01])(?:\/(.*))?$/);
  if(groupMatch){
   const slug=groupMatch[1]!;const resource=groupMatch[2]??'';
   const repository:ChannelRepository={id:'fixture-repository',channel:slug,full_name:'TEST-FIXTURE/design-notes',html_url:'#test-fixture-repository',base_branch:'main',private:true,credential_configured:false,created_at:Date.UTC(2026,9,28)};
   const policy={enabled:true,allow_write:false,allow_events:false,owner_mfa_enabled:true,require_mfa:true,updated_at:null};
   if(resource==='collaboration')return ok({providers:PERSONAL_AGENT_PROVIDERS,connections:[],repositories:[repository],permissions:{manage:true,run:false,upload:false},mcp_endpoint:`${location.origin}/mcp/${slug}`,execution:'manual-sync'} satisfies CollaborationSummary);
   if(resource==='files')return ok({files:[{key:`${slug}/fixture/visual-notes.txt`,filename:'TEST-FIXTURE-视觉验收说明.txt',content_type:'text/plain',size:96,url:`/api/channels/${slug}/fixture-file`,uploaded_by:self.name,uploaded_at:'2026-10-28T00:00:00Z'}],cursor:null} satisfies ChannelFilesResponse);
   if(resource==='fixture-file')return new Response('TEST FIXTURE — 本地视觉验收说明，不是真实群文件。',{headers:{'content-type':'text/plain;charset=utf-8'}});
   if(resource==='join-links')return ok({links:[]});
   if(resource==='join-requests')return ok({requests:[]});
   if(resource==='repositories')return ok({repositories:[repository]});
   if(resource==='repositories/fixture-repository/pulls')return ok({repository,pulls:[{number:1,title:'TEST FIXTURE · 视觉稿验收',html_url:'#test-fixture-pull',state:'open',draft:true,author:'fixture-human',head_branch:'fixture-preview',base_branch:'main',updated_at:'2026-10-28T00:00:00Z'}]});
   if(resource==='repositories/fixture-repository/proposals')return ok({proposals:[]});
   if(/^cloud-agents\/[^/]+\/runs$/.test(resource))return ok({runs:[]});
   if(resource==='mcp-security')return ok({policy,can_manage:true});
   if(resource==='bridges/grok-automation')return ok({connection:null,deliveries:[],mode:'grok-automation-webhook',personal_bot_direct_api:false,automatic_result_import:false});
   if(resource==='bridges/events/status')return ok({active_subscriptions:0,pending_deliveries:0,agents:[],callback_policy_configured:false});
   if(resource==='bridges/muse')return ok({native_oauth:{status:'not_authorized',checked_at:Date.now(),client_verified:false},native_client_id:null,native_authorized:false,can_configure:true,mcp_endpoint:`${location.origin}/mcp/${slug}`,configuration:{},clients:[],policy,platform_review:{status:'unverified',verified:false},personal_wake:{status:'unverified',verified:false}});
   if(resource==='pending-decisions')return ok({decisions:[{seq:historyMessages[0]!.seq,prompt:'【TEST FIXTURE】请确认视觉方向与消息密度',asker:agents[0]!.name,waiting_on_me:true}],next_after:null});
   const messageMatch=resource.match(/^messages\/(\d+)$/);
   if(messageMatch){const message=historyMessages.find(m=>m.seq===Number(messageMatch[1]));return message?ok({message}):new Response('{}',{status:404});}
  }
  if(url.pathname==='/api/config')return ok({});
  if(url.pathname==='/api/version')return ok({version:'0.0.0-test'});
  if(url.pathname==='/api/me')return ok({...self,email:null,handle:'fixture',display_name:'测试用户',avatar_url:null,avatar_thumb:null,provider:'github',tenant_key:null,role:'human',owner:null});
  if(url.pathname==='/api/channels')return ok({channels});
  if(/^\/api\/channels\/fixture-[01]\/messages$/.test(url.pathname)){
   const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')??100)));
   const around=url.searchParams.get('around');
   if(around!==null){const index=historyMessages.findIndex(m=>m.seq===Number(around));const start=Math.max(0,index-Math.floor(limit/2));return ok({messages:index<0?[]:historyMessages.slice(start,start+limit)});}
   return ok({messages:historyMessages.filter(m=>m.seq<Number(url.searchParams.get('before')??Number.MAX_SAFE_INTEGER)).slice(-limit)});
  }
  if(/^\/api\/channels\/fixture-[01]\/identities$/.test(url.pathname))return ok({identities});
  if(url.pathname.endsWith('/charter'))return ok({charter:'',charter_rev:0,updated_at:0,updated_by:null});
  if(url.pathname.endsWith('/roles'))return ok({roles:[]});
  if(url.pathname.endsWith('/tasks/summary'))return ok({type:'task_summary',channel:'fixture-0',total:0,open:0,triage:0,backlog:0,assigned:0,in_progress:0,needs_review:0,blocked:0,done:0,mine:0});
  if(url.pathname.endsWith('/tasks'))return ok({tasks:[]});
  if(url.pathname.endsWith('/squads'))return ok({squads:[]});
  if(url.pathname.endsWith('/agents'))return ok({agents:[]});
  if(url.pathname.endsWith('/presence'))return ok({presence:[]});
  return new Response(JSON.stringify({error:{code:'unhandled_fixture_endpoint',message:url.pathname}}),{status:404});
 };
 class FixtureSocket {
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;onopen:((event:Event)=>void)|null=null;onmessage:((event:MessageEvent)=>void)|null=null;onclose:((event:CloseEvent)=>void)|null=null;onerror:null=null;
  constructor(url:string){
   const parsed=new URL(url,location.origin);const slug=parsed.pathname.match(/fixture-[01]/)?.[0];
   if(!slug)throw new Error('TEST_FIXTURE_SOCKET_REJECTED');
   sockets.add(this);
   setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.(new Event('open'));this.emit({type:'welcome',channel:slug,self:self.name,role:'human',mode:'normal',participants:identities,last_seq:historyMessages.at(-1)!.seq,last_rev_seq:0,presence:[],read_cursors:[]});},0);
  }
  emit(frame:unknown){this.onmessage?.(new MessageEvent('message',{data:JSON.stringify(frame)}));}
  send(raw:string){const f=JSON.parse(raw);if(f.type==='ping')this.emit({type:'pong'});/* no writes; never simulate successful send */}
  close(){sockets.delete(this);this.readyState=3;this.onclose?.(new CloseEvent('close',{code:1000,reason:'fixture_closed'}));}
 }
 Object.defineProperty(window,'WebSocket',{configurable:true,value:FixtureSocket});
 Object.defineProperty(window,'EventSource',{configurable:true,value:class{constructor(){throw new Error('TEST_FIXTURE_NETWORK_DISABLED');}}});
 return controls;
}
