/** Non-sensitive, host-only UI preference mirrored for script-free OAuth pages.
 * Never used to grant access. Works without touching any authentication cookie. */
export function writePresentationCookie(name:"ap_theme"|"ap_locale",value:string):void {
  const allowed=name==="ap_theme"?["doodle","midnight"]:["en","zh"];
  if(!allowed.includes(value))return;
  try {
    if(typeof document==="undefined")return;
    const secure=typeof location!=="undefined"&&location.protocol==="https:"?"; Secure":"";
    document.cookie=`${name}=${value}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
  }catch{/* Restricted storage never prevents signing in or using the application. */}
}
