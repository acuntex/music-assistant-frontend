import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProgramBusPanel from "@/components/ProgramBusPanel.vue";
import { i18n } from "@/plugins/i18n";
import type { ProgramBusEnded, ProgramBusView } from "@/plugins/api/interfaces";

const apiMock = vi.hoisted(() => ({ sendCommand: vi.fn() }));
const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  showFullscreenPlayer: true,
  showPlayersMenu: true,
}));

vi.mock("@/plugins/api", () => ({ default: apiMock, api: apiMock }));
vi.mock("@/plugins/router", () => ({ default: routerMock }));
vi.mock("@/plugins/store", () => ({ store: storeMock }));

const QUEUE_ID = "queue-1";

function busView(overrides: Partial<ProgramBusView> = {}): ProgramBusView {
  return {
    enabled: true,
    session_active: true,
    no_audible_position: false,
    format: { sample_rate: 48000, bit_depth: 32, channels: 2 },
    claims: { flow: false, boundary: false },
    overlays: [],
    last: [],
    ...overrides,
  };
}

function endedPrograms(count: number): ProgramBusEnded[] {
  return Array.from({ length: count }, (_, index) => ({
    label: `Program ${index + 1}`,
    state: "aired" as const,
    reason: null,
    frames: 48000,
  }));
}

async function mountPanel(view: ProgramBusView | Error = busView()) {
  if (view instanceof Error) {
    apiMock.sendCommand.mockRejectedValue(view);
  } else {
    apiMock.sendCommand.mockResolvedValue(view);
  }
  const wrapper = mount(ProgramBusPanel, {
    props: { queueId: QUEUE_ID },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return wrapper;
}

// the node's own link opens the program list, so listing costs no row of its own
function nodeLink(wrapper: VueWrapper) {
  return wrapper.get("button.audio-processing-stage-title");
}

async function openDetails(wrapper: VueWrapper) {
  await nodeLink(wrapper).trigger("click");
}

// most of what the bus holds is only shown once the reader asks for it
async function mountOpenPanel(view: ProgramBusView = busView()) {
  const wrapper = await mountPanel(view);
  await openDetails(wrapper);
  return wrapper;
}

function subtitleParts(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll(".audio-processing-stage-subtitle-part")
    .map((part) => part.text().replace(/^[\u00a0 ]*·\s*/, ""));
}

function subtitleLines(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll(".audio-processing-stage-subtitle-line")
    .map((line) => line.text());
}

// the parts hold a non-breaking space before their separator, so the browser can
// not drop it at the start of the inline-block; the row reads with plain spaces
function statusLine(wrapper: VueWrapper): string {
  return wrapper
    .get(".audio-processing-stage-subtitle")
    .text()
    .replaceAll("\u00a0", " ");
}

function infoText(wrapper: VueWrapper): string {
  return wrapper.get(".audio-processing-stage .sr-only").text();
}

function infoLines(wrapper: VueWrapper): string[] {
  const description = infoText(wrapper);
  return description ? description.split(". ") : [];
}

beforeEach(() => {
  i18n.global.locale.value = "en";
  apiMock.sendCommand.mockReset();
  routerMock.push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProgramBusPanel", () => {
  it("reads the bus of its own queue", async () => {
    await mountPanel();

    expect(apiMock.sendCommand).toHaveBeenCalledWith("streams/program_bus", {
      queue_id: QUEUE_ID,
    });
  });

  it("shows nothing while the bus is off", async () => {
    const wrapper = await mountPanel(
      busView({
        enabled: false,
        session_active: false,
        format: null,
      }),
    );

    // the bus is an experimental switch: a reader without it sees the chain as if
    // there were no bus, not the off state of a feature they never turned on
    expect(wrapper.find('[data-testid="program-bus"]').exists()).toBe(false);
    expect(wrapper.find(".audio-processing-stage").exists()).toBe(false);
    expect(wrapper.find(".audio-processing-header").exists()).toBe(false);
    expect(wrapper.text()).toBe("");
  });

  it("leaves the off hint to the queue DJ status", async () => {
    const wrapper = await mountPanel(
      busView({ enabled: false, session_active: false, format: null }),
    );

    // "DJ is on, bus is off" belongs where the switch lives, not in this panel
    expect(wrapper.text()).not.toContain("Streams settings");
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("shows nothing before its first reading arrives", async () => {
    let answer: (view: ProgramBusView) => void = () => undefined;
    apiMock.sendCommand.mockReturnValue(
      new Promise<ProgramBusView>((resolve) => {
        answer = resolve;
      }),
    );
    const wrapper = mount(ProgramBusPanel, {
      props: { queueId: QUEUE_ID },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    // the panel can not know whether the bus is on, so it claims no section at all
    expect(wrapper.find('[data-testid="program-bus"]').exists()).toBe(false);
    expect(wrapper.text()).toBe("");

    answer(busView());
    await flushPromises();
    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe("On");
  });

  it("names its group after what it holds, not after its only row", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.get(".audio-processing-header-title").text()).toBe(
      "Programs",
    );
    expect(wrapper.get(".audio-processing-stage-title").text()).toBe(
      "Program bus",
    );
  });

  it("heads the section like its neighbours, with a neutral dot", async () => {
    const wrapper = await mountPanel();

    // INPUT and OUTPUT colour their dot by quality; a live bus is not a quality,
    // so its dot stays the neutral one PROCESSING uses
    const dot = wrapper.get(".audio-processing-quality-dot");
    expect(dot.classes()).toContain("audio-processing-quality-dot--neutral");
    expect(dot.attributes("style")).toBeUndefined();
    expect(wrapper.find(".audio-processing-header-rule").exists()).toBe(true);
  });

  it("states the bus status once, in the header line", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe("On");
    // the stage carries no second badge: badges here are for "bit perfect"
    expect(wrapper.find(".audio-processing-stage-badge").exists()).toBe(false);
    expect(wrapper.text().match(/On/g)).toHaveLength(1);
  });

  it("reads like its neighbours, in a status row of facts", async () => {
    const wrapper = await mountPanel();

    // the channel count is read as a word, like the neighbours' format rows
    expect(statusLine(wrapper)).toBe("48 kHz · 32-bit · Stereo");
    // nothing to count, so no second row and no sentence in the closed node
    expect(wrapper.findAll(".audio-processing-stage-subtitle")).toHaveLength(1);
    expect(statusLine(wrapper)).not.toMatch(/\. /);
    // the state a live session is in costs the row nothing; the tooltip has it
    expect(statusLine(wrapper)).not.toContain("Session active");
    expect(infoText(wrapper)).toContain("Session active");
    expect(infoText(wrapper)).toContain("Nothing scheduled");
  });

  it.each([
    [1, "Mono"],
    [2, "Stereo"],
    [6, "6 channels"],
  ])("names %i channels as %s", async (channels, label) => {
    const wrapper = await mountPanel(
      busView({ format: { sample_rate: 44100, bit_depth: 24, channels } }),
    );

    expect(statusLine(wrapper)).toBe(`44.1 kHz · 24-bit · ${label}`);
  });

  it("keeps its facts on one row whatever the language and width", async () => {
    const wrapper = await mountPanel();

    // one text row with atomic parts, so nothing wraps onto a line of its own
    const parts = subtitleParts(wrapper);
    expect(parts).toEqual(["48 kHz", "32-bit", "Stereo"]);
    expect(
      wrapper
        .findAll(".audio-processing-stage-subtitle-part")
        .every((part) =>
          part.classes("audio-processing-stage-subtitle-part--atomic"),
        ),
    ).toBe(true);
  });

  it("counts what it holds instead of explaining itself in the node", async () => {
    const wrapper = await mountPanel(
      busView({
        claims: { flow: true, boundary: true },
        last: endedPrograms(2),
      }),
    );

    expect(subtitleLines(wrapper)).toEqual(["2 played"]);
    // nothing explanatory costs a row: the claims and the scope are in the tooltip
    const rows = [statusLine(wrapper), ...subtitleLines(wrapper)].join(" ");
    expect(rows).not.toContain("Mixes into this player's stream");
    expect(rows).not.toContain("Crosses track boundaries");
    expect(rows).not.toContain(
      "Applies to the flow sessions of this player only",
    );
    expect(rows).not.toContain("before the track ends");
    const info = infoText(wrapper);
    expect(info).toContain("Mixes into this player's stream");
    expect(info).toContain("Crosses track boundaries");
    expect(info).toContain("Applies to the flow sessions of this player only");
  });

  it("explains the format behind the info button, not in a row", async () => {
    const wrapper = await mountPanel();

    expect(infoLines(wrapper)).toContain(
      "Programs have to arrive as 48 kHz · 32-bit · Stereo to be mixed",
    );
    // a bus that holds nothing adds no second row at all
    expect(
      wrapper.findAll(".audio-processing-stage-subtitle-line"),
    ).toHaveLength(0);
  });

  it("takes the info button when the node has nothing to explain", async () => {
    const wrapper = await mountPanel(
      busView({ session_active: false, format: null }),
    );

    // the info button is there for the scope note alone, so it stays reachable
    expect(wrapper.find(".audio-processing-stage-info").exists()).toBe(true);
  });

  it("says it is idle when no flow session mixes programs", async () => {
    const wrapper = await mountPanel(
      busView({
        session_active: false,
        format: null,
        last: endedPrograms(2),
      }),
    );

    expect(statusLine(wrapper)).toBe("Idle");
    expect(subtitleLines(wrapper)).toEqual(["2 played"]);
    expect(infoLines(wrapper)).toContain("No flow session is mixing programs");
  });

  it("says placement is paused in the tooltip, not in the row", async () => {
    const wrapper = await mountPanel(busView({ no_audible_position: true }));

    expect(statusLine(wrapper)).toBe("48 kHz · 32-bit · Stereo");
    expect(infoLines(wrapper)).toContain("Placement paused — position unknown");
  });

  it("stays out of the chain when its first reading fails", async () => {
    const wrapper = await mountPanel(new Error("connection lost"));

    // a failed read can not tell whether the bus is on, so the panel claims no
    // section instead of showing one to every reader
    expect(wrapper.find('[data-testid="program-bus"]').exists()).toBe(false);
    expect(wrapper.text()).toBe("");
  });

  it("keeps the missing reading inside the stage node", async () => {
    vi.useFakeTimers();
    const wrapper = await mountPanel();
    apiMock.sendCommand.mockRejectedValue(new Error("connection lost"));

    vi.advanceTimersByTime(3000);
    await flushPromises();

    const stage = wrapper.get(".audio-processing-stage");
    // the reading is missing, so the counted row says so instead of the counts
    expect(subtitleLines(wrapper)).toEqual([
      "Program bus status is unavailable",
    ]);
    expect(
      stage
        .get(
          ".audio-processing-stage-copy .audio-processing-stage-subtitle-line",
        )
        .text(),
    ).toBe("Program bus status is unavailable");
    // nothing but the stage sits between the header and the outputs, so the
    // chain's connector line is not interrupted
    expect(
      wrapper.get(".audio-processing-section").element.children,
    ).toHaveLength(1);
  });

  it("shows a planned program with its label, state and seconds to go", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7.4,
            frames: 48000,
            head_seconds: 4,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-overlay"]');
    expect(row.text()).toContain("Transition");
    expect(row.text()).toContain("scheduled");
    expect(row.text()).toContain("in 00:07");
    expect(wrapper.find('[data-testid="program-bus-last"]').exists()).toBe(
      false,
    );
  });

  it("says a program starting now instead of counting down", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Announcement",
            state: "scheduled",
            start_in_seconds: 0,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-overlay"]');
    expect(row.text()).toContain("now");
    expect(row.text()).not.toContain("0:00");
  });

  it("keeps an unknown start unknown instead of making one up", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "orphaned",
            start_in_seconds: null,
            frames: 48000,
            head_seconds: 4,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-overlay"]');
    expect(row.text()).toContain("will play when the queue moves on");
    expect(row.text()).toContain("start unknown");
  });

  it("shows why a program was dropped", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        last: [
          {
            label: "Weather",
            state: "dropped",
            reason: "too_late",
            frames: 48000,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-last"]');
    expect(row.text()).toContain("Weather");
    // the ledger says "dropped"; the row says what the listener saw happen
    expect(row.text()).toContain("skipped");
    expect(row.text()).not.toContain("dropped");
    expect(row.text()).toContain("missed its boundary");
    expect(row.text()).not.toContain("too_late");
  });

  it("shows an aired program without a reason", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        last: [
          { label: "Weather", state: "aired", reason: null, frames: 48000 },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-last"]');
    expect(row.text()).toContain("played");
    expect(row.text()).not.toContain("aired");
    expect(row.text()).not.toContain("null");
  });

  it("names an ended program in the reader's words, not the ledger's", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        last: [
          { label: "Weather", state: "aired", reason: null, frames: 48000 },
          {
            label: "News",
            state: "dropped",
            reason: "bus_replaced",
            frames: 48000,
          },
        ],
      }),
    );

    const rows = wrapper.findAll('[data-testid="program-bus-ended"]');
    expect(
      rows.map((row) => row.find(".program-bus-row-state").text()),
    ).toEqual(["played", "skipped"]);
    expect(wrapper.get('[data-testid="program-bus-reason"]').text()).toBe(
      "replaced",
    );
    expect(wrapper.text()).not.toMatch(/aired|dropped|bus_replaced/);
  });

  it("says a reason that only repeats the status word once", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        last: [
          {
            label: "Weather",
            state: "dropped",
            reason: "skipped",
            frames: 48000,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-ended"]');
    expect(
      row.findAll(".program-bus-row-state").map((cell) => cell.text()),
    ).toEqual(["skipped"]);
    expect(row.text()).toContain("Weather");
    // the reason is the same word, so it is not spelled twice
    expect(row.find('[data-testid="program-bus-reason"]').exists()).toBe(false);
  });

  it("says nothing is scheduled in the tooltip, not in a row", async () => {
    const wrapper = await mountPanel(busView({ overlays: [], last: [] }));

    expect(subtitleLines(wrapper)).toEqual([]);
    expect(infoText(wrapper)).toContain("Nothing scheduled");
  });

  it("adds the counted row as soon as a program is there", async () => {
    const wrapper = await mountPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    expect(subtitleLines(wrapper)).toEqual(["1 scheduled"]);
  });

  it("keeps a reading it already had when the command fails", async () => {
    vi.useFakeTimers();
    const wrapper = await mountPanel();
    apiMock.sendCommand.mockRejectedValue(new Error("connection lost"));

    vi.advanceTimersByTime(3000);
    await flushPromises();

    // the bus keeps mixing; only its reading is missing
    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe("On");
    expect(subtitleLines(wrapper)).toEqual([
      "Program bus status is unavailable",
    ]);
    expect(wrapper.find('[data-testid="program-bus-overlay"]').exists()).toBe(
      false,
    );
  });

  it("keeps what it had when a later poll fails", async () => {
    vi.useFakeTimers();
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 4,
            late_by_seconds: 0,
          },
        ],
      }),
    );
    apiMock.sendCommand.mockRejectedValue(new Error("connection lost"));

    vi.advanceTimersByTime(3000);
    await flushPromises();

    expect(wrapper.text()).toContain("Transition");
    expect(wrapper.text()).toContain("Program bus status is unavailable");
  });

  it("polls while it is open and stops when it closes", async () => {
    vi.useFakeTimers();
    const wrapper = await mountPanel();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    await flushPromises();
    vi.advanceTimersByTime(3000);
    await flushPromises();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(3);

    wrapper.unmount();
    vi.advanceTimersByTime(30000);
    await flushPromises();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(3);
  });

  it("polls no faster than every two seconds", async () => {
    vi.useFakeTimers();
    await mountPanel();

    vi.advanceTimersByTime(1999);
    await flushPromises();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(1);
  });

  it("is no control: a program never plays, seeks or drags", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 4,
            late_by_seconds: 0,
          },
        ],
        last: [
          { label: "Weather", state: "aired", reason: null, frames: 48000 },
        ],
      }),
    );

    expect(
      wrapper
        .find('[data-testid="program-bus-overlays"]')
        .findAll("button, input, [draggable]"),
    ).toHaveLength(0);
    expect(
      wrapper
        .find('[data-testid="program-bus-last"]')
        .findAll("button, input, [draggable]"),
    ).toHaveLength(0);
  });

  it("shows the head a program was planned with and how late it landed", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 4,
            late_by_seconds: 1.5,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-overlay"]');
    expect(row.text()).toContain("starts 4.0 s before the track ends");
    expect(row.text()).toContain("placed 1.5 s late");
  });

  it("keeps a program without a head or lateness free of empty numbers", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Announcement",
            state: "scheduled",
            start_in_seconds: 0,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-overlay"]');
    expect(row.text()).not.toContain("before the track ends");
    expect(row.text()).not.toContain("late");
    // nothing to say about timing at all, so the detail line is not even there
    expect(row.find('[data-testid="program-bus-timing"]').exists()).toBe(false);
  });

  it("leaves the lateness out of a punctual program", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 4,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    const timing = wrapper.get('[data-testid="program-bus-timing"]');
    expect(timing.text()).toBe("starts 4.0 s before the track ends");
  });

  it("leaves the head out of a program that carries none", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 1.5,
          },
        ],
      }),
    );

    const timing = wrapper.get('[data-testid="program-bus-timing"]');
    expect(timing.text()).toBe("placed 1.5 s late");
  });

  it.each([
    ["skip", "skipped within the track"],
    ["next", "next track started"],
    ["previous", "previous track started"],
    ["play_index", "jumped to another track"],
    ["head_truncated", "head did not fit"],
  ])(
    "names a drop of reason %s in the reader's words",
    async (reason, label) => {
      const wrapper = await mountOpenPanel(
        busView({
          last: [{ label: "Weather", state: "dropped", reason, frames: 48000 }],
        }),
      );

      const row = wrapper.get('[data-testid="program-bus-reason"]');
      expect(row.text()).toBe(label);
    },
  );

  it("shows a reason it does not know as it came from the server", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        last: [
          {
            label: "Weather",
            state: "dropped",
            reason: "a_new_reason",
            frames: 48000,
          },
        ],
      }),
    );

    expect(wrapper.get('[data-testid="program-bus-last"]').text()).toContain(
      "a_new_reason",
    );
  });

  it("counts what the bus holds and played on one line", async () => {
    const wrapper = await mountPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
        last: [
          { label: "Weather", state: "aired", reason: null, frames: 48000 },
          {
            label: "News",
            state: "dropped",
            reason: "too_late",
            frames: 48000,
          },
        ],
      }),
    );

    expect(subtitleLines(wrapper)).toContain(
      "1 scheduled · 1 played · 1 skipped",
    );
  });

  it("keeps the program list closed until it is asked for", async () => {
    const wrapper = await mountPanel(busView({ last: endedPrograms(4) }));
    const link = nodeLink(wrapper);

    expect(link.attributes("aria-expanded")).toBe("false");
    expect(link.attributes("title")).toBe("Show details");
    // the link is the node's own title, so it costs no row of its own
    expect(link.text()).toBe("Program bus");
    expect(wrapper.findAll('[data-testid="program-bus-ended"]')).toHaveLength(
      0,
    );
    expect(wrapper.text()).not.toContain("Program 1");
    // the count is the only thing the closed node spends on them
    expect(subtitleLines(wrapper)).toContain("4 played");
  });

  it("opens and closes the programs it counted", async () => {
    const wrapper = await mountPanel(busView({ last: endedPrograms(4) }));

    await openDetails(wrapper);

    expect(nodeLink(wrapper).attributes("aria-expanded")).toBe("true");
    expect(nodeLink(wrapper).attributes("title")).toBe("Hide details");
    expect(wrapper.findAll('[data-testid="program-bus-ended"]')).toHaveLength(
      4,
    );

    await openDetails(wrapper);
    expect(wrapper.findAll('[data-testid="program-bus-ended"]')).toHaveLength(
      0,
    );
  });

  it("offers no link to a list that would be empty", async () => {
    const wrapper = await mountPanel(busView({ overlays: [], last: [] }));

    expect(wrapper.find("button.audio-processing-stage-title").exists()).toBe(
      false,
    );
    expect(wrapper.get(".audio-processing-stage-title").element.tagName).toBe(
      "SPAN",
    );
  });

  it("spends the same height however many programs the bus played", async () => {
    const few = await mountPanel(busView({ last: endedPrograms(2) }));
    const many = await mountPanel(busView({ last: endedPrograms(40) }));
    const copyChildren = (wrapper: VueWrapper) =>
      wrapper.get(".audio-processing-stage-copy").element.children.length;

    // closed, neither lists a row nor grows a block: only the counted line differs
    expect(many.findAll('[data-testid="program-bus-ended"]')).toHaveLength(0);
    expect(copyChildren(many)).toBe(copyChildren(few));
    expect(subtitleLines(many)).toContain("40 played");
  });

  it("spends nothing on a bus that has nothing to show", async () => {
    const wrapper = await mountPanel(busView({ overlays: [], last: [] }));

    expect(wrapper.find("button.audio-processing-stage-title").exists()).toBe(
      false,
    );
    expect(
      subtitleLines(wrapper).filter((line) =>
        /^\d+ (scheduled|played|skipped)/.test(line),
      ),
    ).toEqual([]);
  });

  it("hangs its list inside the copy column the connector runs past", async () => {
    const wrapper = await mountPanel(busView({ last: endedPrograms(2) }));
    await openDetails(wrapper);

    const stage = wrapper.get(".audio-processing-stage");
    const copy = stage.get(".audio-processing-stage-copy");
    const details = wrapper.get('[data-testid="program-bus-details"]');

    // the list is a child of the copy, not a second grid row: the connector is
    // the first column of the only row and stretches over the copy's height
    expect(copy.element.contains(details.element)).toBe(true);
    expect(stage.element.querySelector(":scope > .program-bus-details")).toBe(
      null,
    );
    const children = Array.from(stage.element.children).map(
      (child) => child.className,
    );
    expect(children.slice(0, 3)).toEqual([
      "audio-processing-stage-connector",
      "audio-processing-stage-icon",
      "audio-processing-stage-copy",
    ]);
    // the node's own rows are inside the same column as the list
    expect(copy.findAll(".audio-processing-stage-subtitle")).toHaveLength(2);
    expect(copy.findAll(".program-bus-row")).toHaveLength(2);
  });

  it("keeps the stage as the only child of its section", async () => {
    const wrapper = await mountPanel(
      busView({
        overlays: [
          {
            label: "Transition",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
        last: endedPrograms(2),
      }),
    );
    await openDetails(wrapper);

    const section = wrapper.get('[data-testid="program-bus"]');
    const body = section.get(".audio-processing-section");
    expect(body.element.children).toHaveLength(1);
    const stage = body.element.children[0];
    expect(stage.classList).toContain("audio-processing-stage");
    // every block of the panel hangs inside the node, where the connector runs
    // past it, instead of between the node and the outputs
    expect(section.findAll(".audio-processing-stage-connector")).toHaveLength(
      1,
    );
    for (const block of section.findAll("[data-testid^='program-bus-']")) {
      const testId = block.attributes("data-testid");
      if (testId === "program-bus" || testId === "program-bus-status") continue;
      expect(stage.contains(block.element)).toBe(true);
      expect(
        stage
          .querySelector(`.audio-processing-stage-copy`)
          ?.contains(block.element),
      ).toBe(true);
    }
  });

  it("leaves the old queue behind when the panel is pointed at another one", async () => {
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label: "First queue",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
      }),
    );
    expect(wrapper.text()).toContain("First queue");
    apiMock.sendCommand.mockResolvedValue(
      busView({
        overlays: [
          {
            label: "Second queue",
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    await wrapper.setProps({ queueId: "queue-2" });
    expect(wrapper.text()).not.toContain("First queue");
    expect(wrapper.find("button.audio-processing-stage-title").exists()).toBe(
      false,
    );

    await flushPromises();
    await openDetails(wrapper);
    expect(wrapper.text()).toContain("Second queue");
    expect(apiMock.sendCommand).toHaveBeenLastCalledWith(
      "streams/program_bus",
      { queue_id: "queue-2" },
    );
  });

  it("does not stack a poll on one that is still out", async () => {
    vi.useFakeTimers();
    let answer: (view: ProgramBusView) => void = () => undefined;
    apiMock.sendCommand.mockReturnValue(
      new Promise<ProgramBusView>((resolve) => {
        answer = resolve;
      }),
    );
    const wrapper = mount(ProgramBusPanel, {
      props: { queueId: QUEUE_ID },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    await flushPromises();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(1);

    answer(busView());
    await flushPromises();
    vi.advanceTimersByTime(3000);
    await flushPromises();
    expect(apiMock.sendCommand).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("keeps a very long label in its own column", async () => {
    const label = "x".repeat(200);
    const wrapper = await mountOpenPanel(
      busView({
        overlays: [
          {
            label,
            state: "scheduled",
            start_in_seconds: 7,
            frames: 48000,
            head_seconds: 0,
            late_by_seconds: 0,
          },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-overlay"]');
    const labels = row.findAll(".program-bus-row-label");
    expect(labels).toHaveLength(1);
    expect(labels[0].text()).toBe(label);
    // the state and the countdown stay in the row, so the label can not push them out
    expect(row.find(".program-bus-row-state").exists()).toBe(true);
    expect(row.find(".program-bus-row-time").exists()).toBe(true);
  });
});
