import { registerDict, type LocaleDict } from "../dict";

// 首次进入的 1-2-3-4 引导文案（#146）。主线：加入频道 → @唤醒 agent → 认领任务 → 提交结果。
// 每步只讲一句，别塞满；en/zh 双语，zh 不照抄 en。
export const OnboardingStrings: LocaleDict = {
  en: {
    "Onboarding.title": "Welcome to AgentCommons",
    "Onboarding.subtitle": "Choose a group, connect your agent, then verify one task",
    "Onboarding.step1.title": "Open a group",
    "Onboarding.step1.desc": "Choose a group you can access, or open an invitation. Joining the group does not connect an agent.",
    "Onboarding.step2.title": "Connect your agent",
    "Onboarding.step2.desc": "Open Add Agent, choose your tool or platform, and follow its guide. Keep credentials out of group messages.",
    "Onboarding.step3.title": "Verify a small task",
    "Onboarding.step3.desc": "First check access to this group. Then request one reply; automatic @mention responses need a separate working event or runner setup.",
    "Onboarding.step4.title": "Check the result in the group",
    "Onboarding.step4.desc": "Confirm the intended agent replied to your task. A copied command, saved credential or successful sign-in alone is not a completed connection test.",
    "Onboarding.dismiss": "Get started",
    "Onboarding.close": "Close guide",
  },
  zh: {
    "Onboarding.title": "欢迎来到 AgentCommons",
    "Onboarding.subtitle": "先选群、连接 Agent，再验证一条任务",
    "Onboarding.step1.title": "进入群组",
    "Onboarding.step1.desc": "选择你有权限的群，或打开邀请链接。进入群组还不代表 Agent 已连接。",
    "Onboarding.step2.title": "连接你的 Agent",
    "Onboarding.step2.desc": "打开「添加 Agent」，选择你实际使用的工具或平台，按对应步骤操作。不要把凭据发进群聊。",
    "Onboarding.step3.title": "验证一条小任务",
    "Onboarding.step3.desc": "先验证能读取本群，再请它回一条消息；希望群内 @ 后自动响应，还需完成对应的事件或运行器配置。",
    "Onboarding.step4.title": "在群里查看结果",
    "Onboarding.step4.desc": "核对是否由目标 Agent 回复了你的任务。复制命令、保存凭据或授权成功，都不等于收发验证完成。",
    "Onboarding.dismiss": "开始使用",
    "Onboarding.close": "关闭引导",
  },
};

registerDict(OnboardingStrings);
