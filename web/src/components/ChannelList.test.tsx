// @ts-expect-error Bun executes this test, while the web tsconfig intentionally loads only Vite globals.
import { afterEach, describe, expect, test } from "bun:test";
import type { PresenceEntry } from "@agentparty/shared";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LocaleProvider } from "../i18n/locale";
import type { ChannelInfo } from "../lib/api";
import { ChannelList, lastMessagePreview, PresenceDots } from "./ChannelList";

let renderer: ReactTestRenderer | null = null;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

function presence(name: string, state: PresenceEntry["state"]): PresenceEntry {
  return { name, state, note: null, ts: 1 };
}

function channel(
  slug: string,
  options: {
    owned?: boolean;
    member?: boolean;
    presence?: PresenceEntry[];
  } = {},
): ChannelInfo {
  return {
    slug,
    title: slug,
    topic: null,
    kind: "standing",
    mode: "normal",
    visibility: "private",
    owned: options.owned,
    member: options.member,
    created_at: 1,
    archived_at: null,
    last_message: null,
    presence: options.presence ?? [],
  };
}

function listView(scope: string, channels: ChannelInfo[], active: string | null = null) {
  return (
    <LocaleProvider>
      <ChannelList
        scopeKey={scope}
        channels={channels}
        active={active}
        error={null}
        onOpen={() => {}}
      />
    </LocaleProvider>
  );
}

function categoryButton(r: ReactTestRenderer, category: "all" | "created" | "joined") {
  const categories = r.root.findAll(
    (node) => node.type === "button" && String(node.props.className ?? "").includes("chan-cat-btn"),
  );
  const index = category === "all" ? 0 : category === "created" ? 1 : 2;
  return categories[index]!;
}

function visibleChannelSlugs(r: ReactTestRenderer): string[] {
  return r.root
    .findAll((node) => node.type === "button" && String(node.props.className ?? "").includes("chan-pill"))
    .map((node) => String(node.props.title));
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe("ChannelList view-scoped filters", () => {
  test("server change resets a stale joined filter so the new server's real channels remain visible", () => {
    act(() => {
      renderer = create(
        listView("https://server-a.example:/", [
          channel("created-a", { owned: true }),
          channel("joined-a", { member: true }),
        ]),
      );
    });
    const r = renderer!;

    act(() => (categoryButton(r, "joined").props.onClick as () => void)());
    expect(visibleChannelSlugs(r)).toEqual(["joined-a"]);
    expect(categoryButton(r, "joined").props["aria-pressed"]).toBe(true);

    act(() => {
      r.update(
        listView("https://server-b.example:/", [
          channel("created-b", { owned: true }),
        ]),
      );
    });
    expect(visibleChannelSlugs(r)).toEqual(["created-b"]);
    expect(categoryButton(r, "all").props["aria-pressed"]).toBe(true);
  });

  test("route change resets the filter before rendering an externally opened active channel", () => {
    const channels = [
      channel("created-a", { owned: true }),
      channel("joined-a", { member: true }),
    ];
    act(() => {
      renderer = create(listView("https://server-a.example:/", channels));
    });
    const r = renderer!;

    act(() => (categoryButton(r, "joined").props.onClick as () => void)());
    expect(visibleChannelSlugs(r)).toEqual(["joined-a"]);

    act(() => {
      r.update(listView("https://server-a.example:/", channels, "created-a"));
    });
    expect(visibleChannelSlugs(r)).toEqual(["created-a", "joined-a"]);
    const active = r.root.findAll(
      (node) =>
        node.type === "button" &&
        String(node.props.className ?? "").includes("chan-pill") &&
        String(node.props.className ?? "").includes("is-active"),
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.props.title).toBe("created-a");
  });

  test("an explicit category choice remains active while the current route is unchanged", () => {
    const channels = [
      channel("created-a", { owned: true }),
      channel("joined-a", { member: true }),
    ];
    act(() => {
      renderer = create(listView("https://server-a.example", channels, "created-a"));
    });

    act(() => (categoryButton(renderer!, "joined").props.onClick as () => void)());

    expect(visibleChannelSlugs(renderer!)).toEqual(["joined-a"]);
    expect(categoryButton(renderer!, "joined").props["aria-pressed"]).toBe(true);
  });
});

describe("PresenceDots priority", () => {
  test("working and online members are selected before earlier offline records", () => {
    const value = channel("priority", {
      presence: [
        presence("offline-1", "offline"),
        presence("offline-2", "offline"),
        presence("offline-3", "offline"),
        presence("offline-4", "offline"),
        presence("waiting-live", "waiting"),
        presence("working-live", "working"),
      ],
    });
    act(() => {
      renderer = create(
        <LocaleProvider>
          <PresenceDots channel={value} />
        </LocaleProvider>,
      );
    });

    const dots = renderer!.root
      .findAll((node) => node.type === "span" && String(node.props.className ?? "").startsWith("d-dot "))
      .map((node) => String(node.props.title));
    expect(dots).toEqual([
      "working-live — working",
      "waiting-live — waiting",
      "offline-1 — offline",
      "offline-2 — offline",
    ]);
  });

  test("treats an omitted presence field as an empty legacy response", () => {
    const value = channel("legacy-response");
    delete (value as Partial<ChannelInfo>).presence;
    act(() => {
      renderer = create(
        <LocaleProvider>
          <PresenceDots channel={value} />
        </LocaleProvider>,
      );
    });

    expect(
      renderer!.root.findAll(
        (node) => node.type === "span" && node.props.className === "d-dot d-dot--offline",
      ),
    ).toHaveLength(1);
  });
});

describe("lastMessagePreview", () => {
  test("treats an omitted last_message field as no preview", () => {
    const value = channel("legacy-response");
    delete (value as Partial<ChannelInfo>).last_message;

    expect(lastMessagePreview(value)).toBeNull();
  });
});

describe('prototype conversation sidebar', () => {
  test('search filters real metadata, keeps archived matches accessible, and resets on server change', () => {
    const archived={...channel('archived-match'),archived_at:3};
    act(()=>{renderer=create(listView('server-one',[channel('live-one'),archived]));});
    const r=renderer!;
    act(()=>r.root.findByProps({type:'search'}).props.onChange({currentTarget:{value:'archived'}}));
    expect(visibleChannelSlugs(r)).toEqual(['archived-match']);
    act(()=>r.update(listView('server-two',[channel('new-live')])));
    expect(r.root.findByProps({type:'search'}).props.value).toBe('');
    expect(visibleChannelSlugs(r)).toEqual(['new-live']);
  });
  test('presence never becomes a fabricated agent roster and explicit roster has no online claim', () => {
    act(()=>{renderer=create(listView('server',[channel('live',{presence:[presence('human-name','working')]})]));});
    const r=renderer!;
    expect(r.root.findAllByProps({className:'prototype-sidebar-agents'})).toHaveLength(0);
    act(()=>r.update(<LocaleProvider><ChannelList scopeKey="server" channels={[channel('live')]} active="live" error={null} onOpen={()=>{}} agents={[{name:'agent-id',display:'Real nickname'},{name:'agent-id',display:'Real nickname'}]}/></LocaleProvider>));
    const roster=r.root.findByProps({className:'prototype-sidebar-agents'});
    expect(roster.findAllByType('li')).toHaveLength(1);
    expect(roster.findByProps({title:'agent-id'}).findAllByType('span').at(-1)!.children).toEqual(['Real nickname']);
    expect(roster.findAll(n=>String(n.props.className??'').includes('d-dot'))).toHaveLength(0);
    expect(r.root.findByProps({'aria-current':'page'}).props.title).toBe('live');
  });
  test('filtered channel opens with its stable slug, not its display title', () => {
    const opened:string[]=[];
    act(()=>{renderer=create(<LocaleProvider><ChannelList scopeKey="server" channels={[{...channel('stable-id'),title:'Design room'}]} active={null} error={null} onOpen={slug=>opened.push(slug)}/></LocaleProvider>);});
    const r=renderer!;act(()=>r.root.findByProps({type:'search'}).props.onChange({currentTarget:{value:'DESIGN'}}));
    act(()=>r.root.findByProps({title:'stable-id'}).props.onClick());expect(opened).toEqual(['stable-id']);
  });
});


test('prototype workspace actions use real callbacks and stable agent identity',()=>{
 let created=0;const selected:string[]=[];
 act(()=>{renderer=create(<LocaleProvider><ChannelList scopeKey="actions" channels={[channel('live')]} active="live" error={null} onOpen={()=>{}} onCreate={()=>created++} onAgentSelect={name=>selected.push(name)} agents={[{name:'stable-agent',display:'Friendly name'}]}/></LocaleProvider>);});
 const r=renderer!;
 expect(r.root.findByProps({className:'sidebar-top'})).toBeTruthy();
 expect(r.root.findByProps({className:'sidebar-category-filter'}).type).toBe('details');
 expect(r.root.findByProps({className:'sidebar-category-filter'}).props.open).toBeUndefined();
 act(()=>r.root.findAllByProps({className:'sidebar-icon-button'})[0]!.props.onClick());
 expect(created).toBe(1);
 act(()=>r.root.findByProps({title:'stable-agent'}).props.onClick());
 expect(selected).toEqual(['stable-agent']);
});
