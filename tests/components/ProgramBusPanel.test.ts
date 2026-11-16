import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProgramBusPanel from "@/components/ProgramBusPanel.vue";
import { i18n } from "@/plugins/i18n";
import type { ProgramBusView } from "@/plugins/api/interfaces";

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

  it("says the bus is off and links to the Streams settings", async () => {
    const wrapper = await mountPanel(
      busView({
        enabled: false,
        session_active: false,
        format: null,
      }),
    );

    expect(wrapper.text()).toContain("Turns on in the Streams settings");
    expect(wrapper.text()).toContain("Off");
    const link = wrapper.get(".audio-processing-stage-title");
    expect(link.element.tagName).toBe("BUTTON");
    expect(link.attributes("title")).toBe("Open stream settings");
    await link.trigger("click");
    expect(routerMock.push).toHaveBeenCalledWith("/settings/editcore/streams");
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

  it("states the bus status once, in the header line", async () => {
    const wrapper = await mountPanel(
      busView({ enabled: false, session_active: false, format: null }),
    );

    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe(
      "Off",
    );
    // the stage carries no second badge: badges here are for "bit perfect"
    expect(wrapper.find(".audio-processing-stage-badge").exists()).toBe(false);
    expect(wrapper.text().match(/Off/g)).toHaveLength(1);
  });

  it("reports a live session, its format and the claims held for it", async () => {
    const wrapper = await mountPanel(
      busView({ claims: { flow: true, boundary: true } }),
    );

    const text = wrapper.text();
    expect(text).toContain("Session active");
    expect(text).toContain("48 kHz");
    expect(text).toContain("32-bit");
    expect(text).toContain("2 ch");
    expect(text).toContain("Mixes into this player's stream");
    expect(text).toContain("Crosses track boundaries");
    expect(wrapper.find('[data-testid="program-bus-overlays"]').exists()).toBe(
      false,
    );
  });

  it("claims no status before the first reading arrives", async () => {
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

    // nothing was read yet, so neither "on" nor "off" may be claimed
    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe("");
    expect(wrapper.text()).not.toContain("Off");

    answer(busView());
    await flushPromises();
    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe("On");
  });

  it("does not call the bus off when its status could not be read", async () => {
    const wrapper = await mountPanel(new Error("connection lost"));

    expect(wrapper.get("[data-testid='program-bus-status']").text()).toBe("");
    expect(wrapper.text()).not.toContain("Turns on in the Streams settings");
    expect(wrapper.text()).toContain("Program bus status is unavailable");
  });

  it("says a flow session is missing when the bus is on but nothing mixes", async () => {
    const wrapper = await mountPanel(
      busView({ session_active: false, format: null }),
    );

    expect(wrapper.text()).toContain("No flow session is mixing programs");
    expect(wrapper.text()).not.toContain("Turns on in the Streams settings");
  });

  it("shows a planned program with its label, state and seconds to go", async () => {
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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
    expect(row.text()).toContain("dropped");
    expect(row.text()).toContain("missed its boundary");
    expect(row.text()).not.toContain("too_late");
  });

  it("shows an aired program without a reason", async () => {
    const wrapper = await mountPanel(
      busView({
        last: [
          { label: "Weather", state: "aired", reason: null, frames: 48000 },
        ],
      }),
    );

    const row = wrapper.get('[data-testid="program-bus-last"]');
    expect(row.text()).toContain("aired");
    expect(row.text()).not.toContain("null");
  });

  it("says placement is paused when there is no audible position", async () => {
    const wrapper = await mountPanel(busView({ no_audible_position: true }));

    expect(wrapper.text()).toContain("Placement paused — position unknown");
  });

  it("keeps the session state but no zero claims when nothing is claimed", async () => {
    const wrapper = await mountPanel();

    const text = wrapper.text();
    expect(text).not.toContain("Mixes into this player's stream");
    expect(text).not.toContain("Crosses track boundaries");
  });

  it("shows an error state instead of breaking when the command fails", async () => {
    const wrapper = await mountPanel(new Error("connection lost"));

    expect(wrapper.text()).toContain("Program bus status is unavailable");
    expect(wrapper.find('[data-testid="program-bus-overlay"]').exists()).toBe(
      false,
    );
  });

  it("keeps what it had when a later poll fails", async () => {
    vi.useFakeTimers();
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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

  it("says the bus is only for this player's flow sessions", async () => {
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain(
      "Applies to the flow sessions of this player only",
    );
  });

  it("shows the head a program was planned with and how late it landed", async () => {
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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
    const wrapper = await mountPanel(
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
      const wrapper = await mountPanel(
        busView({
          last: [{ label: "Weather", state: "dropped", reason, frames: 48000 }],
        }),
      );

      const row = wrapper.get('[data-testid="program-bus-reason"]');
      expect(row.text()).toBe(label);
    },
  );

  it("keeps the finished list short and counts the rest", async () => {
    const finished = Array.from({ length: 8 }, (_, index) => ({
      label: `Program ${index + 1}`,
      state: "aired" as const,
      reason: null,
      frames: 48000,
    }));
    const wrapper = await mountPanel(busView({ last: finished }));

    // eight rows would push the output paths below the popover's fold
    expect(wrapper.findAll("[data-testid='program-bus-ended']")).toHaveLength(
      3,
    );
    expect(wrapper.get("[data-testid='program-bus-last-more']").text()).toBe(
      "+5 earlier",
    );
    expect(wrapper.text()).not.toContain("Program 8");
  });

  it("counts nothing extra while the whole history fits", async () => {
    const wrapper = await mountPanel(
      busView({
        last: [
          { label: "Weather", state: "aired", reason: null, frames: 48000 },
        ],
      }),
    );

    expect(wrapper.findAll("[data-testid='program-bus-ended']")).toHaveLength(
      1,
    );
    expect(wrapper.find("[data-testid='program-bus-last-more']").exists()).toBe(
      false,
    );
  });

  it("shows a reason it does not know as it came from the server", async () => {
    const wrapper = await mountPanel(
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

  it("leaves the old queue behind when the panel is pointed at another one", async () => {
    const wrapper = await mountPanel(
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

    await flushPromises();
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
    const wrapper = await mountPanel(
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
