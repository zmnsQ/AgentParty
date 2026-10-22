// @ts-expect-error Bun test APIs are not part of the browser tsconfig.
import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {StudioIcon,STUDIO_ICON_PATHS,type StudioIconName} from './StudioIcon';
// @ts-expect-error Bun supplies Node built-in types for test execution.
import {readdirSync,readFileSync,existsSync} from 'node:fs';
// @ts-expect-error Bun supplies Node built-in types for test execution.
import {resolve,join} from 'node:path';
test('all interface icons share a monochrome vector grid and stroke',()=>{
 expect(Object.keys(STUDIO_ICON_PATHS).length).toBeGreaterThan(50);
 for(const name of Object.keys(STUDIO_ICON_PATHS) as StudioIconName[]){
  const html=renderToStaticMarkup(<StudioIcon name={name}/>);
  expect(html).toContain('viewBox="0 0 24 24"');expect(html).toContain('stroke-width="1.75"');
  expect(html).toContain('stroke="currentColor"');expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('<image');expect(html).not.toContain('background-image');
 }
 expect(renderToStaticMarkup(<StudioIcon name="shield" label="Security"/>)).toContain('aria-label="Security"');
});
test('runtime source does not load old raster icons or the obsolete foundation',()=>{
 // @ts-expect-error Bun supplies import.meta.dir.
 const src=resolve(import.meta.dir,'..');
 function walk(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap((d:{name:string;isDirectory():boolean})=>d.isDirectory()?walk(join(dir,d.name)):[join(dir,d.name)]);}
 for(const file of walk(src).filter(f=>/\.(tsx|css)$/.test(f)&&!f.includes('.test.'))){
  expect(readFileSync(file,'utf8')).not.toContain('ap-sprite');
  expect(readFileSync(file,'utf8')).not.toContain('agentparty-ui-sprite');
 }
 expect(readFileSync(join(src,'main.tsx'),'utf8')).toContain('styles/foundation.css');
 expect(existsSync(join(src,'styles/doodle.css'))).toBe(false);
});
