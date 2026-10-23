import {describe,expect,it} from "vitest";
import {oauthPresentation,renderOAuthConsent,renderOAuthProblem,type ConsentView} from "../src/collaboration/oauth-pages";
const view:ConsentView={id:"request_"+"a".repeat(64),nonce:"b".repeat(64),clientName:"ChatGPT",group:"ch-0123456789abcdef0123456789abcdef",groupTitle:"AI Agent 协作测试群",account:"github:123456",login:"test-owner",scopes:["group.read","group.write","group.events"],redirectUri:"https://chatgpt.com/connector_platform_oauth_redirect"};
describe("OAuth site-consistent presentation",()=>{
  it.each(["en","zh"] as const)("uses the brand, group name, account and all granted scopes in %s",async locale=>{
    const result=renderOAuthConsent(view,{locale,theme:"doodle"}),html=await result.text();
    expect(html).toContain('class="oauth-brand"');expect(html).toContain('data-theme="doodle"');
    expect(html).toContain('aria-current="step"');expect(html).toContain(view.groupTitle);
    expect(html).toContain("test-owner");expect(html).toContain("#"+view.group);
    for(const scope of view.scopes)expect(html).toContain(`<code>${scope}</code>`);
    expect(html).toContain('href="https://github.com/zmnsQ"');
    expect(html).toContain('href="https://github.com/leeguooooo/AgentParty"');
    expect(html).toContain("BUSL-1.1");
    expect(html).toContain('<form method="POST" action="/oauth/authorize">');
    expect(html).toContain('name="request_id" value="'+view.id+'"');
    expect(html).toContain('name="nonce" value="'+view.nonce+'"');
    expect(html).toContain('name="decision" value="approve"');
    expect(html).toContain('name="decision" value="deny"');
    expect(html).not.toContain("<script");expect(html).not.toContain("style=");
  });
  it("shows only approved scopes, not permissions removed by group policy",async()=>{
    const html=await renderOAuthConsent({...view,scopes:["group.read"]},{locale:"en",theme:"midnight"}).text();
    expect(html).toContain('data-theme="midnight"');expect(html).toContain("group.read");
    expect(html).not.toContain("group.write");expect(html).not.toContain("group.events");
  });
  it("escapes all untrusted display fields without granting more navigation",async()=>{
    const bad='<img src=x onerror="attack()">';
    const r=renderOAuthConsent({...view,groupTitle:bad,clientName:bad,login:bad},{locale:"en",theme:"doodle"});
    const html=await r.text();expect(html).not.toContain("<img");expect(html).toContain("&lt;img");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'self'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none';");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("keeps renewed consent explicit and never labels a fresh request as connected",async()=>{
    const html=await renderOAuthConsent({...view,renewal:"session_changed"},{locale:"en",theme:"doodle"}).text();
    expect(html).toContain('role="status"');expect(html).toContain("Access has not been granted");
    expect(html).toContain('name="decision" value="approve"');
  });
  it("reads only enumerated non-auth preferences, rejects duplicates, and falls back safely",()=>{
    expect(oauthPresentation(new Request("https://commons.test",{headers:{cookie:"ap_theme=midnight; ap_locale=zh","accept-language":"en"}}))).toEqual({theme:"midnight",locale:"zh"});
    expect(oauthPresentation(new Request("https://commons.test",{headers:{cookie:"ap_theme=<script>; ap_locale=unknown","accept-language":"zh-CN"}}))).toEqual({theme:"doodle",locale:"zh"});
    expect(oauthPresentation(new Request("https://commons.test",{headers:{cookie:"ap_theme=midnight; ap_theme=doodle; ap_locale=zh; ap_locale=en"}}))).toEqual({theme:"doodle",locale:"en"});
    expect(oauthPresentation(new Request("https://commons.test"))).toEqual({theme:"doodle",locale:"en"});
  });
  it.each(["invalid_or_expired_consent","invalid_origin","mfa_required","group_mcp_policy_denied","authorization_save_failed"] as const)("renders %s safely for humans, keeping JSON for API clients",async code=>{
    const browser=new Request("https://commons.test/oauth/authorize",{headers:{accept:"text/html",cookie:"ap_locale=zh; ap_theme=midnight"}});
    const r=renderOAuthProblem(browser,code,403),html=await r.text();
    expect(r.status).toBe(403);expect(r.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('class="oauth-brand"');expect(html).toContain('data-theme="midnight"');
    expect(html).toContain("本页面没有授予任何新的访问权限");expect(html).toContain("AgentParty");
    expect(html).not.toContain('<form');expect(html).not.toContain(view.nonce);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("content-security-policy")).not.toContain("chatgpt.com");
    const api=renderOAuthProblem(new Request("https://commons.test"),code,403);
    expect(api.status).toBe(403);expect(await api.json()).toEqual({error:code});
  });
});
