import { describe, expect, test } from "bun:test";

import { calculateScore, SCORE_SEED_DISTRIBUTION } from "./scoring";

describe("calculateScore", () => {
  test("awards 100 for a full clean run at the ideal pace", () => {
    expect(
      calculateScore({
        survivalTimeSeconds: 90,
        interruptionsTriggered: 0,
        fillerCount: 0,
        wpm: 145,
        buzzwordCount: 0,
      }),
    ).toEqual({
      compositeScore: 100,
      percentile: 100,
      breakdown: { survival: 50, pace: 20, delivery: 30 },
    });
  });

  test("caps survival credit at 90 seconds", () => {
    const input = {
      interruptionsTriggered: 0,
      fillerCount: 0,
      wpm: 145,
      buzzwordCount: 0,
    };

    expect(calculateScore({ ...input, survivalTimeSeconds: 120 })).toEqual(
      calculateScore({ ...input, survivalTimeSeconds: 90 }),
    );
  });

  test("gives proportional survival credit", () => {
    const result = calculateScore({
      survivalTimeSeconds: 45,
      interruptionsTriggered: 0,
      fillerCount: 0,
      wpm: 145,
      buzzwordCount: 0,
    });

    expect(result.breakdown.survival).toBe(25);
    expect(result.compositeScore).toBe(75);
  });

  test("scores speaking pace symmetrically around 145 wpm", () => {
    const base = {
      survivalTimeSeconds: 90,
      interruptionsTriggered: 0,
      fillerCount: 0,
      buzzwordCount: 0,
    };

    expect(calculateScore({ ...base, wpm: 125 }).breakdown.pace).toBe(
      15,
    );
    expect(calculateScore({ ...base, wpm: 165 }).breakdown.pace).toBe(
      15,
    );
  });

  test("floors the pace component for extreme rates", () => {
    const result = calculateScore({
      survivalTimeSeconds: 90,
      interruptionsTriggered: 0,
      fillerCount: 0,
      wpm: 400,
      buzzwordCount: 0,
    });

    expect(result.breakdown.pace).toBe(0);
  });

  test("applies each delivery penalty", () => {
    const result = calculateScore({
      survivalTimeSeconds: 90,
      interruptionsTriggered: 2,
      fillerCount: 4,
      wpm: 145,
      buzzwordCount: 3,
    });

    expect(result.breakdown.delivery).toBe(12);
    expect(result.compositeScore).toBe(82);
  });

  test("floors the delivery component at zero", () => {
    const result = calculateScore({
      survivalTimeSeconds: 90,
      interruptionsTriggered: 6,
      fillerCount: 20,
      wpm: 145,
      buzzwordCount: 20,
    });

    expect(result.breakdown.delivery).toBe(0);
    expect(result.compositeScore).toBe(70);
  });

  test("uses midpoint rank for a score present in the seed", () => {
    const result = calculateScore({
      survivalTimeSeconds: 45,
      interruptionsTriggered: 0,
      fillerCount: 2,
      wpm: 145,
      buzzwordCount: 0,
    });

    expect(result.compositeScore).toBe(72);
    const lowerScores = SCORE_SEED_DISTRIBUTION.filter((score) => score < 72);
    const equalScores = SCORE_SEED_DISTRIBUTION.filter((score) => score === 72);
    const expected = Math.round(
      ((lowerScores.length + equalScores.length / 2) /
        SCORE_SEED_DISTRIBUTION.length) *
        100,
    );
    expect(result.percentile).toBe(expected);
  });

  test("returns percentile zero below the seed distribution", () => {
    const result = calculateScore({
      survivalTimeSeconds: 0,
      interruptionsTriggered: 10,
      fillerCount: 20,
      wpm: 0,
      buzzwordCount: 10,
    });

    expect(result.compositeScore).toBe(0);
    expect(result.percentile).toBe(0);
  });

  test.each([
    ["survivalTimeSeconds", -1],
    ["survivalTimeSeconds", Number.NaN],
    ["interruptionsTriggered", 1.5],
    ["fillerCount", -1],
    ["wpm", Number.POSITIVE_INFINITY],
    ["buzzwordCount", 0.25],
  ] as const)("rejects invalid %s values", (field, value) => {
    const input = {
      survivalTimeSeconds: 90,
      interruptionsTriggered: 0,
      fillerCount: 0,
      wpm: 145,
      buzzwordCount: 0,
      [field]: value,
    };

    expect(() => calculateScore(input)).toThrow(field);
  });
});
