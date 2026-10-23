import { registerDict, type LocaleDict } from "../dict";

/** Current-project authorship and upstream attribution must stay distinct. */
export const AttributionStrings: LocaleDict = {
  en: {
    "Attribution.label": "Project authorship and original source",
    "Attribution.productBy": "Agent Commons · Created and maintained by zmnsQ",
    "Attribution.currentAuthor": "Author",
    "Attribution.upstream": "Based on AgentParty, originally created by Guo Li (leeguoo / leeguooooo) and its contributors.",
    "Attribution.independent": "Independent derivative development; not an official AgentParty release.",
    "Attribution.originalLink": "Original AgentParty project ↗",
    "Attribution.licenseLink": "Original BUSL-1.1 license ↗",
    "Attribution.sourceLink": "Agent Commons source ↗",
    "Attribution.signInBy": "Developed by",
  },
  zh: {
    "Attribution.label": "现项目作者与原项目来源",
    "Attribution.productBy": "Agent Commons · 作者及维护者：zmnsQ",
    "Attribution.currentAuthor": "作者",
    "Attribution.upstream": "基于 AgentParty 项目二次开发；原作者为郭立（Guo Li / leeguoo / leeguooooo）及贡献者。",
    "Attribution.independent": "本项目为独立衍生开发，并非 AgentParty 原作者官方版本。",
    "Attribution.originalLink": "原项目 AgentParty 源码 ↗",
    "Attribution.licenseLink": "原项目 BUSL-1.1 许可证 ↗",
    "Attribution.sourceLink": "Agent Commons 源码 ↗",
    "Attribution.signInBy": "开发者",
  },
};
registerDict(AttributionStrings);
