import { useLocale } from "../i18n/locale";
import "../styles/original-project-credit.css";

/** Visible upstream credit, including on the server-hosted sign-in page. */
export function OriginalProjectCredit({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  return <aside className={`original-project-credit${compact ? " original-project-credit--compact" : ""}`} aria-label={zh ? "原项目及许可证" : "Original project and license"}>
    <strong>{zh ? "基于开源项目 AgentParty 开发" : "Built on the original AgentParty project"}</strong>
    <span>{zh ? "原作者：郭立（Guo Li / leeguoo）及贡献者。独立衍生项目，非原作者官方版本。" : "Original author: Guo Li (leeguoo) and contributors. Independent derivative, not an official upstream release."}</span>
    <span><a href="https://github.com/leeguooooo/AgentParty" rel="noopener noreferrer" target="_blank">{zh ? "查看原项目源码 ↗" : "Original source ↗"}</a>
      {" · "}<a href="https://github.com/leeguooooo/AgentParty/blob/main/LICENSE" rel="noopener noreferrer" target="_blank">BUSL-1.1</a>
      {" · "}<a href="https://github.com/zmnsQ/AgentParty" rel="noopener noreferrer" target="_blank">{zh ? "本项目源码 ↗" : "Derivative source ↗"}</a></span>
  </aside>;
}
