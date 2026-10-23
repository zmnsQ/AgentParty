/** CSS width alone misses phones whose browser requested a desktop viewport. */
export const COMPACT_MEDIA="(max-width: 760px), (max-device-width: 760px) and (pointer: coarse)";
export function isCompactViewport():boolean {
 return typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia(COMPACT_MEDIA).matches;
}
/** Keep keyboards inside the usable viewport. Never disable or reset pinch zoom. */
export function installMobileViewport():()=>void {
 const root=document.documentElement,viewport=window.visualViewport;
 const meta=document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
 const touch=window.matchMedia("(pointer: coarse)").matches;
 const screenWidth=window.screen.width;
 if(touch&&screenWidth>0&&screenWidth<=760&&window.innerWidth>screenWidth*1.3&&meta){
  meta.content=`width=${screenWidth}, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`;
 }
 let frame=0;
 const update=()=>{
  frame=0;
  const compact=isCompactViewport();root.classList.toggle("ac-mobile",compact);
  const physicalWidth=window.screen.width;
  const layoutScale=touch&&physicalWidth>0&&physicalWidth<=760&&window.innerWidth>physicalWidth*1.3?window.innerWidth/physicalWidth:1;
  root.style.setProperty("--ac-layout-scale",String(layoutScale));
  root.style.zoom=layoutScale>1?String(layoutScale):"";
  // A scaled visualViewport is user zoom, not a virtual keyboard.
  if(compact&&viewport&&Math.abs(viewport.scale-1)<0.05){
   root.style.setProperty("--ac-viewport-height",`${viewport.height}px`);
   root.style.setProperty("--ac-viewport-top",`${viewport.offsetTop}px`);
  }else{
   root.style.removeProperty("--ac-viewport-height");root.style.removeProperty("--ac-viewport-top");
  }
  const typing=!!document.activeElement?.closest(".composer");
  root.classList.toggle("ac-keyboard-open",compact&&typing&&!!viewport&&window.innerHeight-viewport.height>120);
 };
 const queue=()=>{if(!frame)frame=window.requestAnimationFrame(update);};
 update();window.addEventListener("resize",queue);viewport?.addEventListener("resize",queue);viewport?.addEventListener("scroll",queue);
 document.addEventListener("focusin",queue);document.addEventListener("focusout",queue);
 return()=>{if(frame)window.cancelAnimationFrame(frame);window.removeEventListener("resize",queue);viewport?.removeEventListener("resize",queue);viewport?.removeEventListener("scroll",queue);document.removeEventListener("focusin",queue);document.removeEventListener("focusout",queue);};
}
