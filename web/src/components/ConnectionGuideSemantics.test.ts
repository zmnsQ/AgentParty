// @ts-expect-error Bun test API is not part of browser tsconfig.
import {expect,test} from "bun:test";
import {AgentTokensStrings} from "../i18n/strings/AgentTokens";
import {AgentJoinStrings} from "../i18n/strings/AgentJoin";
import {ConnectorUsageStrings} from "../i18n/strings/ConnectorUsage";
import {OnboardingStrings} from "../i18n/strings/Onboarding";
test("all general connection guides have matching English and Chinese keys",()=>{
 for(const dict of [AgentTokensStrings,AgentJoinStrings,ConnectorUsageStrings,OnboardingStrings])expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.zh).sort());
});
test("saved credentials and runtime evidence are not labelled automatic availability",()=>{
 expect(AgentTokensStrings.en["AgentTokens.plaintextReady"]).toContain("browser");
 expect(AgentTokensStrings.zh["AgentTokens.plaintextReady"]).toContain("浏览器");
 expect(AgentTokensStrings.en["AgentTokens.noPlaintextHint"]).toContain("original browser or execution machine");
 expect(AgentTokensStrings.zh["AgentTokens.noPlaintextHint"]).toContain("原浏览器或运行设备");
 expect(AgentJoinStrings.en["AgentJoin.step3.done"]).toContain("verify a reply");
 expect(AgentJoinStrings.zh["AgentJoin.step3.done"]).toContain("验证回帖");
 expect(AgentJoinStrings.en["AgentJoin.step4.doneSelf"]).toContain("reported a self-test");
 expect(AgentJoinStrings.zh["AgentJoin.step4.doneSelf"]).toContain("报告已自检");
});
test("first-run and connector guides distinguish a real read from blank or copied output",()=>{
 expect(OnboardingStrings.en["Onboarding.step2.desc"]).toContain("Add Agent");
 expect(OnboardingStrings.zh["Onboarding.step2.desc"]).toContain("添加 Agent");
 expect(OnboardingStrings.en["Onboarding.step4.desc"]).toContain("not a completed connection test");
 expect(OnboardingStrings.zh["Onboarding.step4.desc"]).toContain("不等于收发验证完成");
 expect(ConnectorUsageStrings.en["ConnectorUsage.step1Expect"]).toContain("failed request");
 expect(ConnectorUsageStrings.zh["ConnectorUsage.step1Expect"]).toContain("请求失败");
});
