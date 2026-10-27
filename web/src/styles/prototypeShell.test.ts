// @ts-expect-error Bun test APIs are outside Vite browser types.
import {expect,test} from 'bun:test';
// @ts-expect-error Node file APIs are only used by the test runner.
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('./prototype-shell.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
test('prototype shell owns three-column layout without losing tool actions',()=>{
 expect(css).toContain('--prototype-rail-width:62px');
 expect(css).toContain('--ac-navigation-width:225px');
 expect(app).toContain('prototype-rail-popover');
 expect(app).toContain('App.workspace.tools');
 expect(app).toContain('event.key==="Escape"');
 expect(app).toContain('mobile-account-entry');
});
test('navigation and native disclosure override legacy minimum size and clipping',()=>{
 expect(css).toContain('.workspace-nav-inner {min-width:0');
 expect(css).toContain('details.prototype-rail-more::details-content {height:auto;overflow:visible');
 expect(css).toContain('.mobile-groups-content .side.prototype-sidebar {width:100%;height:auto;max-height:none');
});
test('compact layout removes permanent rail and does not scale the viewport',()=>{
 expect(css).toContain('.app-head.prototype-rail {display:none;}');
 expect(css).toContain('(max-height:760px) and (pointer:coarse)');
 expect(css).not.toMatch(/zoom\s*:|scale\(/);
 expect(css).toContain(':root input,:root textarea,:root select {font-size:16px;}');
});
