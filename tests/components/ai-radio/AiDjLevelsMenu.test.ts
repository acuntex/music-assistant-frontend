import AiDjLevelsMenu from "@/components/ai-radio/AiDjLevelsMenu.vue";
import { Slider } from "@/components/ui/slider";
import { useShows } from "@/composables/ai-radio/useShows";
import type {
  AIRadioQueueDJEntry,
  AIRadioQueueDJStatus,
} from "@/plugins/api/interfaces";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SendCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const { sendCommand, routerPush } = vi.hoisted(() => ({
  sendCommand: vi.fn<SendCommand>(async () => []),
  routerPush: vi.fn(),
}));

vi.mock("@/plugins/api", () => ({
  default: {
    providers: {},
    players: {},
    sendCommand,
    subscribe: vi.fn(() => () => {}),
    state: { value: "initialized" },
  },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/plugins/eventbus", () => ({
  eventbus: { emit: vi.fn() },
}));

vi.mock("vue-sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const QUEUE_ID = "kitchen";

/** A queue's DJ status entry as the server sends it, with the levels filled in. */
function makeEntry(
  overrides: Partial<AIRadioQueueDJEntry> = {},
): AIRadioQueueDJEntry {
  return {
    host_id: "host-1",
    station_id: "",
    voice_level_db: 0,
    duck_db: null,
    bus_enabled: true,
    hint: null,
    hint_link: null,
    ...overrides,
  };
}

function seedQueue(entry: AIRadioQueueDJEntry | undefined) {
  const status: AIRadioQueueDJStatus = entry ? { [QUEUE_ID]: entry } : {};
  useShows().djStatus.value = status;
}

async function mountMenu(): Promise<VueWrapper> {
  const wrapper = mount(AiDjLevelsMenu, {
    props: { queueId: QUEUE_ID },
  });
  await flushPromises();
  return wrapper;
}

const voiceValue = (wrapper: VueWrapper) =>
  wrapper.get("[data-testid='ai-dj-voice-value']").text();
const duckValue = (wrapper: VueWrapper) =>
  wrapper.get("[data-testid='ai-dj-duck-value']").text();

function sliderFor(wrapper: VueWrapper, which: "voice" | "duck") {
  return wrapper
    .get(`[data-testid='ai-dj-${which}-slider']`)
    .findComponent(Slider);
}

/** Drags a slider to `value` and lets the drag end, which is what commits it. */
async function setSlider(
  wrapper: VueWrapper,
  which: "voice" | "duck",
  value: number,
) {
  const slider = sliderFor(wrapper, which);
  await slider.vm.$emit("update:model-value", [value]);
  await slider.vm.$emit("value-commit", [value]);
  await flushPromises();
}

function setLevelsCalls() {
  return sendCommand.mock.calls.filter(
    ([command]) => command === "ai_radio/queue_dj/set_levels",
  );
}

function lastSetLevelsArgs() {
  const calls = setLevelsCalls();
  return calls[calls.length - 1]?.[1];
}

beforeEach(() => {
  sendCommand.mockImplementation(async () => []);
  seedQueue(makeEntry());
});

afterEach(() => {
  vi.clearAllMocks();
  useShows().djStatus.value = {};
});

describe("AiDjLevelsMenu stored values", () => {
  it("shows the queue's voice level and ducking depth", async () => {
    seedQueue(makeEntry({ voice_level_db: -4.5, duck_db: -6 }));

    const wrapper = await mountMenu();

    expect(voiceValue(wrapper)).toBe("-4.5 dB");
    expect(duckValue(wrapper)).toBe("-6 dB");
  });

  it("falls back to 0 dB for the voice and Standard for ducking", async () => {
    seedQueue(makeEntry({ voice_level_db: 0, duck_db: null }));

    const wrapper = await mountMenu();

    expect(voiceValue(wrapper)).toBe("0 dB");
    expect(duckValue(wrapper)).toBe("Standard");
  });

  it("shows both controls inside the requested range and step", async () => {
    const wrapper = await mountMenu();

    for (const which of ["voice", "duck"] as const) {
      const slider = sliderFor(wrapper, which);
      expect(slider.props("min")).toBe(which === "voice" ? -9 : -12);
      expect(slider.props("max")).toBe(0);
      expect(slider.props("step")).toBe(0.5);
    }
  });

  it("says that 0 dB leaves the voice unchanged and 0 dB ends ducking", async () => {
    seedQueue(makeEntry({ duck_db: -4 }));
    const withoutStandard = (await mountMenu()).text();
    expect(withoutStandard).toContain("0 dB leaves the voice unchanged");
    expect(withoutStandard).toContain("0 dB turns ducking off");

    // Standard is a depth of its own, so the help says it is not 0 dB.
    seedQueue(makeEntry({ duck_db: null }));
    const withStandard = (await mountMenu()).text();
    expect(withStandard).toContain("Standard is not the same as 0 dB");
  });
});

describe("AiDjLevelsMenu commits", () => {
  it("sends a changed voice level and takes the answer into the state", async () => {
    sendCommand.mockImplementation(async (command) =>
      command === "ai_radio/queue_dj/set_levels"
        ? { [QUEUE_ID]: makeEntry({ voice_level_db: -3.5 }) }
        : [],
    );
    const wrapper = await mountMenu();

    await setSlider(wrapper, "voice", -3.5);

    expect(lastSetLevelsArgs()).toEqual({
      queue_id: QUEUE_ID,
      voice_level_db: -3.5,
      duck_db: null,
    });
    expect(voiceValue(wrapper)).toBe("-3.5 dB");
  });

  it("clamps a voice level outside 0 to -9 dB", async () => {
    const wrapper = await mountMenu();

    await setSlider(wrapper, "voice", -20);

    expect(lastSetLevelsArgs()).toMatchObject({ voice_level_db: -9 });
  });

  it("clamps a ducking depth outside 0 to -12 dB", async () => {
    seedQueue(makeEntry({ duck_db: -4 }));
    const wrapper = await mountMenu();

    await setSlider(wrapper, "duck", -30);

    expect(lastSetLevelsArgs()).toMatchObject({ duck_db: -12 });
  });

  it("keeps the voice level when only ducking changes", async () => {
    seedQueue(makeEntry({ voice_level_db: -2, duck_db: -4 }));
    const wrapper = await mountMenu();

    await setSlider(wrapper, "duck", -7);

    expect(lastSetLevelsArgs()).toEqual({
      queue_id: QUEUE_ID,
      voice_level_db: -2,
      duck_db: -7,
    });
  });

  it("sends null for Standard ducking", async () => {
    seedQueue(makeEntry({ voice_level_db: -2, duck_db: -4 }));
    const wrapper = await mountMenu();

    await wrapper.get("[data-testid='ai-dj-duck-standard']").trigger("click");
    await flushPromises();

    expect(lastSetLevelsArgs()).toEqual({
      queue_id: QUEUE_ID,
      voice_level_db: -2,
      duck_db: null,
    });
  });

  it("sends 0, not null, when Standard is turned off", async () => {
    seedQueue(makeEntry({ voice_level_db: -2, duck_db: null }));
    sendCommand.mockImplementation(async (command) =>
      command === "ai_radio/queue_dj/set_levels"
        ? { [QUEUE_ID]: makeEntry({ voice_level_db: -2, duck_db: 0 }) }
        : [],
    );
    const wrapper = await mountMenu();

    await wrapper.get("[data-testid='ai-dj-duck-standard']").trigger("click");
    await flushPromises();

    expect(lastSetLevelsArgs()).toEqual({
      queue_id: QUEUE_ID,
      voice_level_db: -2,
      duck_db: 0,
    });
    expect(duckValue(wrapper)).toBe("0 dB");
  });

  it("reports a failed write instead of dropping it", async () => {
    const { toast } = await import("vue-sonner");
    sendCommand.mockImplementation(async (command) => {
      if (command === "ai_radio/queue_dj/set_levels") {
        throw new Error("Connection lost");
      }
      return [];
    });
    const wrapper = await mountMenu();

    await setSlider(wrapper, "voice", -5);

    expect(toast.error).toHaveBeenCalledWith("Connection lost");
  });
});

describe("AiDjLevelsMenu program bus hint", () => {
  it("shows the server's hint with a working link while the bus is off", async () => {
    seedQueue(
      makeEntry({
        bus_enabled: false,
        hint: "The program bus is off, so the DJ can't talk over the music.",
        hint_link: "/settings/editcore/streams",
      }),
    );

    const wrapper = await mountMenu();

    expect(wrapper.get("[data-testid='ai-dj-bus-hint']").text()).toContain(
      "The program bus is off",
    );
    const link = wrapper.get("[data-testid='ai-dj-bus-hint-link']");
    expect(link.attributes("href")).toBe("/settings/editcore/streams");
    await link.trigger("click");
    expect(routerPush).toHaveBeenCalledWith("/settings/editcore/streams");
  });

  it("keeps the hint out of the way while the bus is on", async () => {
    seedQueue(makeEntry({ bus_enabled: true }));

    const wrapper = await mountMenu();

    expect(wrapper.find("[data-testid='ai-dj-bus-hint']").exists()).toBe(false);
  });
});
