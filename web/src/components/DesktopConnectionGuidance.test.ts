// @ts-expect-error Bun executes this test outside Vite globals.
import { expect, test } from "bun:test";
import { DesktopSettingsStrings } from "../i18n/strings/DesktopSettings";
import { DesktopPairingStrings } from "../i18n/strings/DesktopPairing";
import { PairStrings } from "../i18n/strings/Pair";
import { LocalAgentsOverviewStrings } from "../i18n/strings/LocalAgentsOverview";
import { InviteLandingStrings } from "../i18n/strings/InviteLanding";

test("desktop guidance separates setup, execution and connection in both locales", () => {
  for (const locale of ["en", "zh"] as const) {
    for (const step of [1, 2, 3]) expect(DesktopSettingsStrings[locale][`DesktopSettings.agent.setup${step}`]).toBeTruthy();
    expect(DesktopSettingsStrings[locale]["DesktopSettings.agent.empty"]).not.toContain("party init");
  }
  expect(DesktopSettingsStrings.en["DesktopSettings.agent.setup3"]).toContain("not just a saved configuration");
  expect(DesktopSettingsStrings.zh["DesktopSettings.agent.persistMode"]).not.toContain("不断线");
  expect(DesktopSettingsStrings.en["DesktopSettings.agent.empty"]).toContain("Configure local connector");
  expect(DesktopSettingsStrings.en["DesktopSettings.agent.empty"]).toContain("Advanced runtime options");
  expect(DesktopSettingsStrings.en["DesktopSettings.agent.empty"]).toContain("Manage resident sessions");
  expect(DesktopSettingsStrings.zh["DesktopSettings.agent.empty"]).toContain("高级：本地连接器（可选）");
  expect(DesktopSettingsStrings.en["DesktopSettings.agent.empty"]).toContain("Ordinary MCP authorization does not create");
  expect(DesktopSettingsStrings.zh["DesktopSettings.agent.empty"]).toContain("勿重复启动");
  expect(DesktopSettingsStrings.zh["DesktopSettings.agent.setup1"]).toContain("不读取普通 MCP");
  expect(LocalAgentsOverviewStrings.en["LocalAgents.empty"]).toContain("records");
  expect(LocalAgentsOverviewStrings.zh["LocalAgents.empty"]).toContain("记录");
});

test("desktop account approval and human invitations do not imply agent pairing", () => {
  expect(DesktopPairingStrings.en["DesktopPairing.subtitle"]).toContain("does not connect Muse");
  expect(DesktopPairingStrings.zh["DesktopPairing.subtitle"]).toContain("不是 Muse");
  expect(PairStrings.en["Pair.status.approved"]).toContain("separate step");
  expect(PairStrings.zh["Pair.status.approved"]).toContain("另外操作");
  expect(InviteLandingStrings.en["InviteLanding.signInHint"]).toContain("automatically joins");
  expect(InviteLandingStrings.zh["InviteLanding.signInHint"]).toContain("不会连接 Agent");
});
