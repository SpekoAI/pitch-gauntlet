import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TRIGGER_ENGINE_CONFIG,
  createTriggerEngineState,
  processTriggerEvent,
  type InterruptionDecision,
  type TriggerEngineEvent,
  type TriggerEngineState,
} from "./trigger-engine";

function consume(
  state: TriggerEngineState,
  event: Partial<TriggerEngineEvent> = {},
): [TriggerEngineState, InterruptionDecision | null] {
  const result = processTriggerEvent(state, {
    transcriptDelta: "",
    elapsedMs: 0,
    silenceMs: 0,
    ...event,
  });

  return [result.state, result.decision];
}

describe("filler burst trigger", () => {
  for (const filler of DEFAULT_TRIGGER_ENGINE_CONFIG.fillerTerms) {
    test(`recognizes the default filler: ${filler}`, () => {
      const state = createTriggerEngineState();
      const result = processTriggerEvent(state, {
        transcriptDelta: `${filler}, ${filler}, ${filler}`,
        elapsedMs: 1_000,
        silenceMs: 0,
      });

      expect(result.decision?.trigger).toBe("filler_burst");
      expect(result.decision?.evidence).toBe("3 fillers in 10000ms");
    });
  }

  test("fires for three fillers at the inclusive edge of the rolling window", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      transcriptDelta: "um",
      elapsedMs: 0,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      transcriptDelta: "uh",
      elapsedMs: 5_000,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      transcriptDelta: "like",
      elapsedMs: 10_000,
    });
    expect(decision?.trigger).toBe("filler_burst");
  });

  test("does not count a filler outside the rolling window", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state] = consume(state, { transcriptDelta: "um", elapsedMs: 0 });
    [state] = consume(state, { transcriptDelta: "uh", elapsedMs: 5_000 });
    [state, decision] = consume(state, {
      transcriptDelta: "like",
      elapsedMs: 10_001,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      transcriptDelta: "um",
      elapsedMs: 10_002,
    });
    expect(decision?.trigger).toBe("filler_burst");
  });

  test("detects multiword fillers split across transcript deltas", () => {
    let state = createTriggerEngineState();

    [state] = consume(state, {
      transcriptDelta: "you",
      elapsedMs: 1_000,
    });
    const [, decision] = consume(state, {
      transcriptDelta: "know, um, uh",
      elapsedMs: 2_000,
    });

    expect(decision?.trigger).toBe("filler_burst");
  });

  test("uses word boundaries and does not match filler substrings", () => {
    const state = createTriggerEngineState();
    const [, decision] = consume(state, {
      transcriptDelta: "aluminum is unlikeable and disliked",
      elapsedMs: 1_000,
    });

    expect(decision).toBeNull();
  });

  test("fires once per burst and rearms after the window clears", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      transcriptDelta: "um uh like",
      elapsedMs: 0,
    });
    expect(decision?.trigger).toBe("filler_burst");

    [state, decision] = consume(state, {
      transcriptDelta: "um",
      elapsedMs: 8_000,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, { elapsedMs: 18_001 });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      transcriptDelta: "uh like um",
      elapsedMs: 18_002,
    });
    expect(decision?.trigger).toBe("filler_burst");
  });
});

describe("no number trigger", () => {
  test("fires at 25 seconds when no number was mentioned", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      transcriptDelta: "We help teams ship software",
      elapsedMs: 24_999,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, { elapsedMs: 25_000 });
    expect(decision?.trigger).toBe("no_number_mentioned");
  });

  for (const transcriptDelta of [
    "We have 42 active customers",
    "We have forty active customers",
  ]) {
    test(`accepts a number in: ${transcriptDelta}`, () => {
      const state = createTriggerEngineState();
      const [, decision] = consume(state, {
        transcriptDelta,
        elapsedMs: 25_000,
      });

      expect(decision).toBeNull();
    });
  }

  test("only fires once in a run", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, { elapsedMs: 25_000 });
    expect(decision?.trigger).toBe("no_number_mentioned");

    [state, decision] = consume(state, { elapsedMs: 33_000 });
    expect(decision).toBeNull();
  });
});

describe("continuous monologue trigger", () => {
  test("fires only after more than 30 seconds of continuous speech", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state] = consume(state, {
      transcriptDelta: "We have 12 paying customers",
      elapsedMs: 0,
    });
    [state, decision] = consume(state, { elapsedMs: 30_000 });
    expect(decision).toBeNull();

    [state, decision] = consume(state, { elapsedMs: 30_001 });
    expect(decision?.trigger).toBe("continuous_monologue");
  });

  test("fires once per monologue and rearms after significant silence", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state] = consume(state, {
      transcriptDelta: "We have 12 customers",
      elapsedMs: 0,
    });
    [state, decision] = consume(state, { elapsedMs: 30_001 });
    expect(decision?.trigger).toBe("continuous_monologue");

    [state, decision] = consume(state, { elapsedMs: 38_001 });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      elapsedMs: 39_000,
      silenceMs: 4_001,
    });
    expect(decision?.trigger).toBe("silence");

    [state] = consume(state, {
      transcriptDelta: "The next point",
      elapsedMs: 40_000,
      silenceMs: 0,
    });
    [state, decision] = consume(state, { elapsedMs: 70_001 });
    expect(decision?.trigger).toBe("continuous_monologue");
  });
});

describe("buzzword trigger", () => {
  for (const buzzword of DEFAULT_TRIGGER_ENGINE_CONFIG.buzzwords) {
    test(`recognizes the default buzzword: ${buzzword}`, () => {
      const state = createTriggerEngineState();
      const [, decision] = consume(state, {
        transcriptDelta: `This is our ${buzzword} approach`,
        elapsedMs: 1_000,
      });

      expect(decision?.trigger).toBe("buzzword");
      expect(decision?.evidence).toBe(buzzword);
    });
  }

  test("accepts spaces where a configured buzzword has a hyphen", () => {
    const state = createTriggerEngineState();
    const [, decision] = consume(state, {
      transcriptDelta: "This AI powered product is a game changer",
      elapsedMs: 1_000,
    });

    expect(decision?.trigger).toBe("buzzword");
    expect(decision?.evidence).toBe("ai-powered");
  });
});

describe("silence trigger", () => {
  test("fires only after more than four seconds of silence", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      elapsedMs: 4_000,
      silenceMs: 4_000,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      elapsedMs: 4_001,
      silenceMs: 4_001,
    });
    expect(decision?.trigger).toBe("silence");
  });

  test("fires once per silence episode and rearms when speech resumes", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      elapsedMs: 4_001,
      silenceMs: 4_001,
    });
    expect(decision?.trigger).toBe("silence");

    [state, decision] = consume(state, {
      elapsedMs: 12_001,
      silenceMs: 12_001,
    });
    expect(decision).toBeNull();

    [state] = consume(state, {
      transcriptDelta: "Back to the pitch",
      elapsedMs: 13_000,
      silenceMs: 0,
    });
    [state, decision] = consume(state, {
      elapsedMs: 21_001,
      silenceMs: 4_001,
    });
    expect(decision?.trigger).toBe("silence");
  });
});

describe("interruption controls", () => {
  test("uses deterministic priority when triggers coincide", () => {
    const state = createTriggerEngineState();
    const [, decision] = consume(state, {
      transcriptDelta: "um uh like synergy",
      elapsedMs: 25_000,
      silenceMs: 4_001,
    });

    expect(decision?.trigger).toBe("silence");
  });

  test("enforces an eight second cooldown with an inclusive endpoint", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      transcriptDelta: "revolutionary",
      elapsedMs: 0,
    });
    expect(decision?.trigger).toBe("buzzword");

    [state, decision] = consume(state, {
      transcriptDelta: "synergy",
      elapsedMs: 7_999,
    });
    expect(decision).toBeNull();

    [state, decision] = consume(state, {
      transcriptDelta: "paradigm",
      elapsedMs: 8_000,
    });
    expect(decision?.trigger).toBe("buzzword");
  });

  test("keeps a duration trigger eligible while cooldown is active", () => {
    let state = createTriggerEngineState();
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      transcriptDelta: "revolutionary",
      elapsedMs: 20_000,
    });
    expect(decision?.trigger).toBe("buzzword");

    [state, decision] = consume(state, { elapsedMs: 25_000 });
    expect(decision).toBeNull();

    [state, decision] = consume(state, { elapsedMs: 28_000 });
    expect(decision?.trigger).toBe("no_number_mentioned");
  });

  test("caps a run at six interruptions", () => {
    let state = createTriggerEngineState();
    const decisions: InterruptionDecision[] = [];

    for (let index = 0; index < 7; index += 1) {
      const result = processTriggerEvent(state, {
        transcriptDelta: "synergy",
        elapsedMs: index * 8_000,
        silenceMs: 0,
      });
      state = result.state;
      if (result.decision) {
        decisions.push(result.decision);
      }
    }

    expect(decisions).toHaveLength(6);
    expect(state.interruptionCount).toBe(6);
  });

  test("rotates skeptic, spreadsheet, and vibes, then repeats", () => {
    let state = createTriggerEngineState();
    const personas: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      const result = processTriggerEvent(state, {
        transcriptDelta: "synergy",
        elapsedMs: index * 8_000,
        silenceMs: 0,
      });
      state = result.state;
      if (result.decision) {
        personas.push(result.decision.personaId);
      }
    }

    expect(personas).toEqual([
      "skeptic",
      "spreadsheet",
      "vibes",
      "skeptic",
      "spreadsheet",
      "vibes",
    ]);
  });
});

describe("configuration and determinism", () => {
  test("supports tuned terms, thresholds, cooldown, cap, and rotation", () => {
    let state = createTriggerEngineState({
      fillerTerms: ["hmm"],
      fillerBurstThreshold: 2,
      fillerWindowMs: 1_000,
      noNumberDeadlineMs: 100_000,
      monologueThresholdMs: 100_000,
      buzzwords: ["rocket"],
      silenceThresholdMs: 100,
      cooldownMs: 0,
      maxInterruptions: 2,
      personaRotation: ["vibes"],
      numberWords: ["pair"],
    });
    let decision: InterruptionDecision | null;

    [state, decision] = consume(state, {
      transcriptDelta: "hmm hmm",
      elapsedMs: 1_000,
    });
    expect(decision).toMatchObject({
      trigger: "filler_burst",
      personaId: "vibes",
    });

    [state, decision] = consume(state, {
      elapsedMs: 1_001,
      silenceMs: 101,
    });
    expect(decision).toMatchObject({ trigger: "silence", personaId: "vibes" });

    [state, decision] = consume(state, {
      transcriptDelta: "rocket",
      elapsedMs: 2_000,
    });
    expect(decision).toBeNull();
  });

  test("does not mutate input state and produces equal results for equal input", () => {
    const state = createTriggerEngineState();
    const event = {
      transcriptDelta: "um uh like",
      elapsedMs: 1_000,
      silenceMs: 0,
    };

    const first = processTriggerEvent(state, event);
    const second = processTriggerEvent(state, event);

    expect(first).toEqual(second);
    expect(state).toEqual(createTriggerEngineState());
  });

  test("rejects non-monotonic elapsed time", () => {
    let state = createTriggerEngineState();
    [state] = consume(state, { elapsedMs: 2_000 });

    expect(() => consume(state, { elapsedMs: 1_999 })).toThrow(
      "elapsedMs must be monotonic",
    );
  });

  test("rejects invalid configuration", () => {
    expect(() =>
      createTriggerEngineState({ personaRotation: [] }),
    ).toThrow("personaRotation must contain at least one persona");
    expect(() =>
      createTriggerEngineState({ fillerBurstThreshold: 0 }),
    ).toThrow("fillerBurstThreshold must be a positive integer");
  });
});
