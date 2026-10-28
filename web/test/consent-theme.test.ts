// @ts-expect-error Bun executes this focused test.
import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {renderOAuthConsent,renderOAuthGroupChoice,renderOAuthProblem} from '../../worker/src/collaboration/oauth-pages';
const css=readFileSync(new URL('../public/commons-consent.css',import.meta.url),'utf8');
function palette(theme:'light'|'dark'){
 const body=css.match(theme==='light'?/:root\s*\{([^}]+)\}/:/:root\[data-theme=midnight\]\s*\{([^}]+)\}/)![1]!;
 return Object.fromEntries([...body.matchAll(/--oc-([\w-]+):#([0-9a-f]{6})(?=;)/g)].map(x=>[x[1],x[2]]));
}
function luminance(hex:string){const c=hex.match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]!*.2126+c[1]!*.7152+c[2]!*.0722;}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
for(const theme of ['light','dark'] as const)test(`${theme} consent text and primary/notice colors have readable contrast`,()=>{
 const p=palette(theme);
 for(const [foreground,background] of [['text','panel'],['muted','panel'],['muted','bg'],['muted','raised'],['link','panel'],['on-accent','accent'],['notice-text','notice']])expect(contrast(p[foreground!]!,p[background!]!)).toBeGreaterThanOrEqual(4.5);
 expect(contrast(p.focus!,p.panel!)).toBeGreaterThanOrEqual(3);
});
test('standalone stylesheet has complete native form, keyboard, motion and compact layout',()=>{
 expect(css).toContain("@import url('/commons-theme.css");expect(css).not.toMatch(/https?:\/\//);
 expect(css).toContain('form[method=GET]{grid-template-columns:minmax(0,1fr)');expect(css).toContain('.oauth-group-select option');
 expect(css).toContain(':is(a,button,summary,select,input):focus-visible');expect(css).toContain('prefers-reduced-motion');expect(css).toContain('forced-colors:active');
 expect(css).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);expect(css).toContain('min-height:48px');
});
for(const theme of ['doodle','midnight'] as const)test(`${theme} server HTML retains explicit consent and truthful error/scope content`,async()=>{
 const html=await renderOAuthConsent({id:'synthetic-request',nonce:'synthetic-nonce',clientName:'Synthetic connector',group:'synthetic-group',groupTitle:'Synthetic group',account:'synthetic-owner',login:'fixture',scopes:['group.read','group.events'],redirectUri:'https://example.test/callback'},{locale:'en',theme}).text();
 expect(html).toContain(`data-theme="${theme}"`);expect(html).toContain('name="decision" value="approve"');expect(html).toContain('name="decision" value="deny"');expect(html).toContain('<code>group.events</code>');expect(html).not.toContain('<code>group.write</code>');expect(html).not.toContain('<script');expect(html).toContain('/brand/mark.png');
 const error=await renderOAuthProblem(new Request('https://example.test',{headers:{accept:'text/html',cookie:`ap_theme=${theme}; ap_locale=en`}}),'group_owner_required',403).text();expect(error).toContain('role="alert"');expect(error).toContain('has not granted any new access');
 const choice=await renderOAuthGroupChoice({clientName:'Synthetic',groups:[{slug:'one',title:'One',resource:'https://example.test/one'}],params:{}},{locale:'en',theme}).text();expect(choice).toContain('method="GET"');expect(choice).toContain('name="resource" required');
});
