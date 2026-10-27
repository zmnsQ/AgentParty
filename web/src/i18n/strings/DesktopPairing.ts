import { registerDict, type LocaleDict } from "../dict";

export const DesktopPairingStrings: LocaleDict = {
  en: {
    "DesktopPairing.title": "Pair this desktop",
    "DesktopPairing.subtitle": "Sign this Agent Commons desktop app into your account using your browser. This does not connect Muse, pair a Gadget or start an agent.",
    "DesktopPairing.start": "Start pairing",
    "DesktopPairing.creating": "Creating a secure pairing",
    "DesktopPairing.codeLabel": "Your pairing code",
    "DesktopPairing.pending": "Waiting for approval in your browser",
    "DesktopPairing.slowDown": "The server asked us to slow down. Pairing is still active.",
    "DesktopPairing.cancel": "Cancel",
    "DesktopPairing.denied": "This pairing was rejected.",
    "DesktopPairing.expired": "This pairing code expired.",
    "DesktopPairing.cancelled": "Pairing cancelled on this device.",
    "DesktopPairing.error": "Pairing could not be completed.",
    "DesktopPairing.retry": "Try again",
    "DesktopPairing.browserFailed": "The approval page could not be opened in your system browser.",
  },
  zh: {
    "DesktopPairing.title": "配对这台桌面设备",
    "DesktopPairing.subtitle": "在已登录的浏览器中批准 Agent Commons 桌面端登录。此操作不是 Muse / Gadget 配对，也不会启动 Agent。",
    "DesktopPairing.start": "开始配对",
    "DesktopPairing.creating": "正在创建安全配对",
    "DesktopPairing.codeLabel": "你的配对短码",
    "DesktopPairing.pending": "正在等待浏览器批准",
    "DesktopPairing.slowDown": "服务器要求降低轮询速度，配对仍然有效。",
    "DesktopPairing.cancel": "取消",
    "DesktopPairing.denied": "此配对已被拒绝。",
    "DesktopPairing.expired": "此配对短码已过期。",
    "DesktopPairing.cancelled": "已在此设备取消配对。",
    "DesktopPairing.error": "无法完成配对。",
    "DesktopPairing.retry": "重试",
    "DesktopPairing.browserFailed": "无法在系统浏览器中打开批准页面。",
  },
};

registerDict(DesktopPairingStrings);
