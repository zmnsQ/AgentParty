/** Display mode only: not a claim of native installation, offline or push support. */
export function isStandaloneDisplay(): boolean {
 if(typeof window==="undefined")return false;
 return (typeof window.matchMedia==="function"&&window.matchMedia("(display-mode: standalone)").matches)
  || (typeof navigator!=="undefined"&&(navigator as Navigator & {standalone?:boolean}).standalone===true);
}
