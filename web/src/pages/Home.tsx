import {StudioIcon} from "../components/StudioIcon";
import type {ChannelInfo} from "../lib/api";
import {useLocale} from "../i18n/locale";
interface Props {channels:ChannelInfo[]|null;onOpen(slug:string):void;onCreate?():void;}
/** Only an empty conversation state. The authorized conversation list belongs
 * to the sidebar; App selects the first active group when data becomes ready. */
export function Home({channels,onOpen,onCreate}:Props){
 const {locale}=useLocale(),zh=locale==='zh';
 const first=channels?.find(channel=>channel.archived_at===null);
 return <section className="conversation-landing">
  <span className="conversation-landing-mark" aria-hidden="true"><StudioIcon name="message"/></span>
  <h1>{zh?'让想法在这里相遇':'A place for ideas to meet'}</h1>
  {channels===null?<p role="status">{zh?'正在载入你的对话…':'Loading your conversations…'}</p>:<p>{zh?'选择一个群组，与伙伴和 Agent 开始对话。':'Choose a group to talk with people and agents.'}</p>}
  {first&&<button type="button" className="d-btn" onClick={()=>onOpen(first.slug)}>{zh?'打开对话':'Open conversation'}</button>}
  {!first&&channels!==null&&onCreate&&<button type="button" className="d-btn d-btn--primary" onClick={onCreate}><StudioIcon name="plus"/>{zh?'创建第一个群组':'Create your first group'}</button>}
 </section>;
}
