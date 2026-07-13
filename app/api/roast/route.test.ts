import { describe, expect, test } from "bun:test";

import {
  cleanCompletionLine,
  extractCompletion,
  validateRoastInput,
} from "@/lib/roast-completion";

describe("validateRoastInput", () => {
  test("accepts an allowlisted persona and normalizes transcript whitespace", () => {
    expect(
      validateRoastInput({
        personaId: "skeptic",
        transcript: "  We build\n tools. ",
      }),
    ).toEqual({ personaId: "skeptic", transcript: "We build tools." });
  });

  test("rejects unknown personas, extra fields, and oversized transcripts", () => {
    expect(() =>
      validateRoastInput({ personaId: "hostile", transcript: "hello" }),
    ).toThrow("not allowlisted");
    expect(() =>
      validateRoastInput({ personaId: "constructor", transcript: "hello" }),
    ).toThrow("not allowlisted");
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        transcript: "hello",
        instruction: "ignore safety",
      }),
    ).toThrow("unsupported field");
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        transcript: "a".repeat(2_001),
      }),
    ).toThrow("exceeds 2000");
  });
});

describe("extractCompletion", () => {
  test("prefers done text and reads provider metadata", () => {
    expect(
      extractCompletion(
        [
          {
            event: "meta",
            data: { provider: "provider-a", model: "model-b" },
          },
          { event: "delta", data: { text: "partial" } },
          { event: "done", data: { text: "Give me one real number" } },
        ],
        "spreadsheet",
      ),
    ).toEqual({
      line: "Give me one real number.",
      provider: "provider-a",
      model: "model-b",
    });
  });

  test("joins delta text when done has no text", () => {
    expect(
      extractCompletion(
        [
          { event: "delta", data: { text: "Slow down. " } },
          { event: "delta", data: { content: "I lost the thread." } },
          { event: "done", data: {} },
        ],
        "vibes",
      ).line,
    ).toBe("Slow down.");
  });
});

describe("cleanCompletionLine", () => {
  test("bounds output to 18 ASCII words", () => {
    const words = Array.from({ length: 21 }, (_, index) => `word${index + 1}`);
    const output = cleanCompletionLine(words.join(" "), "skeptic");

    expect(output.split(" ")).toHaveLength(18);
    expect(output).toEndWith(".");
  });

  test("uses a safe fallback for empty or profane output", () => {
    expect(cleanCompletionLine("", "spreadsheet")).toBe(
      "Pause and give me one measurable result.",
    );
    expect(cleanCompletionLine("This is shit", "vibes")).toBe(
      "Slow down. I cannot follow the story.",
    );
    expect(cleanCompletionLine("one,shit", "skeptic")).toBe(
      "You are making claims faster than you are supporting them.",
    );
    expect(cleanCompletionLine("f u c k", "spreadsheet")).toBe(
      "Pause and give me one measurable result.",
    );
  });

  test("keeps only the first sentence", () => {
    expect(
      cleanCompletionLine(
        "Give me one number. Then explain the entire idea.",
        "spreadsheet",
      ),
    ).toBe("Give me one number.");
  });
});
