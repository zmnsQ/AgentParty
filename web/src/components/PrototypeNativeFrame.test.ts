// @ts-expect-error Bun executes these source-contract tests.
import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/prototype-native-frame.css',import.meta.url),'utf8');
test('prototype rail separates primary actions from existing account and advanced controls',()=>{
 const rail=app.slice(app.indexOf('<header className="app-head prototype-rail">'),app.indexOf('</header>',app.indexOf('<header className="app-head prototype-rail">')));
 const nav=rail.slice(rail.indexOf('<nav'),rail.indexOf('</nav>'));
 expect(nav).toContain('setWorkspaceAction');expect(nav).not.toContain('<details');
 const footer=rail.slice(rail.indexOf('prototype-rail-footer'));
 expect(footer).toContain('prototype-rail-more');expect(footer).toContain('ref={settingsButtonRef}');expect(footer).toContain('onClick={openSettings}');expect(footer).toContain('prototype-rail-account');
 expect(rail).toContain('Agent Commons');expect(rail).not.toContain('>J<');
});
test('prototype dimensions keep mobile rail visible and landscape actions reachable',()=>{
 expect(css).toContain('padding:22px');expect(css).toContain('border-radius:15px');expect(css).toContain('grid-template-columns:62px minmax(0,1fr)');expect(css).toContain('grid-template-columns:225px minmax(0,1fr)');
 expect(css).toContain('grid-template-columns:74px minmax(0,1fr)');expect(css).toContain('grid-template-columns:240px minmax(0,1fr)');
 expect(css).toContain('grid-template-columns:calc(49px + env(safe-area-inset-left)) minmax(0,1fr)');expect(css).toContain('overflow-y:auto');expect(css).toContain('max(15px,env(safe-area-inset-bottom))');
});
test('light theme switches the entire frame palette and collapse no longer overlaps create',()=>{
 expect(css).toContain(':root[data-theme="doodle"]');expect(css).toContain('--pn-main:#f5f4ef');expect(css).toContain('--pn-rail:#eceae3');
 expect(css).toContain('background:var(--pn-main)');expect(css).toContain('background:var(--pn-rail)');expect(css).toContain('top:auto;bottom:8px');expect(css).toContain('padding-bottom:42px');
});
