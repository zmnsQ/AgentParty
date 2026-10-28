// @ts-expect-error Bun test APIs are outside Vite browser types.
import {expect,test} from 'bun:test';
// @ts-expect-error Node file APIs are only used by the test runner.
import {readFileSync} from 'node:fs';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const css=read('./workspace-surfaces.css'),legacy=read('./prototype-shell.css');
const tokens=read('./tokens.css'),app=read('../App.tsx'),main=read('../main.tsx');
test('sidebar retains real tool actions and native disclosure without a permanent rail',()=>{
 expect(app).not.toContain('className="prototype-rail-nav"');expect(app).toContain('workspace-account-controls');expect(app).toContain('prototype-rail-popover');expect(app).toContain('App.workspace.tools');expect(app).toContain('event.key==="Escape"');
 expect(css).toContain('.workspace-account-controls .prototype-rail-popover');expect(css).toContain('position:fixed');expect(css).toContain('overflow:auto');
 expect(legacy).toContain('details.prototype-rail-more::details-content {height:auto;overflow:visible');
});
test('default root is dark and explicit doodle supplies the full shared light palette',()=>{
 const dark=tokens.match(/:root,:root\[data-theme="midnight"\]\s*\{([^}]+)\}/)![1]!;
 const light=tokens.match(/:root\[data-theme="doodle"\]\s*\{([^}]+)\}/)![1]!;
 expect(dark).toContain('--ac-surface-0:#191a1b');expect(light).toContain('--ac-surface-0:#f5f4ef');
 for(const name of ['t-bg','t-panel','t-panel2','t-text','t-body','t-muted','t-accent','t-accent-ink','ac-border','ac-backdrop']){
  expect(dark).toContain(`--${name}:`);expect(light).toContain(`--${name}:`);
 }
});
test('body portals receive public root surface tokens instead of an app-only skin',()=>{
 const panels=css.split('\n').find(line=>line.startsWith('html:root :is(.conversation-details-panel'))!;
 expect(panels).toContain('.settings-panel');expect(panels).toContain('.agentjoin-dialog');expect(panels).toContain('background:var(--t-panel)');expect(panels).toContain('color:var(--t-text)');expect(panels).not.toContain('.prototype-native-workspace');
 expect(css).toContain('html:root :is(.msg-menu,.msg-agent-card,.presence-popover');
 expect(main.indexOf('styles/workspace-surfaces.css')).toBeGreaterThan(main.indexOf('styles/prototype-native-frame.css'));
});
test('compact full-width drawer and form sizing preserve viewport and touch behavior',()=>{
 expect(css).toContain('(max-height:760px) and (pointer:coarse)');expect(css).toContain('.mobile-groups-drawer{left:0;width:min(290px,calc(100vw - 40px))');
 expect(css).not.toMatch(/zoom\s*:|scale\(/);expect(legacy).toContain(':root input,:root textarea,:root select {font-size:16px;}');
});

test('embedded invitation content overrides legacy popover positioning without clipping its form',()=>{
 const rule=css.match(/html:root \.joinlink-panel--embedded\{([^}]+)\}/)![1]!;
 for(const declaration of ['position:static','inset:auto','width:100%','max-width:none','max-height:none','margin:0','overflow:visible','box-sizing:border-box','background:var(--t-panel2)','box-shadow:none']) expect(rule).toContain(declaration);
 expect(css).toContain('html:root .joinlink-gen-row{flex-wrap:wrap;}');
 expect(css).toContain('html:root .joinlink-mode{flex-wrap:wrap;}');
 const join=read('../components/JoinLink.tsx');
 expect(join).toContain('embedded ? " joinlink-panel--embedded" : ""');
 expect(main.indexOf('styles/workspace-surfaces.css')).toBeGreaterThan(main.indexOf('styles/prototype-native-frame.css'));
});
