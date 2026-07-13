import { describe, expect, test } from "bun:test";

import {
  selectPlaceholderVoices,
  type VoiceCandidate,
} from "./synthesize";

function voice(name: string, id: string): VoiceCandidate {
  return { vendor: "test", id, name };
}

describe("selectPlaceholderVoices", () => {
  test("selects the preferred distinct placeholder cast", () => {
    const result = selectPlaceholderVoices([
      voice("Fable", "fable"),
      voice("Nova", "nova"),
      voice("Onyx", "onyx"),
      voice("Echo", "echo"),
    ]);

    expect(result.skeptic.name).toBe("Onyx");
    expect(result.spreadsheet.name).toBe("Nova");
    expect(result.vibes.name).toBe("Echo");
    expect(new Set(Object.values(result).map(({ id }) => id)).size).toBe(3);
  });

  test("falls back deterministically when names have no hints", () => {
    const result = selectPlaceholderVoices([
      voice("One", "1"),
      voice("Two", "2"),
      voice("Three", "3"),
    ]);

    expect(result.skeptic.id).toBe("1");
    expect(result.spreadsheet.id).toBe("2");
    expect(result.vibes.id).toBe("3");
  });

  test("deduplicates voices by vendor and id", () => {
    expect(() =>
      selectPlaceholderVoices([
        voice("Onyx", "same"),
        voice("Onyx Copy", "same"),
        voice("Nova", "nova"),
      ]),
    ).toThrow("three distinct voices");
  });
});
