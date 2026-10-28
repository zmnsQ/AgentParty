/** Test transport only. No imports of App internals, no production mocks. */
const self={name:'fixture-human',kind:'human',display:'测试用户'};
const agents=[{name:'fixture-muse',kind:'agent',display:'Muse · 测试'},{name:'fixture-atlas',kind:'agent',display:'Atlas · 测试'}];
const identities=[self,...agents];
const messages=[
 {sender:self,body:'【TEST FIXTURE】想做一个自然、有温度的生活方式品牌。我们一起找找方向？'},
 {sender:agents[0],body:'【TEST FIXTURE】从「给日常留一点空隙」开始。\n\n每一件小事，都刚刚好。'},
 {sender:agents[1],body:'【TEST FIXTURE】**把自然，带回日常。**\n\n- 柔和的颜色\n- 清晰的内容层级\n- 紧凑而不拥挤的空间'},
].map((m,i)=>({...m,type:'msg',seq:i+1,ts:Date.UTC(2026,9,28,0,10+i),kind:'message',mentions:[],reply_to:null,state:null,note:null,status:null}));
const channels=['品牌灵感实验室 · 测试','产品讨论 · 测试'].map((title,i)=>({slug:`fixture-${i}`,title,topic:'TEST FIXTURE',kind:'standing',mode:'normal',visibility:'private',owned:true,member:true,created_at:1,archived_at:null,presence:[],last_message:{sender:'fixture-atlas',kind:'message',body:'本地验收数据，非真实消息',ts:1}}));
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
 Object.defineProperty(window,'__APP_WORKSPACE_FIXTURE__',{value:{requests,channels,identities},configurable:true});
 window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
  const method=init?.method??(input instanceof Request?input.method:'GET');
  requests.push(`${method} ${url.pathname}`);
  const ok=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  if(method!=='GET')return new Response('{"error":{"code":"test_fixture_read_only"}}',{status:403});
  if(url.pathname==='/api/auth/github/session')return ok({configured:true,status:'authenticated',access_token:'apb_TEST_FIXTURE_NO_VALID_CREDENTIAL',account:self.name,login:'fixture',mfa_enabled:true});
  if(url.pathname==='/api/config')return ok({});
  if(url.pathname==='/api/version')return ok({version:'0.0.0-test'});
  if(url.pathname==='/api/me')return ok({...self,email:null,handle:'fixture',display_name:'测试用户',avatar_url:null,avatar_thumb:null,provider:'github',tenant_key:null,role:'human',owner:null});
  if(url.pathname==='/api/channels')return ok({channels});
  if(/^\/api\/channels\/fixture-[01]\/messages$/.test(url.pathname))return ok({messages:url.searchParams.has('before')&&Number(url.searchParams.get('before'))<=1?[]:messages});
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
   setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.(new Event('open'));this.emit({type:'welcome',channel:slug,self:self.name,role:'human',mode:'normal',participants:identities,last_seq:3,last_rev_seq:0,presence:[],read_cursors:[]});},0);
  }
  emit(frame:unknown){this.onmessage?.(new MessageEvent('message',{data:JSON.stringify(frame)}));}
  send(raw:string){const f=JSON.parse(raw);if(f.type==='ping')this.emit({type:'pong'});/* no writes; never simulate successful send */}
  close(){this.readyState=3;this.onclose?.(new CloseEvent('close',{code:1000,reason:'fixture_closed'}));}
 }
 Object.defineProperty(window,'WebSocket',{configurable:true,value:FixtureSocket});
 Object.defineProperty(window,'EventSource',{configurable:true,value:class{constructor(){throw new Error('TEST_FIXTURE_NETWORK_DISABLED');}}});
}
