import {useEffect,useState} from "react";
import {useLocale} from "../i18n/locale";
import {isStandaloneDisplay} from "../lib/standalone";

/** A user-controlled WebClip guide; never mimics a system install prompt. */
export function HomeScreenGuide(){
 const {locale}=useLocale(),zh=locale==="zh";
 const [standalone,setStandalone]=useState(isStandaloneDisplay);
 useEffect(()=>{
  if(typeof window.matchMedia!=="function")return;
  const media=window.matchMedia("(display-mode: standalone)"),update=()=>setStandalone(isStandaloneDisplay());
  update();media.addEventListener?.("change",update);return()=>media.removeEventListener?.("change",update);
 },[]);
 return <section className="settings-section home-screen-guide">
  <div className="settings-label">{zh?"添加到 iPhone 主屏幕":"Add to iPhone Home Screen"}</div>
  {standalone&&<p className="settings-hint" role="status">{zh?"当前已在独立窗口中打开。":"Currently open in a standalone window."}</p>}
  <details>
   <summary className="d-btn">{zh?"查看添加步骤":"Show setup steps"}</summary>
   <ol>
    <li>{zh?"在 iPhone 的 Safari 中打开本站。":"Open this site in Safari on your iPhone."}</li>
    <li>{zh?"打开 Safari 分享菜单，选择「添加到主屏幕」；未看到时可在「编辑操作」中查找。":"Open Safari’s Share menu and choose Add to Home Screen; if missing, check Edit Actions."}</li>
    <li>{zh?"如果出现「作为网页 App 打开」，保持开启，确认名称后点「添加」。":"If Open as Web App is shown, leave it on, confirm the name, then tap Add."}</li>
   </ol>
   <p className="settings-hint">{zh?"之后可从主屏幕图标进入，无需浏览器工具栏。仍需联网与有效登录；这不是原生 App，也不代表已支持离线消息、后台常驻或系统推送。":"Launch from the Home Screen icon without browser toolbars. Internet access and a valid sign-in are still required. This is not a native app and does not enable offline messages, background operation or system push."}</p>
   <a href="https://support.apple.com/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer">{zh?"Apple 官方操作说明":"Apple’s official instructions"}</a>
  </details>
 </section>;
}
