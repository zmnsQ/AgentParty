// @ts-expect-error Bun test APIs are not browser types.
import {afterEach, expect, test} from 'bun:test';
// @ts-expect-error Node file API is used only by the Bun test runner.
import {readFileSync} from 'node:fs';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Composer} from './Composer';
import {LocaleProvider} from '../i18n/locale';
let renderer:ReactTestRenderer|null=null;
afterEach(()=>{act(()=>renderer?.unmount());renderer=null;});
test('desktop capsule keeps tools available behind an explicit accessible toggle',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
 try {
  act(()=>{renderer=create(<LocaleProvider><Composer draft="Keep my draft" setDraft={()=>{}} onSend={()=>{}} ready candidates={[]} mentionStatuses={[]}/></LocaleProvider>);});
  const root=renderer!.root;
  expect(root.findByProps({'data-prototype-composer':'true'})).toBeTruthy();
  const more=root.findByProps({className:'composer-more'});
  expect(more.props['aria-expanded']).toBe(false);
  expect(root.findByProps({className:'composer-secondary-actions'}).props.hidden).toBe(true);
  act(()=>more.props.onClick());
  expect(root.findByProps({className:'composer-secondary-actions'}).props.hidden).toBe(false);
  expect(root.findByType('textarea').props.value).toBe('Keep my draft');
  expect(root.findByType('textarea').props.rows).toBe(1);
  expect(root.findByProps({className:'d-btn d-btn--primary composer-send'}).props['aria-label']).toBeTruthy();
 } finally {
  act(()=>renderer?.unmount());renderer=null;
  if(original)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',original);else Reflect.deleteProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT');
 }
});
test('prototype chat styles retain mobile sizing, low-height budgets and scoped selectors',()=>{
 const css=readFileSync(new URL('../styles/prototype-chat.css',import.meta.url),'utf8');
 expect(css).toContain('background:#66534d');
 expect(css).toContain('font:16px/23px');
 expect(css).toContain('font:11px/23px');
 expect(css).toContain('max-width:690px');
 expect(css).toContain('width:33px;height:33px');
 expect(css).toContain('(max-height:500px)');
 expect(css).toContain('env(safe-area-inset-bottom)');
 expect(css).toContain('.composer-secondary-actions[hidden]');
 expect(css).toContain(':root[data-theme="doodle"]');
 expect(css).toContain('background:#bba396');
 expect(css).not.toContain('zoom:');
});

test('visual QA fixes retain compact status details and legible suggestion selection',()=>{
 const css=readFileSync(new URL('../styles/prototype-chat.css',import.meta.url),'utf8');
 expect(css).toContain('width:20px;height:33px;min-height:33px');
 expect(css).toContain('.mention-item.is-active {background:#41493f;color:#f0f2e9;}');
 expect(css).toContain('> .msg-status-bar {order:1');
 expect(css).toContain('.msg-avatar {left:-35px;}');
});
