// the i18n build step compiles these messages into an AST, so the copy is read
// as the raw file to keep the plain strings assertable
import enRaw from "@/translations/en.json?raw";
import { describe, expect, it } from "vitest";

const messages = JSON.parse(enRaw) as {
  providers: {
    ai_radio: { field_descriptions: Record<string, string> };
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
});
