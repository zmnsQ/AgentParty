/** Coarse-pointer phones stay compact in landscape as well as portrait.
 * Device dimensions also cover a browser's requested desktop viewport without
 * rewriting its viewport metadata or scaling the document. Keep CSS in sync. */
export const COMPACT_MEDIA="(max-width: 760px), (max-height: 760px) and (pointer: coarse), (max-device-width: 760px) and (pointer: coarse), (max-device-height: 760px) and (pointer: coarse)";
export function isCompactViewport():boolean {
 return typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia(COMPACT_MEDIA).matches;
}
/** Keyboard sizing is in CSS pixels. Browser / pinch zoom belongs to the user. */
export function installMobileViewport():()=>void {
 const root=document.documentElement,viewport=window.visualViewport;
 const media=window.matchMedia(COMPACT_MEDIA);
 // Remove only the previous version's app-owned scaling, if retained by HMR.
 if(root.style.getPropertyValue("--ac-layout-scale")){
  root.style.removeProperty("zoom");root.style.removeProperty("--ac-layout-scale");
 }
 let frame=0;
 const update=()=>{
  frame=0;
  const compact=media.matches;root.classList.toggle("ac-mobile",compact);
  const unscaled=!!viewport&&Math.abs(viewport.scale-1)<0.05;
  if(compact&&unscaled&&Number.isFinite(viewport.height)&&viewport.height>0){
   root.style.setProperty("--ac-viewport-height",`${viewport.height}px`);
   root.style.setProperty("--ac-viewport-top",`${Math.max(0,viewport.offsetTop)}px`);
  }else{
   root.style.removeProperty("--ac-viewport-height");root.style.removeProperty("--ac-viewport-top");
  }
  const typing=!!document.activeElement?.closest(".composer");
  root.classList.toggle("ac-keyboard-open",compact&&typing&&unscaled&&window.innerHeight-viewport.height>120);
 };
 const queue=()=>{if(!frame)frame=window.requestAnimationFrame(update);};
 update();window.addEventListener("resize",queue);window.addEventListener("orientationchange",queue);
 media.addEventListener?.("change",queue);viewport?.addEventListener("resize",queue);viewport?.addEventListener("scroll",queue);
 document.addEventListener("focusin",queue);document.addEventListener("focusout",queue);
 return()=>{
  if(frame)window.cancelAnimationFrame(frame);
  window.removeEventListener("resize",queue);window.removeEventListener("orientationchange",queue);media.removeEventListener?.("change",queue);
  viewport?.removeEventListener("resize",queue);viewport?.removeEventListener("scroll",queue);
  document.removeEventListener("focusin",queue);document.removeEventListener("focusout",queue);
  root.classList.remove("ac-mobile","ac-keyboard-open");
  root.style.removeProperty("--ac-viewport-height");root.style.removeProperty("--ac-viewport-top");
 };
}
