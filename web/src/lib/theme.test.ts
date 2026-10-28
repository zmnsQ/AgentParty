// @ts-expect-error Bun executes this test; the web tsconfig only loads Vite globals.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { applyStoredTheme, applyTheme, DEFAULT_THEME, readStoredTheme, SUPPORTED_THEMES, THEME_UI_VERSION, THEME_UI_VERSION_KEY, PREVIOUS_THEME_KEY, readPreviousTheme, restorePreviousTheme } from "./theme";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

let attribute: string | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage() });
  attribute = null;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        setAttribute: (name: string, value: string) => { if (name === "data-theme") attribute = value; },
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "document");
});

describe("theme persistence + application", () => {
  test("defaults to prototype charcoal when nothing stored", () => {
    expect(DEFAULT_THEME).toBe("midnight");
    expect(readStoredTheme()).toBe("midnight");
  });

  test("migrates legacy light once while preserving it for explicit restoration", () => {
    localStorage.setItem("ap_theme", "doodle");
    expect(readStoredTheme()).toBe("midnight");
    expect(readPreviousTheme()).toBe("doodle");
    expect(localStorage.getItem(THEME_UI_VERSION_KEY)).toBe(THEME_UI_VERSION);
    applyTheme("doodle");
    expect(readStoredTheme()).toBe("doodle");
    expect(readPreviousTheme()).toBe("doodle");
  });
  test("explicit later light theme is not reset, and legacy preference remains restorable", () => {
    localStorage.setItem("ap_theme", "doodle");
    applyStoredTheme();expect(attribute).toBe("midnight");
    expect(restorePreviousTheme()).toBe(true);expect(attribute).toBe("doodle");
    applyStoredTheme();expect(attribute).toBe("doodle");
    expect(localStorage.getItem(PREVIOUS_THEME_KEY)).toBe("doodle");
  });
  test("restoration without an old preference is a no-op", () => {
    expect(restorePreviousTheme()).toBe(false);
    expect(localStorage.getItem("ap_theme")).toBeNull();
  });
  test("explicit choice before startup migration is respected", () => {
    localStorage.setItem("ap_theme", "midnight");applyTheme("doodle");
    expect(readStoredTheme()).toBe("doodle");expect(readPreviousTheme()).toBe("midnight");
  });

  test("reads a stored midnight theme", () => {
    localStorage.setItem("ap_theme", "midnight");
    expect(readStoredTheme()).toBe("midnight");
  });

  test("falls back to default for an unknown stored value", () => {
    localStorage.setItem("ap_theme", "banana");
    expect(readStoredTheme()).toBe("midnight");
  });

  test("applyTheme sets the data-theme attribute and persists", () => {
    applyTheme("midnight");
    expect(attribute).toBe("midnight");
    expect(localStorage.getItem("ap_theme")).toBe("midnight");
    applyTheme("doodle");
    expect(attribute).toBe("doodle");
    expect(localStorage.getItem("ap_theme")).toBe("doodle");
  });

  test("applyStoredTheme applies whatever was persisted", () => {
    localStorage.setItem("ap_theme", "midnight");
    applyStoredTheme();
    expect(attribute).toBe("midnight");
  });

  test("exposes exactly the two shipped themes", () => {
    expect(SUPPORTED_THEMES.map((theme) => theme.code)).toEqual(["doodle", "midnight"]);
  });
});

test('existing migration backup is never overwritten by later theme choices', () => {
  localStorage.setItem(PREVIOUS_THEME_KEY, 'doodle');
  localStorage.setItem('ap_theme', 'midnight');
  readStoredTheme();applyTheme('midnight');applyTheme('doodle');
  expect(localStorage.getItem(PREVIOUS_THEME_KEY)).toBe('doodle');
  expect(readStoredTheme()).toBe('doodle');
});
test('unavailable preference storage still applies safe default without throwing', () => {
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}}});
  expect(readStoredTheme()).toBe('midnight');applyTheme('doodle');expect(attribute).toBe('doodle');expect(readPreviousTheme()).toBeNull();
});
