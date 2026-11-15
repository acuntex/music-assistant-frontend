import CustomizeHost from "@/components/ai-radio/CustomizeHost.vue";
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

  it("keeps the control inside 0–12 seconds in 0.5 steps", async () => {
    const wrapper = await mountExistingHost();
    const input = termHeadInput(wrapper);

    expect(input.attributes("type")).toBe("number");
    expect(input.attributes("min")).toBe("0");
    expect(input.attributes("max")).toBe("12");
    expect(input.attributes("step")).toBe("0.5");
  });

  it("clamps an out-of-range entry before it reaches the payload", async () => {
    const wrapper = await mountExistingHost();

    await termHeadInput(wrapper).setValue("13");
    await save(wrapper);
    expect(savedHost()?.term_head_seconds).toBe(12);

    await termHeadInput(wrapper).setValue("-1");
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

  it("keeps the control inside 15–90 seconds in 1 second steps", async () => {
    const wrapper = await mountExistingHost();
    const input = ceilingInput(wrapper);

    expect(input.attributes("type")).toBe("number");
    expect(input.attributes("min")).toBe("15");
    expect(input.attributes("max")).toBe("90");
    expect(input.attributes("step")).toBe("1");
  });

  it("shows the field's short description", async () => {
    const wrapper = await mountExistingHost();

    expect(wrapper.text()).toContain(
      "Longest a single spoken contribution may run; longer material is cut.",
    );
  });

  it("clamps an out-of-range entry before it reaches the payload", async () => {
    const wrapper = await mountExistingHost();

    await ceilingInput(wrapper).setValue("100");
    expect(inputValue(wrapper)).toBe("90");
    await save(wrapper);
    expect(savedHost()?.max_contribution_seconds).toBe(90);

    await ceilingInput(wrapper).setValue("5");
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
