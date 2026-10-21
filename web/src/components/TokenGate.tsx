import { githubLoginUrl, securityError } from "../lib/browserAuth";
import "./browser-auth.css";
// 登录闸（spec §10 双轨）：配置了 SSO provider 时先给 provider 登录，粘贴 token 始终保留
import { useState } from "react";
import type { AuthProviderConfig } from "../lib/oidc";
import { useT } from "../i18n/useT";
import { useLocale } from "../i18n/locale";
import { LanguageSwitcher } from "./LanguageSwitcher";
import "../i18n/strings/App";
import "../i18n/strings/TokenGate";

interface Props {
  github?: { configured: boolean; loading: boolean; error: unknown };
  error: string | null;
  providers: AuthProviderConfig[];
  onSso(provider: AuthProviderConfig): void;
  onSubmit(token: string): void;
}

export function TokenGate({ error, providers, onSso, onSubmit, github }: Props) {
  const [value, setValue] = useState("");
  const t = useT();
  const { locale } = useLocale();

  return (
    <main className="gate">
      <h1 className="d-title gate-title">
        Agent<span className="d-hl">Party</span>
      </h1>
      <p className="d-hand gate-sub">{t("TokenGate.subtitle")}</p>
      <div className="d-card gate-card">
        {github && <section className="browser-auth-stack">
          {github.configured ? <a className="d-btn d-btn--primary github-login-primary" href={githubLoginUrl()}>{locale === "zh" ? "使用 GitHub 登录" : "Continue with GitHub"}</a>
            : <button className="d-btn d-btn--primary" disabled>{github.loading ? (locale === "zh" ? "正在读取登录方式…" : "Loading sign-in…") : (locale === "zh" ? "GitHub 登录等待管理员完成配置" : "GitHub sign-in awaits administrator setup")}</button>}
          <p className="gate-social">{locale === "zh" ? "无需填写 token。登录后可在账号安全中启用验证器二步验证。" : "No token to paste. Enable authenticator verification in Account security after signing in."}</p>
          {github.error != null && <p className="banner banner--red" role="alert">{securityError(github.error, locale === "zh")}</p>}
        </section>}
        {providers.length > 0 && (
          <>
            {providers.map((provider) => (
              <button
                key={provider.id}
                className="d-btn d-btn--primary gate-btn"
                type="button"
                onClick={() => onSso(provider)}
              >
                {provider.label || (provider.type === "oidc"
                  ? t("App.auth.oidcSignIn")
                  : t("App.auth.providerSignIn", { id: provider.id }))}
              </button>
            ))}
            <p className="gate-social">{t("TokenGate.ssoHint")}</p>
            <p className="t-mono gate-or">{t("TokenGate.or")}</p>
          </>
        )}
        <details className="browser-auth-advanced"><summary>{locale === "zh" ? "高级：机器或旧版凭据" : "Advanced: machine or legacy credentials"}</summary>
        <form
          className="gate-form"
          onSubmit={(e) => {
            e.preventDefault();
            const token = value.trim();
            if (token) onSubmit(token);
          }}
        >
          <label className="t-mono gate-label" htmlFor="ap-token">
            {t("TokenGate.tokenLabel")}
          </label>
          <input
            id="ap-token"
            className="t-mono gate-input"
            type="password"
            placeholder="ap_…"
            autoComplete="off"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? "ap-token-error" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {error !== null && (
            <p id="ap-token-error" className="banner banner--red" role="alert">
              {error}
            </p>
          )}
          <button className="d-btn gate-btn" type="submit" disabled={value.trim() === ""}>
            {t("TokenGate.submit")}
          </button>
          <p className="gate-hint">party token create --name you --role human</p>
        </form>
        </details>
      </div>
      <div className="gate-lang">
        <LanguageSwitcher />
      </div>
      <p className="gate-byline">
        {t("TokenGate.bylineBy")}
        <a href={locale === "zh" ? "https://leeguoo.com/about" : "https://leeguoo.com/about/en"} rel="author">
          {t("TokenGate.bylineAuthor")}
        </a>
        {t("TokenGate.bylineAlias")}
        <a href={locale === "zh" ? "https://blog.leeguoo.com/zh/" : "https://blog.leeguoo.com/en/"}>
          {t("TokenGate.bylineBlog")}
        </a>
      </p>
    </main>
  );
}
