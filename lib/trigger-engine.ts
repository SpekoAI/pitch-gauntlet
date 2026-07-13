export type PersonaId = "skeptic" | "spreadsheet" | "vibes";

export type TriggerKind =
  | "filler_burst"
  | "no_number_mentioned"
  | "continuous_monologue"
  | "buzzword"
  | "silence";

export interface TriggerEngineEvent {
  readonly transcriptDelta: string;
  readonly elapsedMs: number;
  readonly silenceMs: number;
}

export interface TriggerEngineConfig {
  readonly fillerTerms: readonly string[];
  readonly fillerBurstThreshold: number;
  readonly fillerWindowMs: number;
  readonly noNumberDeadlineMs: number;
  readonly monologueThresholdMs: number;
  readonly buzzwords: readonly string[];
  readonly silenceThresholdMs: number;
  readonly cooldownMs: number;
  readonly maxInterruptions: number;
  readonly personaRotation: readonly PersonaId[];
  readonly numberWords: readonly string[];
}

export interface InterruptionDecision {
  readonly trigger: TriggerKind;
  readonly personaId: PersonaId;
  readonly elapsedMs: number;
  readonly interruptionNumber: number;
  readonly evidence: string;
}

export interface TriggerEngineState {
  readonly config: TriggerEngineConfig;
  readonly transcript: string;
  readonly fillerMatchCounts: readonly number[];
  readonly buzzwordMatchCounts: readonly number[];
  readonly fillerTimestampsMs: readonly number[];
  readonly fillerBurstTriggered: boolean;
  readonly numberMentioned: boolean;
  readonly noNumberTriggered: boolean;
  readonly monologueStartedAtMs: number | null;
  readonly monologueTriggered: boolean;
  readonly silenceTriggered: boolean;
  readonly interruptionCount: number;
  readonly lastInterruptionAtMs: number | null;
  readonly lastElapsedMs: number;
}

export interface TriggerEngineResult {
  readonly state: TriggerEngineState;
  readonly decision: InterruptionDecision | null;
}

const DEFAULT_FILLER_TERMS = Object.freeze([
  "um",
  "uh",
  "like",
  "you know",
  "so yeah",
  "kind of",
]);

const DEFAULT_BUZZWORDS = Object.freeze([
  "ai-powered",
  "revolutionary",
  "platform play",
  "synergy",
  "disrupt",
  "game-changer",
  "10x",
  "paradigm",
]);

const DEFAULT_NUMBER_WORDS = Object.freeze([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
  "trillion",
]);

export const DEFAULT_TRIGGER_ENGINE_CONFIG: TriggerEngineConfig = Object.freeze({
  fillerTerms: DEFAULT_FILLER_TERMS,
  fillerBurstThreshold: 3,
  fillerWindowMs: 10_000,
  noNumberDeadlineMs: 25_000,
  monologueThresholdMs: 30_000,
  buzzwords: DEFAULT_BUZZWORDS,
  silenceThresholdMs: 4_000,
  cooldownMs: 8_000,
  maxInterruptions: 6,
  personaRotation: Object.freeze<PersonaId[]>([
    "skeptic",
    "spreadsheet",
    "vibes",
  ]),
  numberWords: DEFAULT_NUMBER_WORDS,
});

const TRIGGER_PRIORITY: readonly TriggerKind[] = Object.freeze([
  "silence",
  "filler_burst",
  "buzzword",
  "no_number_mentioned",
  "continuous_monologue",
]);

export function createTriggerEngineState(
  overrides: Partial<TriggerEngineConfig> = {},
): TriggerEngineState {
  const config = resolveConfig(overrides);

  return {
    config,
    transcript: "",
    fillerMatchCounts: config.fillerTerms.map(() => 0),
    buzzwordMatchCounts: config.buzzwords.map(() => 0),
    fillerTimestampsMs: [],
    fillerBurstTriggered: false,
    numberMentioned: false,
    noNumberTriggered: false,
    monologueStartedAtMs: null,
    monologueTriggered: false,
    silenceTriggered: false,
    interruptionCount: 0,
    lastInterruptionAtMs: null,
    lastElapsedMs: 0,
  };
}

export function processTriggerEvent(
  state: TriggerEngineState,
  event: TriggerEngineEvent,
): TriggerEngineResult {
  validateEvent(state, event);

  const { config } = state;
  const transcript = appendTranscript(state.transcript, event.transcriptDelta);
  const fillerMatchCounts = countConfiguredMatches(
    transcript,
    config.fillerTerms,
  );
  const buzzwordMatchCounts = countConfiguredMatches(
    transcript,
    config.buzzwords,
  );

  const newFillerCount = countNewMatches(
    state.fillerMatchCounts,
    fillerMatchCounts,
  );
  const newFillerTimestamps = Array.from(
    { length: newFillerCount },
    () => event.elapsedMs,
  );
  const fillerTimestampsMs = [
    ...state.fillerTimestampsMs,
    ...newFillerTimestamps,
  ].filter(
    (timestampMs) => event.elapsedMs - timestampMs <= config.fillerWindowMs,
  );

  let fillerBurstTriggered = state.fillerBurstTriggered;
  if (fillerTimestampsMs.length < config.fillerBurstThreshold) {
    fillerBurstTriggered = false;
  }

  const numberMentioned =
    state.numberMentioned || containsNumber(transcript, config.numberWords);
  const hasSpeech = event.transcriptDelta.trim().length > 0;

  let monologueStartedAtMs = state.monologueStartedAtMs;
  let monologueTriggered = state.monologueTriggered;
  let silenceTriggered = state.silenceTriggered;

  if (event.silenceMs > config.silenceThresholdMs) {
    monologueStartedAtMs = null;
    monologueTriggered = false;
  } else {
    silenceTriggered = false;
    if (hasSpeech && monologueStartedAtMs === null) {
      monologueStartedAtMs = event.elapsedMs;
      monologueTriggered = false;
    }
  }

  const newlyMatchedBuzzwords = config.buzzwords.filter(
    (_, index) =>
      (buzzwordMatchCounts[index] ?? 0) >
      (state.buzzwordMatchCounts[index] ?? 0),
  );

  const eligible = new Map<TriggerKind, string>();

  if (
    event.silenceMs > config.silenceThresholdMs &&
    !silenceTriggered
  ) {
    eligible.set("silence", `${event.silenceMs}ms of silence`);
  }

  if (
    fillerTimestampsMs.length >= config.fillerBurstThreshold &&
    !fillerBurstTriggered
  ) {
    eligible.set(
      "filler_burst",
      `${fillerTimestampsMs.length} fillers in ${config.fillerWindowMs}ms`,
    );
  }

  if (newlyMatchedBuzzwords.length > 0) {
    eligible.set("buzzword", newlyMatchedBuzzwords[0] ?? "buzzword");
  }

  if (
    event.elapsedMs >= config.noNumberDeadlineMs &&
    !numberMentioned &&
    !state.noNumberTriggered
  ) {
    eligible.set(
      "no_number_mentioned",
      `no number by ${config.noNumberDeadlineMs}ms`,
    );
  }

  if (
    monologueStartedAtMs !== null &&
    event.elapsedMs - monologueStartedAtMs > config.monologueThresholdMs &&
    !monologueTriggered
  ) {
    eligible.set(
      "continuous_monologue",
      `${event.elapsedMs - monologueStartedAtMs}ms continuous monologue`,
    );
  }

  let nextState: TriggerEngineState = {
    ...state,
    transcript,
    fillerMatchCounts,
    buzzwordMatchCounts,
    fillerTimestampsMs,
    fillerBurstTriggered,
    numberMentioned,
    monologueStartedAtMs,
    monologueTriggered,
    silenceTriggered,
    lastElapsedMs: event.elapsedMs,
  };

  const cooldownComplete =
    state.lastInterruptionAtMs === null ||
    event.elapsedMs - state.lastInterruptionAtMs >= config.cooldownMs;

  if (
    state.interruptionCount >= config.maxInterruptions ||
    !cooldownComplete
  ) {
    return { state: nextState, decision: null };
  }

  const trigger = TRIGGER_PRIORITY.find((candidate) => eligible.has(candidate));
  if (!trigger) {
    return { state: nextState, decision: null };
  }

  if (trigger === "filler_burst") {
    nextState = { ...nextState, fillerBurstTriggered: true };
  } else if (trigger === "no_number_mentioned") {
    nextState = { ...nextState, noNumberTriggered: true };
  } else if (trigger === "continuous_monologue") {
    nextState = { ...nextState, monologueTriggered: true };
  } else if (trigger === "silence") {
    nextState = { ...nextState, silenceTriggered: true };
  }

  const interruptionNumber = state.interruptionCount + 1;
  const personaId =
    config.personaRotation[
      state.interruptionCount % config.personaRotation.length
    ];

  if (!personaId) {
    throw new Error("personaRotation must contain at least one persona");
  }

  const decision: InterruptionDecision = {
    trigger,
    personaId,
    elapsedMs: event.elapsedMs,
    interruptionNumber,
    evidence: eligible.get(trigger) ?? trigger,
  };

  return {
    state: {
      ...nextState,
      interruptionCount: interruptionNumber,
      lastInterruptionAtMs: event.elapsedMs,
    },
    decision,
  };
}

function resolveConfig(
  overrides: Partial<TriggerEngineConfig>,
): TriggerEngineConfig {
  const config: TriggerEngineConfig = {
    ...DEFAULT_TRIGGER_ENGINE_CONFIG,
    ...overrides,
    fillerTerms: Object.freeze([
      ...(overrides.fillerTerms ?? DEFAULT_TRIGGER_ENGINE_CONFIG.fillerTerms),
    ]),
    buzzwords: Object.freeze([
      ...(overrides.buzzwords ?? DEFAULT_TRIGGER_ENGINE_CONFIG.buzzwords),
    ]),
    personaRotation: Object.freeze([
      ...(overrides.personaRotation ??
        DEFAULT_TRIGGER_ENGINE_CONFIG.personaRotation),
    ]),
    numberWords: Object.freeze([
      ...(overrides.numberWords ?? DEFAULT_TRIGGER_ENGINE_CONFIG.numberWords),
    ]),
  };

  validateConfig(config);
  return Object.freeze(config);
}

function validateConfig(config: TriggerEngineConfig): void {
  validatePositiveInteger(
    "fillerBurstThreshold",
    config.fillerBurstThreshold,
  );
  validatePositiveNumber("fillerWindowMs", config.fillerWindowMs);
  validateNonNegativeNumber("noNumberDeadlineMs", config.noNumberDeadlineMs);
  validatePositiveNumber("monologueThresholdMs", config.monologueThresholdMs);
  validateNonNegativeNumber("silenceThresholdMs", config.silenceThresholdMs);
  validateNonNegativeNumber("cooldownMs", config.cooldownMs);
  validatePositiveInteger("maxInterruptions", config.maxInterruptions);

  validateTerms("fillerTerms", config.fillerTerms);
  validateTerms("buzzwords", config.buzzwords);
  validateTerms("numberWords", config.numberWords);

  if (config.personaRotation.length === 0) {
    throw new Error("personaRotation must contain at least one persona");
  }
}

function validateEvent(
  state: TriggerEngineState,
  event: TriggerEngineEvent,
): void {
  validateNonNegativeNumber("elapsedMs", event.elapsedMs);
  validateNonNegativeNumber("silenceMs", event.silenceMs);

  if (event.elapsedMs < state.lastElapsedMs) {
    throw new Error("elapsedMs must be monotonic");
  }
}

function validatePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function validateNonNegativeNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function validateTerms(name: string, terms: readonly string[]): void {
  const normalized = terms.map((term) => term.trim().toLowerCase());

  if (normalized.some((term) => term.length === 0)) {
    throw new Error(`${name} cannot contain empty values`);
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} cannot contain duplicate values`);
  }
}

function appendTranscript(transcript: string, delta: string): string {
  if (delta.length === 0) {
    return transcript;
  }

  if (transcript.length === 0) {
    return delta;
  }

  const needsSpace = !/\s$/.test(transcript) && !/^\s/.test(delta);
  return `${transcript}${needsSpace ? " " : ""}${delta}`;
}

function countConfiguredMatches(
  transcript: string,
  terms: readonly string[],
): readonly number[] {
  return terms.map((term) => countPhraseOccurrences(transcript, term));
}

function countNewMatches(
  previousCounts: readonly number[],
  currentCounts: readonly number[],
): number {
  return currentCounts.reduce(
    (total, current, index) =>
      total + Math.max(0, current - (previousCounts[index] ?? 0)),
    0,
  );
}

function countPhraseOccurrences(text: string, phrase: string): number {
  const words = phrase
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp)
    .join("[\\s-]+");
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${words}(?=$|[^a-z0-9])`,
    "gi",
  );

  return Array.from(text.matchAll(pattern)).length;
}

function containsNumber(text: string, numberWords: readonly string[]): boolean {
  if (/\d/.test(text)) {
    return true;
  }

  return numberWords.some((word) => countPhraseOccurrences(text, word) > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
