// @ts-expect-error Bun test runner APIs.
import {test,expect,afterEach} from 'bun:test';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {LocaleProvider} from '../i18n/locale';
import {ConversationHeader} from './ConversationHeader';
import {ConversationDetails,ConversationTools} from './ConversationDetails';
// @ts-expect-error Node API is test only.
import {readFileSync} from 'node:fs';
let r:ReactTestRenderer|null=null;
afterEach(()=>{act(()=>r?.unmount());r=null;});
test('single header exposes real scoped members and actions without fake agent placeholders',()=>{
 let details=0,added=0;
 act(()=>{r=create(<LocaleProvider><ConversationHeader title="Actual group" members={[{name:'person',display:'Alice',kind:'human'},{name:'agent',display:'Reviewer',kind:'agent'}]} onDetails={()=>details++} onAddAgent={()=>added++}/></LocaleProvider>);});
 expect(r!.root.findAllByType('h1')).toHaveLength(1);
 expect(r!.root.findByType('h1').children).toEqual(['Actual group']);
 expect(r!.root.findAll(n=>typeof n.props.className==='string'&&n.props.className.includes(' conversation-avatar '))).toHaveLength(2);
 const buttons=r!.root.findAllByType('button');act(()=>{buttons[0]!.props.onClick();buttons[2]!.props.onClick();});
 expect([details,added]).toEqual([1,1]);
 expect(r!.root.findAllByType('button')).toHaveLength(3);
 expect(r!.root.findByProps({id:'mobile-navigation-trigger-slot'})).toBeTruthy();
});
test('details controllers stay mounted while the surface closes; permissions omit add button',()=>{
 act(()=>{r=create(<LocaleProvider><ConversationDetails open={false} onClose={()=>{}}><ConversationTools buttons={<button>Real action</button>} actions={<span>Controller</span>}/></ConversationDetails></LocaleProvider>);});
 expect(r!.root.findByProps({className:'conversation-details-overlay'}).props.hidden).toBe(true);
 expect(r!.root.findAllByType('button').some(b=>b.children.includes('Real action'))).toBe(true);
 act(()=>r!.update(<LocaleProvider><ConversationHeader title="Read only" members={[]} onDetails={()=>{}}/></LocaleProvider>));
 expect(r!.root.findAllByProps({className:'invite-button'})).toHaveLength(0);
});
test('production Channel actually composes details and header, not the legacy permanent toolstrip',()=>{
 const source=readFileSync(new URL('../pages/Channel.tsx',import.meta.url),'utf8');
 expect(source).toContain('className="stream transcript" ref={streamRef}');expect(source).toContain('className="conversation-inner"');expect(source).toContain('<ConversationHeader');expect(source).toContain('<ConversationDetails');expect(source).toContain('<ConversationTools');expect(source).not.toContain('<ChannelToolstrip');
 expect(source).toMatch(/identity\.kind\s*===\s*'agent'/);expect(source).toContain('onAgentRoster?.(slug,[])');expect(source).toContain("workspaceAction.panel==='files'?'collaboration'");
});

test('details sits below existing nested roster dialogs and delegates their focus trap',()=>{
 const css=readFileSync(new URL('../styles/conversation-layout.css',import.meta.url),'utf8');
 const component=readFileSync(new URL('./ConversationDetails.tsx',import.meta.url),'utf8');
 expect(css).toContain('z-index:55');expect(component).toContain('active:open&&!suspended');
});

test('header exposes real pending mentions and connection failure without opening details',()=>{
 let jumped=0;
 act(()=>{r=create(<LocaleProvider><ConversationHeader title="Group" members={[]} onDetails={()=>{}} attentionCount={2} onAttention={()=>jumped++} connectionStatus="closed"/></LocaleProvider>);});
 act(()=>r!.root.findByProps({className:'conversation-attention'}).props.onClick());
 expect(jumped).toBe(1);expect(r!.root.findByProps({role:'status'}).children).toEqual(['Disconnected']);
 const css=readFileSync(new URL('../styles/conversation-layout.css',import.meta.url),'utf8');
 expect(css).toContain('height:73px');expect(css).toContain('font-size:12px;font-weight:400');
});
test('header uses declared platform metadata with neutral unknown, not nickname guessing',()=>{
 act(()=>{r=create(<LocaleProvider><ConversationHeader title="Group" members={[{name:'worker',display:'Assistant',kind:'agent',connector_type:'chatgpt'},{name:'muse',display:'ChatGPT',kind:'agent'}]} onDetails={()=>{}}/></LocaleProvider>);});
 expect(r!.root.findAllByProps({'data-platform':'chatgpt'})).toHaveLength(1);
 expect(r!.root.findAllByProps({'data-platform':'unknown'})).toHaveLength(1);
});
