// i18n 核心：语言状态 + 持久化。默认英文；已支持 en/zh，新增语言只需加一个 dict 模块 +
// 在 SUPPORTED_LOCALES 里挂一行（为未来 ja/ko 留位，不在此实现——机翻质量没法把关）。
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Locale = "en" | "zh";

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "zh", label: "中" },
];

export const DEFAULT_LOCALE: Locale = "en";

const STORAGE_KEY = "ap_locale";

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "en" || v === "zh" ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function writeStoredLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage 不可用（隐私模式等）时静默——本次会话内切换仍生效，只是刷新不记
  }
}

interface LocaleContextValue {
  locale: Locale;
  setLocale(locale: Locale): void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());
  // Accessibility and browser language reporting follow the chosen UI locale.
  useEffect(() => {
    const html = typeof document !== "undefined" ? document.documentElement : undefined;
    if (html) html.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}
