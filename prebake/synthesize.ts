import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePcmSampleRate, pcmToWav } from "../lib/pcm-to-wav";

const PERSONA_IDS = ["skeptic", "spreadsheet", "vibes"] as const;
const EXPECTED_LINES_PER_PERSONA = 8;
const DEFAULT_CONCURRENCY = 3;

type PersonaId = (typeof PERSONA_IDS)[number];

interface Interjection {
  personaId: PersonaId;
  lineId: string;
  text: string;
  tags: string[];
}

export interface VoiceCandidate {
  vendor: string;
  id: string;
  name: string;
  [key: string]: unknown;
}

interface VoiceResponse {
  voices?: unknown;
}

interface SynthesisConfig {
  apiBase: string;
  apiKey: string;
  outputRoot: string;
  concurrency: number;
}

const VOICE_HINTS: Record<PersonaId, readonly string[]> = {
  // PLACEHOLDER-CASTING: Replace these heuristics with the final voice cast.
  skeptic: ["onyx", "deep", "baritone", "low", "male"],
  spreadsheet: ["nova", "crisp", "bright", "katie", "female"],
  vibes: ["echo", "alloy", "relaxed", "calm", "casual", "fable", "warm"],
};

function isPersonaId(value: unknown): value is PersonaId {
  return PERSONA_IDS.includes(value as PersonaId);
}

function assertAscii(value: string, label: string): void {
  if (/[^\x00-\x7f]/.test(value)) {
    throw new TypeError(`${label} must contain ASCII characters only`);
  }
}

function parseInterjections(value: unknown): Interjection[] {
  if (!Array.isArray(value)) {
    throw new TypeError("interjections.json must contain an array");
  }

  const seenLineIds = new Set<string>();
  const counts = new Map<PersonaId, number>(
    PERSONA_IDS.map((personaId) => [personaId, 0]),
  );

  const interjections = value.map((entry, index): Interjection => {
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError(`interjection ${index} must be an object`);
    }

    const { personaId, lineId, text, tags } = entry as Record<string, unknown>;
    if (!isPersonaId(personaId)) {
      throw new TypeError(`interjection ${index} has an invalid personaId`);
    }
    if (typeof lineId !== "string" || !/^[a-z0-9-]+$/.test(lineId)) {
      throw new TypeError(`interjection ${index} has an invalid lineId`);
    }
    if (seenLineIds.has(lineId)) {
      throw new TypeError(`duplicate lineId: ${lineId}`);
    }
    if (typeof text !== "string" || !text.startsWith("PLACEHOLDER:")) {
      throw new TypeError(`interjection ${lineId} must have PLACEHOLDER text`);
    }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
      throw new TypeError(`interjection ${lineId} has invalid tags`);
    }

    assertAscii(lineId, `lineId ${lineId}`);
    assertAscii(text, `text ${lineId}`);
    for (const tag of tags as string[]) {
      assertAscii(tag, `tag ${lineId}`);
    }

    seenLineIds.add(lineId);
    counts.set(personaId, (counts.get(personaId) ?? 0) + 1);
    return { personaId, lineId, text, tags: tags as string[] };
  });

  for (const personaId of PERSONA_IDS) {
    if (counts.get(personaId) !== EXPECTED_LINES_PER_PERSONA) {
      throw new TypeError(
        `${personaId} must have exactly ${EXPECTED_LINES_PER_PERSONA} lines`,
      );
    }
  }

  return interjections;
}

function parseVoiceCandidates(value: unknown): VoiceCandidate[] {
  if (!Array.isArray(value)) {
    throw new TypeError("voice response must include a voices array");
  }

  const voices = value.filter((voice): voice is VoiceCandidate => {
    if (typeof voice !== "object" || voice === null) {
      return false;
    }
    const candidate = voice as Record<string, unknown>;
    return (
      typeof candidate.vendor === "string" &&
      typeof candidate.id === "string" &&
      typeof candidate.name === "string"
    );
  });

  const uniqueVoices = new Map<string, VoiceCandidate>();
  for (const voice of voices) {
    uniqueVoices.set(`${voice.vendor}:${voice.id}`, voice);
  }

  if (uniqueVoices.size < PERSONA_IDS.length) {
    throw new TypeError("at least three distinct voices are required");
  }

  return [...uniqueVoices.values()];
}

function voiceScore(voice: VoiceCandidate, hints: readonly string[]): number {
  const searchable = `${voice.name} ${voice.id}`.toLowerCase();
  return hints.reduce((score, hint, index) => {
    if (!searchable.includes(hint)) {
      return score;
    }
    return score + (hints.length - index) * 100;
  }, 0);
}

/**
 * PLACEHOLDER-CASTING: Selects three distinct voices by public voice names.
 * The persona order and tie breaking are deterministic.
 */
export function selectPlaceholderVoices(
  input: readonly VoiceCandidate[],
): Record<PersonaId, VoiceCandidate> {
  const voices = parseVoiceCandidates(input);
  const used = new Set<string>();
  const selected = {} as Record<PersonaId, VoiceCandidate>;

  for (const personaId of PERSONA_IDS) {
    const candidate = voices
      .map((voice, index) => ({
        voice,
        index,
        key: `${voice.vendor}:${voice.id}`,
        score: voiceScore(voice, VOICE_HINTS[personaId]),
      }))
      .filter(({ key }) => !used.has(key))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0];

    if (!candidate) {
      throw new TypeError(`no unused voice is available for ${personaId}`);
    }

    selected[personaId] = candidate.voice;
    used.add(candidate.key);
  }

  return selected;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError("PREBAKE_CONCURRENCY must be a positive integer");
  }
  return parsed;
}

async function fetchVoices(config: SynthesisConfig): Promise<VoiceCandidate[]> {
  const response = await fetch(`${config.apiBase}/v1/voices`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`voice request failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as VoiceResponse;
  return parseVoiceCandidates(payload.voices);
}

async function synthesizeLine(
  config: SynthesisConfig,
  interjection: Interjection,
  voice: VoiceCandidate,
): Promise<void> {
  const startedAt = performance.now();
  let voiceWireFormat = "object";
  let response = await requestSynthesis(config, interjection.text, voice);

  if (!response.ok && response.status === 400) {
    const details = (await response.text()).slice(0, 500);
    if (/voice must be a string/i.test(details)) {
      // Live probe on 2026-07-12 found a temporary wire mismatch: /voices
      // returned objects while /synthesize required the selected voice id.
      voiceWireFormat = "id";
      response = await requestSynthesis(config, interjection.text, voice.id);
    } else {
      throw new Error(
        `synthesis failed for ${interjection.lineId} (${response.status}): ${details}`,
      );
    }
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(
      `synthesis failed for ${interjection.lineId} (${response.status}): ${details}`,
    );
  }

  const firstByteMs = response.headers.get("x-speko-first-byte-ms") ?? "unknown";
  const sampleRate = parsePcmSampleRate(
    response.headers.get("x-speko-audio-format"),
  );
  const pcm = new Uint8Array(await response.arrayBuffer());
  const wav = pcmToWav(pcm, sampleRate);
  const outputDirectory = path.join(config.outputRoot, interjection.personaId);
  const outputPath = path.join(outputDirectory, `${interjection.lineId}.wav`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, wav);

  const totalMs = Math.round(performance.now() - startedAt);
  console.log(
    `Synthesized ${interjection.personaId}/${interjection.lineId} ` +
      `voice=${voice.name} vendor=${voice.vendor} rate=${sampleRate} ` +
      `voiceWire=${voiceWireFormat} firstByteMs=${firstByteMs} totalMs=${totalMs}`,
  );
}

function requestSynthesis(
  config: SynthesisConfig,
  text: string,
  voice: VoiceCandidate | string,
): Promise<Response> {
  return fetch(`${config.apiBase}/v1/synthesize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      intent: { language: "en", useCase: "conversational" },
      voice,
    }),
  });
}

async function runWorkers<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export async function main(): Promise<void> {
  const apiKey = process.env.SPEKO_API_KEY;
  const apiBase = process.env.SPEKO_API_BASE?.replace(/\/+$/, "");
  if (!apiKey) {
    throw new TypeError("SPEKO_API_KEY is required");
  }
  if (!apiBase) {
    throw new TypeError("SPEKO_API_BASE is required");
  }

  const config: SynthesisConfig = {
    apiKey,
    apiBase,
    concurrency: readPositiveInteger(
      process.env.PREBAKE_CONCURRENCY,
      DEFAULT_CONCURRENCY,
    ),
    outputRoot: fileURLToPath(
      new URL("../public/prebaked", import.meta.url),
    ),
  };
  const sourcePath = fileURLToPath(new URL("./interjections.json", import.meta.url));
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  const interjections = parseInterjections(source);
  const voices = await fetchVoices(config);
  const selectedVoices = selectPlaceholderVoices(voices);

  for (const personaId of PERSONA_IDS) {
    const voice = selectedVoices[personaId];
    console.log(
      `PLACEHOLDER-CASTING ${personaId}: ${voice.name} ` +
        `(${voice.vendor}:${voice.id})`,
    );
  }

  await runWorkers(interjections, config.concurrency, (interjection) =>
    synthesizeLine(
      config,
      interjection,
      selectedVoices[interjection.personaId],
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
