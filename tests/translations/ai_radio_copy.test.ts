// the i18n build step compiles these messages into an AST, so the copy is read
// as the raw file to keep the plain strings assertable
import enRaw from "@/translations/en.json?raw";
import { describe, expect, it } from "vitest";

const messages = JSON.parse(enRaw) as {
  program_bus: Record<string, string>;
  providers: {
    ai_radio: {
      field_descriptions: Record<string, string>;
      queue_dj: Record<string, string>;
    };
  };
};

// The server places a spoken contribution against the end of the track, so the
// field must not promise a crossfade boundary it does not have.
describe("host field copy", () => {
  it("explains the pre-roll against the end of the track", () => {
    const text = messages.providers.ai_radio.field_descriptions.term_head;

    expect(text).toContain("before the track ends");
    expect(text).toContain("the rest plays over the next track");
    expect(text).toContain("exactly when the next track begins");
    expect(text).not.toMatch(/crossfade|incoming track|with the fade/i);
  });

  it("names the Streams settings the way the settings page does", () => {
    // the queue DJ status is the one place that tells a reader where the switch is
    expect(messages.providers.ai_radio.queue_dj.bus_off_link).toBe(
      "Open Streams settings",
    );
    // the settings page lists the module under its own name, not under a
    // breadcrumb the panel would have to invent
    const allowPre = messages.providers.ai_radio.field_descriptions.allow_pre;
    expect(allowPre).toContain("Streams core configuration");
    expect(allowPre).not.toContain("Core →");
  });
});

// the ledger names what it did; the popover says what the listener saw
describe("program bus copy", () => {
  it("names an ended program in the reader's words", () => {
    const bus = messages.program_bus;

    expect(bus.state_aired).toBe("played");
    expect(bus.state_dropped).toBe("skipped");
    expect(bus.reason_skipped).toBe("skipped");
    expect(bus.reason_bus_replaced).toBe("replaced");
    // the summary counts the same way the rows read
    expect(bus.summary_played).toContain("played");
    expect(bus.summary_dropped).toContain("skipped");
    // no ledger word survives in the words a reader can see
    for (const value of Object.values(bus)) {
      expect(value).not.toMatch(/\baired\b|\bdropped\b|bus_replaced/);
    }
  });
});
