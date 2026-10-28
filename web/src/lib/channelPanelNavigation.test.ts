// @ts-expect-error Bun test API
import {test,expect} from 'bun:test';
import {pushPanelOrigin,popPanelOrigin} from './channelPanelNavigation';
test('cross-panel back preserves source context without duplicating same-panel actions',()=>{
 const team={key:'team',member:'helper',scroll:238};
 const stack=pushPanelOrigin([],team,'tasks');
 expect(popPanelOrigin(stack)).toEqual({previous:team,remaining:[]});
 expect(pushPanelOrigin(stack,{key:'tasks'},'tasks')).toEqual(stack);
});
test('revisiting ancestor truncates loops and close starts with empty history',()=>{
 expect(pushPanelOrigin([{key:'team'},{key:'tasks'}],{key:'collaboration'},'team')).toEqual([]);
 expect(pushPanelOrigin([],null,'team')).toEqual([]);
 expect(popPanelOrigin([])).toEqual({previous:null,remaining:[]});
});
test('navigation history is bounded and stores only caller UI snapshots',()=>{
 let stack:Array<{key:string}>=[];
 for(let n=0;n<30;n++)stack=pushPanelOrigin(stack,{key:String(n)},String(n+1));
 expect(stack).toHaveLength(12);expect(stack.at(-1)?.key).toBe('29');
});
test('details to invitations to cloud returns each source and cannot make a loop',()=>{
 const details={key:'details',scroll:320};const invite={key:'agentJoin',scroll:0};
 const first=pushPanelOrigin([],details,'agentJoin');
 const second=pushPanelOrigin(first,invite,'collaboration');
 const back=popPanelOrigin(second);expect(back.previous).toEqual(invite);
 expect(popPanelOrigin(back.remaining).previous).toEqual(details);
 expect(pushPanelOrigin(second,{key:'collaboration',scroll:0},'details')).toEqual([]);
});
