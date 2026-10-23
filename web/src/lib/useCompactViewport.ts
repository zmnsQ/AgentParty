import {useEffect,useState} from "react";
import {COMPACT_MEDIA,isCompactViewport} from "./mobileViewport";
export function useCompactViewport():boolean {
 const [compact,setCompact]=useState(isCompactViewport);
 useEffect(()=>{
  if(typeof window==="undefined"||typeof window.matchMedia!=="function")return;
  const media=window.matchMedia(COMPACT_MEDIA),sync=()=>setCompact(media.matches);
  sync();media.addEventListener?.("change",sync);
  return()=>media.removeEventListener?.("change",sync);
 },[]);
 return compact;
}
