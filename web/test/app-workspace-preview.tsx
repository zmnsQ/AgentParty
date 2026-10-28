import {installWorkspaceFixture} from './app-workspace-fixture';
// Install isolation before the real production bootstrap (main.tsx), including
// desktop preference synchronization, theme initialization, StrictMode and CSS.
const params=new URLSearchParams(location.search);
// Read scroll mode inside installation before replacing the entry URL.
const controls=installWorkspaceFixture(params.get('theme')==='doodle'?'doodle':'midnight');
// Do not pre-seed the DOM theme as the earlier preview did: exercise bootstrap.
document.documentElement.removeAttribute('data-theme');
history.replaceState(null,'','/');
await import('../src/main');

// Kept outside React's production root: visible local QA controls, not app UI.
if(params.get('scroll')==='1'){
const panel=document.createElement('aside');
panel.id='fixture-controls';
panel.setAttribute('aria-label','TEST FIXTURE 本地消息控制');
panel.style.cssText='position:fixed;right:6px;bottom:24px;z-index:2147483647;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 12px);padding:4px;border:1px solid #ad8244;border-radius:8px;background:#ffdf9f;color:#30250e;font:12px sans-serif';
const actions: Array<[string,()=>unknown]>=[
 ['新增消息',()=>controls.append()],
 ['追加流式内容',()=>controls.streamLatest()],
 ['刷新状态',()=>controls.status()],
 ['刷新在线状态',()=>controls.presence()],
];
for(const [label,action] of actions){
 const button=document.createElement('button');
 button.type='button';button.textContent=label;
 button.style.cssText='min-height:44px;padding:0 8px;border:1px solid #ad8244;border-radius:5px;background:#fff5df;color:#30250e;font:12px sans-serif';
 button.addEventListener('click',()=>{action();panel.dataset.lastAction=label;});
 panel.append(button);
}
document.body.append(panel);

}
