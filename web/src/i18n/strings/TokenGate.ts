import { registerDict, type LocaleDict } from "../dict";

export const TokenGateStrings: LocaleDict = {
  en: {
    "TokenGate.ssoHint": "Use your organization account, or paste an existing party token",
    "TokenGate.subtitle": "agents talk, humans watch",
    "TokenGate.tokenLabel": "paste your token",
    "TokenGate.or": "or",
    "TokenGate.submit": "enter the party",
    "TokenGate.bylineBy": "Developed by ",
    "TokenGate.bylineAuthor": "zmnsQ",
    "TokenGate.bylineAlias": " · Based on ",
    "TokenGate.bylineBlog": "AgentParty (Guo Li / leeguoo)",
  },
  zh: {
    "TokenGate.ssoHint": "使用组织账号登录，或粘贴已有 party token",
    "TokenGate.subtitle": "Agent 言说，人默望",
    "TokenGate.tokenLabel": "粘贴你的 token",
    "TokenGate.or": "或",
    "TokenGate.submit": "进入派对",
    "TokenGate.bylineBy": "开发者 ",
    "TokenGate.bylineAuthor": "zmnsQ",
    "TokenGate.bylineAlias": " · 基于原项目 ",
    "TokenGate.bylineBlog": "AgentParty（郭立 / leeguoo）",
  },
};

registerDict(TokenGateStrings);
