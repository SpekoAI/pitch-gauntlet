import { describe, expect, test } from "bun:test";

import {
  parseInterjectionLibrary,
  selectPlaceholderVoices,
  type VoiceCandidate,
} from "./synthesize";

import finalLibrary from "./interjections-final.json";

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

describe("parseInterjectionLibrary", () => {
  test("loads all final lines while leaving slot templates out of the batch", () => {
    const result = parseInterjectionLibrary(finalLibrary);

    expect(result.personas).toHaveLength(3);
    expect(result.lines).toHaveLength(48);
    expect(result.lines.filter(({ tags }) => tags.includes("silence"))).toHaveLength(3);
    expect(result.lines.filter(({ tags }) => tags.includes("opener"))).toHaveLength(3);
    expect(result.lines.some(({ lineId }) => lineId.includes("-t1"))).toBe(false);
  });

  test("requires complete persona casting metadata", () => {
    const invalid = structuredClone(finalLibrary);
    invalid.personas[0].casting = "";

    expect(() => parseInterjectionLibrary(invalid)).toThrow("casting metadata");
  });
});
