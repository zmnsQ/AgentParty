// @ts-expect-error Bun executes this test, while the web tsconfig intentionally loads only Vite globals.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LocaleProvider } from "../i18n/locale";

const { ChannelToolstrip } = await import("./ChannelToolstrip");

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
});

afterEach(async () => {
  if (renderer !== null) await act(async () => renderer?.unmount());
  renderer = null;
  Reflect.deleteProperty(globalThis, "localStorage");
});

function renderWithStorage(storage: Storage): ReactTestRenderer {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  let value!: ReactTestRenderer;
  void act(() => {
    value = create(
      <LocaleProvider>
        <ChannelToolstrip
          buttons={<button type="button">Announcement</button>}
          actions={<button type="button">Notify</button>}
        />
      </LocaleProvider>,
    );
  });
  renderer = value;
  return value;
}

function render(seed: Record<string, string> = {}): ReactTestRenderer {
  return renderWithStorage(memoryStorage({ ap_locale: "en", ...seed }));
}

function toggle(r: ReactTestRenderer) {
  return r.root.find((node) => node.props.className === "d-btn chan-toolstrip-toggle");
}

describe("ChannelToolstrip progressive disclosure", () => {
  test("starts collapsed and excludes hidden actions from keyboard navigation", () => {
    const r = render();
    expect(toggle(r).props["aria-expanded"]).toBe(false);
    expect(r.root.find(n => n.type === "div" && n.props.id === "channel-toolstrip-content").props.inert).toBe(true);
  });
  test("expands, collapses and restores the saved preference", async () => {
    const r = render();
    await act(async () => toggle(r).props.onClick());
    expect(toggle(r).props["aria-expanded"]).toBe(true);
    expect(localStorage.getItem("ap_channel_tools_expanded")).toBe("1");
    expect(r.root.find(n => n.type === "div" && n.props.id === "channel-toolstrip-content").props.inert).toBe(false);
    await act(async () => toggle(r).props.onClick());
    expect(toggle(r).props["aria-expanded"]).toBe(false);
    expect(localStorage.getItem("ap_channel_tools_expanded")).toBe("0");
  });
  test("honors an existing expanded preference", () => {
    expect(toggle(render({ap_channel_tools_expanded:"1"})).props["aria-expanded"]).toBe(true);
  });
  test("works when preference storage is unavailable", async () => {
    const storage = memoryStorage({ap_locale:"en"});
    storage.getItem = () => { throw new Error("private browsing"); };
    storage.setItem = () => { throw new Error("private browsing"); };
    const r = renderWithStorage(storage);
    expect(toggle(r).props["aria-expanded"]).toBe(false);
    await act(async () => toggle(r).props.onClick());
    expect(toggle(r).props["aria-expanded"]).toBe(true);
  });
});
