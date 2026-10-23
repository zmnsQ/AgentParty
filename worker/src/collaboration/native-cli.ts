export function nativeCliRedirect(value:unknown):value is string {
 if(typeof value!=='string'||value.length>512||/[\\\s%]/.test(value))return false;
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?\//.test(value))return false;
 let u:URL;try{u=new URL(value);}catch{return false;}
 return u.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(u.hostname)&&!u.username&&!u.password&&!u.hash&&!u.search&&/^\/callback(?:\/[A-Za-z0-9_-]{1,100})?$/.test(u.pathname);
}
export function nativeCliRedirects(value:string):boolean {try{const v:unknown=JSON.parse(value);return Array.isArray(v)&&v.length>0&&v.every(nativeCliRedirect);}catch{return false;}}
