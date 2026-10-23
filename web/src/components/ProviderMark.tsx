import {StudioIcon,type StudioIconName} from './StudioIcon';
const icons:Record<string,StudioIconName>={dot:'sparkles',muse:'cloud',cue:'play',grok:'search',hermes:'terminal',codebuddy:'code',codex:'terminal',claude:'files',other:'agent'};
/** Original monochrome platform markers, not third-party trademarks. */
export function ProviderMark({provider}:{provider:string}){
 return <span className="provider-mark" data-provider-mark={provider}><StudioIcon name={icons[provider]??'agent'} size={21}/></span>;
}
