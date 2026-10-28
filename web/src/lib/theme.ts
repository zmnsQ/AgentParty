import {writePresentationCookie} from "./presentationCookie";
// 主题：浅色（doodle）↔ 原型深色（midnight）。两套主题的 CSS 变量早已在
// styles/tokens.css 里按 :root[data-theme] 备好——这里只做「选哪套 + 记住选择」的纯客户端开关，
// 本地持久化，并用非敏感首方 cookie 将主题传给无脚本 OAuth 页面。
export type Theme = "doodle" | "midnight";

export const SUPPORTED_THEMES: { code: Theme; labelKey: string }[] = [
  { code: "doodle", labelKey: "App.settings.theme.paper" },
  { code: "midnight", labelKey: "App.settings.theme.midnight" },
];

export const DEFAULT_THEME: Theme = "midnight";

const STORAGE_KEY = "ap_theme";

export const THEME_UI_VERSION = "prototype-native-v1";
export const THEME_UI_VERSION_KEY = "ap_theme_ui_version";
export const PREVIOUS_THEME_KEY = "ap_theme_before_prototype_native_v1";
const isTheme = (value: unknown): value is Theme => value === "midnight" || value === "doodle";

/** Preserve the old presentation preference before the one-time prototype migration. */
function preservePreviousTheme(): void {
  const previous = localStorage.getItem(STORAGE_KEY);
  if (isTheme(previous) && localStorage.getItem(PREVIOUS_THEME_KEY) === null) {
    localStorage.setItem(PREVIOUS_THEME_KEY, previous);
  }
}

export function readPreviousTheme(): Theme | null {
  try { const value = localStorage.getItem(PREVIOUS_THEME_KEY); return isTheme(value) ? value : null; }
  catch { return null; }
}

export function readStoredTheme(): Theme {
  try {
    if (localStorage.getItem(THEME_UI_VERSION_KEY) !== THEME_UI_VERSION) {
      preservePreviousTheme();
      localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);
      localStorage.setItem(THEME_UI_VERSION_KEY, THEME_UI_VERSION);
      return DEFAULT_THEME;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

/** Explicit restoration only; never invoked automatically during startup. */
export function restorePreviousTheme(): boolean {
  const previous = readPreviousTheme();
  if (previous === null) return false;
  applyTheme(previous);
  return true;
}

export function applyTheme(theme: Theme): void {
  writePresentationCookie("ap_theme",theme);
  try {
    // guard：测试/SSR 里 document 可能是精简替身；缺 documentElement 时静默跳过。
    document?.documentElement?.setAttribute?.("data-theme", theme);
    document?.querySelector?.('meta[name="theme-color"]')?.setAttribute("content", theme === "midnight" ? "#191a1b" : "#f5f4ef");
  } catch {
    // 无 document 时不炸——本次仅持久化，下次带 document 的环境再落地。
  }
  try {
    if (localStorage.getItem(THEME_UI_VERSION_KEY) !== THEME_UI_VERSION) preservePreviousTheme();
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(THEME_UI_VERSION_KEY, THEME_UI_VERSION);
  } catch {
    // localStorage 不可用（隐私模式）时静默：本会话内切换仍生效，只是刷新不记。
  }
}

export function applyStoredTheme(): void {
  applyTheme(readStoredTheme());
}
