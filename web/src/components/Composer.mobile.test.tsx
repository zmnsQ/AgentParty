// @ts-expect-error Bun test APIs are not browser types.
import {afterEach,expect,test} from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Composer} from './Composer';
import {LocaleProvider} from '../i18n/locale';
const saved=new Map<string,PropertyDescriptor|undefined>();let renderer:ReactTestRenderer|null=null;
function stub(k:string,v:unknown){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,value:v});}
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}saved.clear();});
test('mobile draft resizes on rotation and keyboard without losing text; extras start hidden',()=>{
 const listeners=new Map<string,()=>void>();const media={matches:true,addEventListener(){},removeEventListener(){}};
 const viewport={height:844,scale:1,addEventListener:(k:string,fn:()=>void)=>listeners.set('visual:'+k,fn),removeEventListener:(k:string)=>listeners.delete('visual:'+k)};
 stub('window',{innerHeight:844,matchMedia:()=>media,visualViewport:viewport,addEventListener:(k:string,fn:()=>void)=>listeners.set(k,fn),removeEventListener:(k:string)=>listeners.delete(k)});
 stub('localStorage',{getItem:()=> 'en',setItem(){}});stub('IS_REACT_ACT_ENVIRONMENT',true);
 const node={style:{height:''},scrollHeight:300,focus(){},setSelectionRange(){}};
 const view=(draft:string)=><LocaleProvider><Composer draft={draft} setDraft={()=>{}} onSend={()=>{}} ready candidates={[]} mentionStatuses={[]}/></LocaleProvider>;
 act(()=>{renderer=create(view('retained draft'),{createNodeMock:e=>e.type==='textarea'?node:null});});
 expect(node.style.height).toBe('96px');expect(renderer!.root.findByType('textarea').props.rows).toBe(1);
 expect(renderer!.root.findByProps({className:'composer-secondary-actions'}).props.hidden).toBe(true);
 viewport.height=240;act(()=>listeners.get('visual:resize')?.());expect(node.style.height).toBe('60px');
 expect(renderer!.root.findByType('textarea').props.value).toBe('retained draft');
 viewport.height=390;act(()=>listeners.get('resize')?.());expect(node.style.height).toBe('96px');
 node.scrollHeight=44;act(()=>renderer!.update(view('')));expect(node.style.height).toBe('44px');
 act(()=>renderer!.root.findByProps({className:'composer-more'}).props.onClick());expect(renderer!.root.findByProps({className:'composer-secondary-actions'}).props.hidden).toBe(false);
 act(()=>renderer!.unmount());renderer=null;expect(listeners.size).toBe(0);
});

test('attachments and upload errors share one scroll region rather than stacking unbounded panels',()=>{
 stub('localStorage',{getItem:()=> 'en',setItem(){}});stub('IS_REACT_ACT_ENVIRONMENT',true);
 act(()=>{renderer=create(<LocaleProvider><Composer draft="" setDraft={()=>{}} onSend={()=>{}} ready candidates={[]} mentionStatuses={[]} uploadError="Upload unavailable" uploads={[{id:'pending',filename:'example.txt',size:5,status:'uploading'}]}/></LocaleProvider>);});
 const context=renderer!.root.findByProps({className:'composer-context'});
 expect(context.props.role).toBe('region');expect(context.props.tabIndex).toBe(0);
 expect(context.findByProps({className:'composer-uploads'})).toBeTruthy();
 expect(context.findByProps({className:'banner banner--red composer-upload-error'})).toBeTruthy();
});
