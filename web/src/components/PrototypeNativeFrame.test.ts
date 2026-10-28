// @ts-expect-error Bun executes these source-contract tests.
import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/workspace-surfaces.css',import.meta.url),'utf8');
const frame=readFileSync(new URL('../styles/prototype-native-frame.css',import.meta.url),'utf8');
const shell=readFileSync(new URL('./WorkspaceShell.tsx',import.meta.url),'utf8');
test('account and advanced controls live in the sidebar footer, not a standalone rail',()=>{
 expect(app).not.toContain('<header className="app-head prototype-rail">');
 expect(app).toContain('const accountControls =');expect(app).toContain('className="workspace-account-controls"');
 expect(app).toContain('mobileActions={accountControls} navigationFooter={accountControls}');
 expect(app).toContain('ref={settingsButtonRef}');expect(app).toContain('onClick={openSettings}');expect(app).toContain('App.workspace.tools');
 expect(shell).toContain('workspace-navigation-footer');expect(app).toContain('workspace-brand-label">Agent Commons');
});
test('current surface layer fills viewport and removes the framed rail layout',()=>{
 expect(css).toMatch(/#root:has\(>\.prototype-native-workspace\)\s*\{padding:0;height:var\(--ac-viewport-height,100dvh\)/);
 expect(css).toMatch(/\.app\.prototype-native-workspace\s*\{display:block;border:0;border-radius:0;box-shadow:none;--prototype-rail-width:0px/);
 expect(css).toContain('.prototype-native-workspace>.workspace-frame{width:100%;height:100%;}');
 expect(css).toContain('grid-template-columns:260px minmax(0,1fr)');expect(css).toContain('grid-template-columns:44px minmax(0,1fr)');
 expect(css).toContain('.mobile-groups-drawer{left:0;');expect(css).toContain('max-height:calc(100dvh - 100px);overflow:auto');
});
test('frame derives palette from root theme and footer controls stay outside scroll area',()=>{
 expect(frame).toContain('--pn-main:var(--t-bg)');expect(frame).toContain('--pn-rail:var(--ac-surface-1)');expect(frame).toContain('--pn-text:var(--t-text)');
 expect(css).toContain('.workspace-nav-body{flex:1;min-height:0;height:auto;padding-bottom:0;}');
 expect(css).toContain('.workspace-navigation-footer{flex:none;');expect(css).toContain('.navigation-collapsed .workspace-navigation-footer');
});
