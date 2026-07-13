import { describe, expect, test } from "bun:test";
import {
  bestComeback,
  countWords,
  findRepeatedWord,
  formatMs,
} from "./game-utils";

describe("findRepeatedWord", () => {
  test("finds the most repeated meaningful word", () => {
    const transcript =
      "our platform is a platform for platforms the platform wins";
    expect(findRepeatedWord(transcript)).toEqual({
      word: "platform",
      count: 3,
    });
  });

  test("ignores stopwords and short words", () => {
    expect(
      findRepeatedWord("the the the and and and um um um a a a"),
    ).toBeNull();
  });

  test("returns null below the threshold", () => {
    expect(findRepeatedWord("growth growth revenue")).toBeNull();
  });
});

describe("bestComeback", () => {
  test("picks the longest stretch between interruptions", () => {
    const snapA = "we make voice agents";
    const snapB =
      "we make voice agents and our customers ship production agents in one afternoon with zero infra";
    const segment = bestComeback(
      [snapA, snapB],
      [10_000, 40_000],
      `${snapB} thanks`,
      60_000,
    );
    expect(segment?.text).toContain("customers ship production agents");
  });

  test("returns null for empty transcripts", () => {
    expect(bestComeback([], [], "", 1_000)).toBeNull();
  });
});

describe("formatMs", () => {
  test("formats minutes and seconds", () => {
    expect(formatMs(161_000)).toBe("2:41");
    expect(formatMs(0)).toBe("0:00");
  });
});

describe("countWords", () => {
  test("counts words", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  ")).toBe(0);
  });
});
