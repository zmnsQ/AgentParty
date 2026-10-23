/** Meta native MCP callback observed in the platform OAuth flow. Exact match,
 * not a wildcard domain allowlist. A public Client ID is not an access token. */
export const MUSE_NATIVE_REDIRECT="https://agent.meta.ai/api/hatch/oauth/callback";
// The existing NOT NULL secret_hash column can distinguish owner-bound public
// clients without a schema migration. This sentinel is never a usable secret.
export const MUSE_PUBLIC_PKCE="public-pkce";
export function nativeMuseRedirects(json:string):boolean {
 try{const values:unknown=JSON.parse(json);return Array.isArray(values)&&values.length===1&&values[0]===MUSE_NATIVE_REDIRECT;}catch{return false;}
}
export function nativeMuseScope(raw:string):string {
 const map:Record<string,string>={"mcp:read":"group.read","mcp:write":"group.write","mcp:events":"group.events"};
 return raw.split(/\s+/).map(scope=>map[scope]??scope).join(" ");
}
