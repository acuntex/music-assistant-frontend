import CustomizeHost from "@/components/ai-radio/CustomizeHost.vue";
import FieldLabel from "@/components/ai-radio/FieldLabel.vue";
import { useHosts } from "@/composables/ai-radio/useHosts";
import { compileHost, GENERIC_SEGMENT_TEMPLATES } from "@/helpers/ai_radio";
import type { HostDraft } from "@/helpers/ai_radio";
import type { AIRadioHost, AIRadioSection } from "@/plugins/api/interfaces";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { authManager } from "@/plugins/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SendCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const { sendCommand, getCoreConfigValue, saveCoreConfig } = vi.hoisted(() => ({
  sendCommand: vi.fn<SendCommand>(async () => []),
  getCoreConfigValue:
    vi.fn<(domain: string, key: string) => Promise<unknown>>(),
  saveCoreConfig:
    vi.fn<
      (domain: string, values: Record<string, unknown>) => Promise<unknown>
    >(),
}));

vi.mock("@/plugins/api", () => ({
  default: {
    // useHosts derives ai_radio availability from the provider list.
    providers: {},
    sendCommand,
    getCoreConfigValue,
    saveCoreConfig,
    state: { value: "initialized" },
  },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock("@/plugins/eventbus", () => ({
  eventbus: { emit: vi.fn() },
}));

vi.mock("vue-sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

/** The explanation the label carries for a field, which the user sees on hover. */
function descriptionOf(wrapper: VueWrapper, label: string): string {
  const field = wrapper
    .findAllComponents(FieldLabel)
    .find((candidate) => candidate.props("label") === label);
  return (field?.props("description") as string | undefined) ?? "";
}

/** Mounts the editor in create mode (a new host seeded with one generic example segment per placement). */
async function mountEditor() {
  const wrapper = mount(CustomizeHost);
  await flushPromises();
  return wrapper;
}

function saveButton(wrapper: VueWrapper) {
  return wrapper
    .findAll("button")
    .find((candidate) => /^Save host|Saving/.test(candidate.text()));
}

async function save(wrapper: VueWrapper) {
  await saveButton(wrapper)?.trigger("click");
  await flushPromises();
}

const aiRadioCommands = () =>
  sendCommand.mock.calls
    .map(([command]) => command)
    .filter((command) => command.startsWith("ai_radio/"));

beforeEach(() => {
  getCoreConfigValue.mockResolvedValue(false);
  saveCoreConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  sendCommand.mockImplementation(async () => []);
  useHosts().hosts.value = [];
});

describe("CustomizeHost term head pre-roll", () => {
  const baseDraft: HostDraft = {
    id: "rick",
    name: "Rick",
    instructions: "Persona.",
    ttsEngine: "",
    language: "",
    options: {},
    termHeadSeconds: 2,
    maxContributionSeconds: 45,
    segments: [{ ...GENERIC_SEGMENT_TEMPLATES[0] }],
  };

  async function mountHost(host: AIRadioHost, sections: AIRadioSection[]) {
    sendCommand.mockImplementation(async (command) => {
      if (command === "ai_radio/hosts/get") return host;
      if (command === "ai_radio/sections/list") return sections;
      return [];
    });
    const wrapper = mount(CustomizeHost, { props: { hostId: host.id } });
    await flushPromises();
    return wrapper;
  }

  function mountExistingHost(overrides: Partial<AIRadioHost> = {}) {
    const { host, sections } = compileHost(baseDraft);
    return mountHost({ ...host, ...overrides }, sections);
  }

  const termHeadInput = (wrapper: VueWrapper) =>
    wrapper.find("#customize-host-term-head");

  function savedHost() {
    const saveCalls = sendCommand.mock.calls.filter(
      ([command]) => command === "ai_radio/hosts/save",
    );
    const lastCall = saveCalls[saveCalls.length - 1];
    return (lastCall?.[1] as { host?: AIRadioHost } | undefined)?.host;
  }

  it("shows the host's stored pre-roll", async () => {
    const wrapper = await mountExistingHost({ term_head_seconds: 5.5 });

    expect((termHeadInput(wrapper).element as HTMLInputElement).value).toBe(
      "5.5",
    );
  });

  it("sends the edited pre-roll with the host save and keeps the other fields", async () => {
    const wrapper = await mountExistingHost();

    await termHeadInput(wrapper).setValue("4.5");
    await termHeadInput(wrapper).trigger("blur");
    await save(wrapper);

    expect(aiRadioCommands()).toContain("ai_radio/hosts/save");
    expect(savedHost()?.term_head_seconds).toBe(4.5);
    expect(savedHost()?.instructions).toBe("Persona.");
    expect(savedHost()?.name).toBe("Rick");
  });

  it("shows the default for a host payload that predates the field", async () => {
    // A host stored before the field existed carries no key at all.
    const { host, sections } = compileHost(baseDraft);
    const legacy = { ...host } as Partial<AIRadioHost>;
    delete legacy.term_head_seconds;
    const wrapper = await mountHost(legacy as AIRadioHost, sections);

    expect((termHeadInput(wrapper).element as HTMLInputElement).value).toBe(
      "2",
    );
  });

  it("uses the same number field as the show editor", async () => {
    const wrapper = await mountExistingHost();
    const input = termHeadInput(wrapper);

    // a NumberField exposes a spinbutton, not a bare number input
    expect(input.attributes("role")).toBe("spinbutton");
    expect(input.attributes("aria-valuemin")).toBe("0");
    expect(input.attributes("aria-valuemax")).toBe("12");
    expect(wrapper.find('input[type="number"]').exists()).toBe(false);
  });

  it("steps the pre-roll in half seconds", async () => {
    const wrapper = await mountExistingHost();
    await termHeadInput(wrapper).trigger("keydown", { key: "ArrowUp" });

    expect((termHeadInput(wrapper).element as HTMLInputElement).value).toBe(
      "2.5",
    );
  });

  it("explains the pre-roll through the label's help", async () => {
    const wrapper = await mountExistingHost();

    // one pattern per card: the copy sits behind the label, not in a paragraph
    expect(descriptionOf(wrapper, "Transition pre-roll (seconds)")).toContain(
      "before the track ends",
    );
    expect(wrapper.text()).not.toContain("before the track ends");
  });

  it("clamps an out-of-range entry before it reaches the payload", async () => {
    const wrapper = await mountExistingHost();

    await termHeadInput(wrapper).setValue("13");
    await termHeadInput(wrapper).trigger("blur");
    expect((termHeadInput(wrapper).element as HTMLInputElement).value).toBe(
      "12",
    );
    await save(wrapper);
    expect(savedHost()?.term_head_seconds).toBe(12);

    await termHeadInput(wrapper).setValue("-1");
    await termHeadInput(wrapper).trigger("blur");
    expect((termHeadInput(wrapper).element as HTMLInputElement).value).toBe(
      "0",
    );
    await save(wrapper);
    expect(savedHost()?.term_head_seconds).toBe(0);
  });
});

describe("CustomizeHost contribution ceiling", () => {
  const baseDraft: HostDraft = {
    id: "rick",
    name: "Rick",
    instructions: "Persona.",
    ttsEngine: "",
    language: "",
    options: {},
    termHeadSeconds: 2,
    maxContributionSeconds: 45,
    segments: [{ ...GENERIC_SEGMENT_TEMPLATES[0] }],
  };

  async function mountHost(host: AIRadioHost, sections: AIRadioSection[]) {
    sendCommand.mockImplementation(async (command) => {
      if (command === "ai_radio/hosts/get") return host;
      if (command === "ai_radio/sections/list") return sections;
      return [];
    });
    const wrapper = mount(CustomizeHost, { props: { hostId: host.id } });
    await flushPromises();
    return wrapper;
  }

  function mountExistingHost(overrides: Partial<AIRadioHost> = {}) {
    const { host, sections } = compileHost(baseDraft);
    return mountHost({ ...host, ...overrides }, sections);
  }

  const ceilingInput = (wrapper: VueWrapper) =>
    wrapper.find("#customize-host-max-contribution");

  const inputValue = (wrapper: VueWrapper) =>
    (ceilingInput(wrapper).element as HTMLInputElement).value;

  function savedHost() {
    const saveCalls = sendCommand.mock.calls.filter(
      ([command]) => command === "ai_radio/hosts/save",
    );
    const lastCall = saveCalls[saveCalls.length - 1];
    return (lastCall?.[1] as { host?: AIRadioHost } | undefined)?.host;
  }

  it("shows the host's stored ceiling", async () => {
    const wrapper = await mountExistingHost({
      max_contribution_seconds: 60,
    });

    expect(inputValue(wrapper)).toBe("60");
  });

  it("sends the edited ceiling with the host save and keeps the other fields", async () => {
    const wrapper = await mountExistingHost();

    await ceilingInput(wrapper).setValue("30");
    await ceilingInput(wrapper).trigger("blur");
    await save(wrapper);

    expect(aiRadioCommands()).toContain("ai_radio/hosts/save");
    expect(savedHost()?.max_contribution_seconds).toBe(30);
    expect(savedHost()?.term_head_seconds).toBe(2);
    expect(savedHost()?.instructions).toBe("Persona.");
    expect(savedHost()?.name).toBe("Rick");
  });

  it("shows 45 for a host payload that predates the field", async () => {
    const { host, sections } = compileHost(baseDraft);
    const legacy = { ...host } as Partial<AIRadioHost>;
    delete legacy.max_contribution_seconds;
    const wrapper = await mountHost(legacy as AIRadioHost, sections);

    expect(inputValue(wrapper)).toBe("45");
  });

  it("keeps the control inside 15–90 seconds", async () => {
    const wrapper = await mountExistingHost();
    const input = ceilingInput(wrapper);

    expect(input.attributes("role")).toBe("spinbutton");
    expect(input.attributes("aria-valuemin")).toBe("15");
    expect(input.attributes("aria-valuemax")).toBe("90");
  });

  it("steps the ceiling in whole seconds", async () => {
    const wrapper = await mountExistingHost();

    await wrapper
      .get("#customize-host-max-contribution")
      .trigger("keydown", { key: "ArrowUp" });

    expect(inputValue(wrapper)).toBe("46");
  });

  it("explains the ceiling through the label's help", async () => {
    const wrapper = await mountExistingHost();

    expect(descriptionOf(wrapper, "Contribution ceiling (seconds)")).toBe(
      "Longest a single spoken contribution may run; longer material is cut.",
    );
    expect(wrapper.text()).not.toContain("longer material is cut");
  });

  it("clamps an out-of-range entry before it reaches the payload", async () => {
    const wrapper = await mountExistingHost();

    await ceilingInput(wrapper).setValue("100");
    await ceilingInput(wrapper).trigger("blur");
    expect(inputValue(wrapper)).toBe("90");
    await save(wrapper);
    expect(savedHost()?.max_contribution_seconds).toBe(90);

    await ceilingInput(wrapper).setValue("5");
    await ceilingInput(wrapper).trigger("blur");
    expect(inputValue(wrapper)).toBe("15");
    await save(wrapper);
    expect(savedHost()?.max_contribution_seconds).toBe(15);
  });

  it("always sends a number when a new host is saved", async () => {
    const wrapper = await mountEditor();
    await wrapper.find("#customize-host-name").setValue("Morning Crew");

    await save(wrapper);

    expect(savedHost()?.max_contribution_seconds).toBe(45);
  });
});

describe("CustomizeHost intro and outro", () => {
  const baseDraft: HostDraft = {
    id: "rick",
    name: "Rick",
    instructions: "Persona.",
    ttsEngine: "",
    language: "",
    options: {},
    termHeadSeconds: 2,
    maxContributionSeconds: 45,
    playIntro: true,
    playOutro: true,
    segments: [{ ...GENERIC_SEGMENT_TEMPLATES[0] }],
  };

  async function mountHost(host: AIRadioHost, sections: AIRadioSection[]) {
    sendCommand.mockImplementation(async (command) => {
      if (command === "ai_radio/hosts/get") return host;
      if (command === "ai_radio/sections/list") return sections;
      return [];
    });
    const wrapper = mount(CustomizeHost, { props: { hostId: host.id } });
    await flushPromises();
    return wrapper;
  }

  function mountExistingHost(overrides: Partial<AIRadioHost> = {}) {
    const { host, sections } = compileHost(baseDraft);
    return mountHost({ ...host, ...overrides }, sections);
  }

  const introSwitch = (wrapper: VueWrapper) =>
    wrapper.get("[data-testid='customize-host-play-intro']");
  const outroSwitch = (wrapper: VueWrapper) =>
    wrapper.get("[data-testid='customize-host-play-outro']");

  function savedHost() {
    const saveCalls = sendCommand.mock.calls.filter(
      ([command]) => command === "ai_radio/hosts/save",
    );
    const lastCall = saveCalls[saveCalls.length - 1];
    return (lastCall?.[1] as { host?: AIRadioHost } | undefined)?.host;
  }

  it("shows the host's stored switches", async () => {
    const wrapper = await mountExistingHost({
      play_intro: false,
      play_outro: true,
    });

    expect(introSwitch(wrapper).attributes("aria-checked")).toBe("false");
    expect(outroSwitch(wrapper).attributes("aria-checked")).toBe("true");
  });

  it("shows both switches on for a host payload that predates the fields", async () => {
    const { host, sections } = compileHost(baseDraft);
    const legacy = { ...host } as Partial<AIRadioHost>;
    delete legacy.play_intro;
    delete legacy.play_outro;
    const wrapper = await mountHost(legacy as AIRadioHost, sections);

    expect(introSwitch(wrapper).attributes("aria-checked")).toBe("true");
    expect(outroSwitch(wrapper).attributes("aria-checked")).toBe("true");
  });

  it("sends both switches with the host save and keeps the other fields", async () => {
    const wrapper = await mountExistingHost();

    await introSwitch(wrapper).trigger("click");
    await save(wrapper);

    expect(savedHost()?.play_intro).toBe(false);
    expect(savedHost()?.play_outro).toBe(true);
    expect(savedHost()?.instructions).toBe("Persona.");
    expect(savedHost()?.name).toBe("Rick");
  });

  it("sends both switches on for a new host", async () => {
    const wrapper = await mountEditor();
    await wrapper.find("#customize-host-name").setValue("Morning Crew");

    await save(wrapper);

    expect(savedHost()?.play_intro).toBe(true);
    expect(savedHost()?.play_outro).toBe(true);
  });
});

describe("CustomizeHost save", () => {
  it("writes every section before the host that references them", async () => {
    const wrapper = await mountEditor();
    await wrapper.find("#customize-host-name").setValue("Morning Crew");

    await save(wrapper);

    const commands = aiRadioCommands();
    const lastSectionSave = commands.lastIndexOf("ai_radio/sections/save");
    expect(lastSectionSave).toBeGreaterThan(-1);
    expect(commands.indexOf("ai_radio/hosts/save")).toBeGreaterThan(
      lastSectionSave,
    );
  });

  it("writes nothing when the draft fails validation", async () => {
    const { toast } = await import("vue-sonner");
    // The name is empty on a fresh draft, and sections are written before the
    // host, so a save that can't succeed must not reach the server at all.
    const wrapper = await mountEditor();

    await save(wrapper);

    expect(aiRadioCommands()).not.toContain("ai_radio/sections/save");
    expect(aiRadioCommands()).not.toContain("ai_radio/hosts/save");
    expect(toast.error).toHaveBeenCalledWith("Host name is required");
  });

  it("refuses to create a host that would overwrite one with the same name", async () => {
    const { toast } = await import("vue-sonner");
    const existing: AIRadioHost = {
      id: "morning_crew",
      name: "Morning Crew",
      instructions: "",
      tts_engine: "",
      language: "",
      options: {},
      term_head_seconds: 2,
      max_contribution_seconds: 45,
      play_intro: true,
      play_outro: true,
      section_ids: [],
      section_order: [],
      merge_section_id: "",
    };
    sendCommand.mockImplementation(async (command) =>
      command === "ai_radio/hosts/list" ? [existing] : [],
    );
    const wrapper = await mountEditor();
    await wrapper.find("#customize-host-name").setValue("Morning Crew");

    await save(wrapper);

    expect(aiRadioCommands()).not.toContain("ai_radio/hosts/save");
    expect(toast.error).toHaveBeenCalledWith(
      "A host named «Morning Crew» already exists",
    );
  });

  it("refuses to save a new host when the uniqueness check can't be verified", async () => {
    const { toast } = await import("vue-sonner");
    sendCommand.mockImplementation(async (command) => {
      if (command === "ai_radio/hosts/list") {
        throw new Error("network down");
      }
      return [];
    });
    const wrapper = await mountEditor();
    await wrapper.find("#customize-host-name").setValue("Morning Crew");

    await save(wrapper);

    expect(aiRadioCommands()).not.toContain("ai_radio/hosts/save");
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't verify the name is unique. Nothing was saved",
    );
    // The button must recover to a clickable, non-stuck state.
    expect(saveButton(wrapper)?.text()).toBe("Save host");
    expect(saveButton(wrapper)?.attributes("disabled")).toBeUndefined();
  });

  it("still refuses a colliding name once the pre-save refresh reveals it", async () => {
    const { toast } = await import("vue-sonner");
    const existing: AIRadioHost = {
      id: "morning_crew",
      name: "Morning Crew",
      instructions: "",
      tts_engine: "",
      language: "",
      options: {},
      term_head_seconds: 2,
      max_contribution_seconds: 45,
      play_intro: true,
      play_outro: true,
      section_ids: [],
      section_order: [],
      merge_section_id: "",
    };
    // Create mode no longer preloads hosts at mount, so this collision can
    // only be caught by the pre-save refresh itself.
    sendCommand.mockImplementation(async (command) =>
      command === "ai_radio/hosts/list" ? [existing] : [],
    );
    const wrapper = await mountEditor();
    await wrapper.find("#customize-host-name").setValue("Morning Crew");

    await save(wrapper);

    expect(aiRadioCommands()).not.toContain("ai_radio/hosts/save");
    expect(toast.error).toHaveBeenCalledWith(
      "A host named «Morning Crew» already exists",
    );
  });

  it("saves an edited host without requiring an extra hosts refresh", async () => {
    const { toast } = await import("vue-sonner");
    const draft: HostDraft = {
      id: "rick",
      name: "Rick",
      instructions: "Persona.",
      ttsEngine: "",
      language: "",
      options: {},
      termHeadSeconds: 2,
      maxContributionSeconds: 45,
      segments: GENERIC_SEGMENT_TEMPLATES.slice(0, 1).map((s) => ({ ...s })),
    };
    const { host, sections } = compileHost(draft);
    sendCommand.mockImplementation(async (command) => {
      if (command === "ai_radio/hosts/get") return host;
      if (command === "ai_radio/sections/list") return sections;
      return [];
    });
    const wrapper = mount(CustomizeHost, { props: { hostId: host.id } });
    await flushPromises();

    await save(wrapper);

    const commands = aiRadioCommands();
    expect(commands).toContain("ai_radio/hosts/save");
    // Any hosts/list call in edit mode can only be saveHost's post-save
    // refresh, never a pre-save uniqueness check (edit keeps its own id).
    const listIndex = commands.indexOf("ai_radio/hosts/list");
    const saveIndex = commands.indexOf("ai_radio/hosts/save");
    if (listIndex !== -1) {
      expect(listIndex).toBeGreaterThan(saveIndex);
    }
    expect(toast.error).not.toHaveBeenCalled();
  });
});
