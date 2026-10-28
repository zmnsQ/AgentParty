// @ts-expect-error Bun executes these tests.
import {test,expect,beforeEach,afterEach} from 'bun:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {WorkspaceShell} from './WorkspaceShell';
import {ResponsiveSidebar} from './ResponsiveSidebar';
let renderer:ReactTestRenderer|null=null;
const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let compact=false;const values=new Map<string,string>();
beforeEach(()=>{
 compact=false;values.clear();Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{matchMedia:()=>({matches:compact,addEventListener(){},removeEventListener(){}})}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>key==='ap_locale'?'en':values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
});
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;for(const [key,old] of [['window',originalWindow],['localStorage',originalStorage]] as const){if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key);}});
test('desktop has one small accessible collapse control and hides the controlled navigation',()=>{
 act(()=>{renderer=create(<LocaleProvider><WorkspaceShell route="one" navigation={<p>Real navigation</p>}><main>Conversation</main></WorkspaceShell></LocaleProvider>);});
 const root=renderer!.root,button=root.findByProps({'aria-controls':'workspace-navigation-content'});
 expect(root.findAllByProps({className:'workspace-nav-heading'})).toHaveLength(0);
 expect(button.props['aria-expanded']).toBe(true);
 act(()=>button.props.onClick());expect(button.props['aria-expanded']).toBe(false);expect(root.findByProps({id:'workspace-navigation-content'}).props.hidden).toBe(true);
 expect(values.get('commons.navigation.collapsed')).toBe('1');
});
test('mobile route has only icon trigger, no duplicate conversation title bar',()=>{
 compact=true;act(()=>{renderer=create(<LocaleProvider><ResponsiveSidebar activeSlug="one" title="Real group"><p>Navigation</p></ResponsiveSidebar></LocaleProvider>);});
 const root=renderer!.root;expect(root.findAllByProps({className:'mobile-groupbar'})).toHaveLength(0);
 const button=root.findByProps({'aria-haspopup':'dialog'});expect(button.props['aria-expanded']).toBe(false);expect(button.props['aria-label']).toBe('Open group list');
 expect(root.findAllByType('span').some(n=>n.children.includes('Real group'))).toBe(false);
 act(()=>button.props.onClick());expect(root.findByProps({role:'dialog'}).props.id).toBe(button.props['aria-controls']);
 const close=root.findAllByType('button').find(b=>b.props.className==='d-btn')!;act(()=>close.props.onClick());expect(root.findAllByProps({role:'dialog'})).toHaveLength(0);
});
test('mobile homepage retains an entry and route changes dismiss the drawer',()=>{
 compact=true;const view=(activeSlug:string|null)=><LocaleProvider><ResponsiveSidebar activeSlug={activeSlug}><p>Navigation</p></ResponsiveSidebar></LocaleProvider>;
 act(()=>{renderer=create(view(null));});const root=renderer!.root;expect(root.findAllByProps({className:'mobile-groupbar'})).toHaveLength(1);
 act(()=>root.findByProps({'aria-haspopup':'dialog'}).props.onClick());expect(root.findAllByProps({role:'dialog'})).toHaveLength(1);
 act(()=>renderer!.update(view('new-group')));expect(root.findAllByProps({role:'dialog'})).toHaveLength(0);
});
