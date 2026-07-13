import { isRecord } from "./speko-sse";
import interjections from "../prebake/interjections.json";

const MAX_SLOT_WORDS = 6;
const MAX_SLOT_CHARACTERS = 120;

const ALLOWED_LINES = new Map(
  interjections.map((interjection) => [interjection.lineId, interjection.text]),
);

interface TemplateDefinition {
  text: string;
  slots: readonly string[];
}

const ALLOWED_TEMPLATES: Readonly<Record<string, TemplateDefinition>> = {
  // PLACEHOLDER templates pending designer-owned interjection scripts.
  clarify: {
    text: "Pause. Explain {topic} in plain English.",
    slots: ["topic"],
  },
  evidence: {
    text: "That is vague. What evidence supports {claim}?",
    slots: ["claim"],
  },
  metric: {
    text: "Stop there. Give me one number for {metric}.",
    slots: ["metric"],
  },
  pace: {
    text: "Slow down. I lost the thread after {point}.",
    slots: ["point"],
  },
};

const PROFANITY = new Set([
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "dick",
  "fuck",
  "fucker",
  "fucking",
  "piss",
  "shit",
  "slut",
]);

export function buildSynthesisText(input: unknown): string {
  if (!isRecord(input)) {
    throw new SynthRequestError("Request body must be an object");
  }

  const allowedKeys = new Set(["lineId", "templateId", "slots"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new SynthRequestError("Request contains an unsupported field");
  }

  const lineId = input.lineId;
  const templateId = input.templateId;
  if (
    lineId !== undefined &&
    (typeof lineId !== "string" || lineId.length === 0)
  ) {
    throw new SynthRequestError("lineId must be a non-empty string");
  }
  if (
    templateId !== undefined &&
    (typeof templateId !== "string" || templateId.length === 0)
  ) {
    throw new SynthRequestError("templateId must be a non-empty string");
  }

  const hasLineId = typeof lineId === "string" && lineId.length > 0;
  const hasTemplateId = typeof templateId === "string" && templateId.length > 0;
  if (hasLineId === hasTemplateId) {
    throw new SynthRequestError("Provide exactly one lineId or templateId");
  }

  if (hasLineId) {
    if (input.slots !== undefined) {
      throw new SynthRequestError("slots are only allowed with templateId");
    }
    if (!ALLOWED_LINES.has(lineId)) {
      throw new SynthRequestError("lineId is not allowlisted");
    }
    return ALLOWED_LINES.get(lineId) as string;
  }

  if (!Object.hasOwn(ALLOWED_TEMPLATES, templateId as string)) {
    throw new SynthRequestError("templateId is not allowlisted");
  }
  const template = ALLOWED_TEMPLATES[templateId as string];
  if (!isRecord(input.slots)) {
    throw new SynthRequestError("slots must be an object");
  }

  const suppliedKeys = Object.keys(input.slots);
  if (
    suppliedKeys.length !== template.slots.length ||
    suppliedKeys.some((key) => !template.slots.includes(key))
  ) {
    throw new SynthRequestError("slots do not match the selected template");
  }

  let rendered = template.text;
  for (const slotName of template.slots) {
    rendered = rendered.replace(
      `{${slotName}}`,
      sanitizeSlotValue(input.slots[slotName], slotName),
    );
  }
  return rendered;
}

export function sanitizeSlotValue(value: unknown, slotName = "slot"): string {
  if (typeof value !== "string") {
    throw new SynthRequestError(`${slotName} must be a string`);
  }

  const sanitized = value
    .replace(/[^A-Za-z0-9\s.,!?' -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) {
    throw new SynthRequestError(`${slotName} is empty after sanitization`);
  }
  if (sanitized.length > MAX_SLOT_CHARACTERS) {
    throw new SynthRequestError(`${slotName} is too long`);
  }

  const wordTokens = sanitized.match(/[A-Za-z0-9]+/g) ?? [];
  if (wordTokens.length > MAX_SLOT_WORDS) {
    throw new SynthRequestError(`${slotName} exceeds six words`);
  }

  const compactChunks = sanitized
    .split(/\s+/)
    .map((chunk) => chunk.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const profanityCandidates = [
    ...wordTokens.map((word) => word.toLowerCase()),
    ...compactChunks,
    sanitized.toLowerCase().replace(/[^a-z0-9]/g, ""),
  ];
  for (const candidate of profanityCandidates) {
    if (PROFANITY.has(candidate)) {
      throw new SynthRequestError(`${slotName} contains blocked language`);
    }
  }

  return sanitized;
}

export class SynthRequestError extends Error {}
