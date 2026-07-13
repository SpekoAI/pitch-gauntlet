export interface ScoringInput {
  survivalTimeSeconds: number;
  interruptionsTriggered: number;
  fillerCount: number;
  wpm: number;
  buzzwordCount: number;
}

export interface ScoreBreakdown {
  survival: number;
  pace: number;
  delivery: number;
}

export interface ScoreResult {
  compositeScore: number;
  percentile: number;
  breakdown: ScoreBreakdown;
}

// PLACEHOLDER-SEED-DISTRIBUTION: Recalibrate with production run scores.
export const SCORE_SEED_DISTRIBUTION = Object.freeze([
  24, 29, 33, 36, 39, 41, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66,
  68, 70, 72, 74, 76, 78, 81, 84, 87, 91,
]);

const MAX_RUN_SECONDS = 90;
const IDEAL_WPM = 145;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function assertCount(value: number, name: string): void {
  assertFiniteNonNegative(value, name);
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer`);
  }
}

function calculatePercentile(score: number): number {
  let scoresBelow = 0;
  let scoresEqual = 0;

  for (const seededScore of SCORE_SEED_DISTRIBUTION) {
    if (seededScore < score) {
      scoresBelow += 1;
    } else if (seededScore === score) {
      scoresEqual += 1;
    }
  }

  const rank = scoresBelow + scoresEqual / 2;
  return Math.round((rank / SCORE_SEED_DISTRIBUTION.length) * 100);
}

/**
 * Scores a pitch run on a 0-100 scale. Survival is worth 50 points, a clear
 * speaking pace is worth 20, and delivery discipline is worth 30.
 */
export function calculateScore(input: ScoringInput): ScoreResult {
  assertFiniteNonNegative(input.survivalTimeSeconds, "survivalTimeSeconds");
  assertCount(input.interruptionsTriggered, "interruptionsTriggered");
  assertCount(input.fillerCount, "fillerCount");
  assertFiniteNonNegative(input.wpm, "wpm");
  assertCount(input.buzzwordCount, "buzzwordCount");

  const survival =
    clamp(input.survivalTimeSeconds / MAX_RUN_SECONDS, 0, 1) * 50;
  const pace = clamp(20 - Math.abs(input.wpm - IDEAL_WPM) * 0.25, 0, 20);
  const delivery = clamp(
    30 -
      input.interruptionsTriggered * 3 -
      input.fillerCount * 1.5 -
      input.buzzwordCount * 2,
    0,
    30,
  );

  const compositeScore = Math.round(clamp(survival + pace + delivery, 0, 100));

  return {
    compositeScore,
    percentile: calculatePercentile(compositeScore),
    breakdown: {
      survival: roundToTenth(survival),
      pace: roundToTenth(pace),
      delivery: roundToTenth(delivery),
    },
  };
}
