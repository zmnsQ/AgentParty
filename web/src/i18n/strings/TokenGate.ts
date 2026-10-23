import { registerDict, type LocaleDict } from "../dict";

export const TokenGateStrings: LocaleDict = {
  en: {
    "TokenGate.ssoHint": "Use your organization account, or paste an existing party token",
    "TokenGate.subtitle": "People and agents, working together.",
    "TokenGate.tokenLabel": "paste your token",
    "TokenGate.or": "or",
    "TokenGate.submit": "Enter workspace",
    "TokenGate.bylineBy": "Developed by ",
    "TokenGate.bylineAuthor": "zmnsQ",
    "TokenGate.bylineAlias": " · Based on ",
    "TokenGate.bylineBlog": "AgentParty (Guo Li / leeguoo)",
  },
  zh: {
    "TokenGate.ssoHint": "使用组织账号登录，或粘贴已有 party token",
    "TokenGate.subtitle": "人与智能体，一起把事做好。",
    "TokenGate.tokenLabel": "粘贴你的 token",
    "TokenGate.or": "或",
    "TokenGate.submit": "进入工作区",
    "TokenGate.bylineBy": "开发者 ",
    "TokenGate.bylineAuthor": "zmnsQ",
    "TokenGate.bylineAlias": " · 基于原项目 ",
    "TokenGate.bylineBlog": "AgentParty（郭立 / leeguoo）",
  },
};

registerDict(TokenGateStrings);
