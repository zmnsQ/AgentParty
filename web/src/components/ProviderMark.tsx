import { PlatformIcon } from './PlatformIcon';
/** Known platform branding; unavailable marks use the same neutral Agent glyph. */
export function ProviderMark({provider}:{provider:string}){
 return <span className="provider-mark" data-provider-mark={provider}><PlatformIcon platform={provider} size={21} decorative /></span>;
}
