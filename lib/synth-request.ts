import interjections from "../prebake/interjections-final.json";

import { isRecord } from "./speko-sse";

const MAX_SLOT_WORDS = 6;
const MAX_SLOT_CHARACTERS = 120;
const REQUEST_KEYS = new Set(["templateId", "slots"]);
const WORD_PATTERN = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g;

interface TemplateDefinition {
  text: string;
  slots: Readonly<Record<string, string>>;
}

const ALLOWED_TEMPLATES = new Map<string, TemplateDefinition>(
  interjections.slotTemplates.map((definition) => [
    definition.templateId,
    {
      text: definition.template,
      slots: toSlotConstraints(definition.slots),
    },
  ]),
);

function toSlotConstraints(slots: object): Record<string, string> {
  const constraints: Record<string, string> = {};
  for (const [slotName, constraint] of Object.entries(slots)) {
    if (typeof constraint !== "string") {
      throw new TypeError(`Invalid constraint for synth slot ${slotName}`);
    }
    constraints[slotName] = constraint;
  }
  return constraints;
}

const PROFANITY = [
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
];

const PROFANITY_PATTERNS = PROFANITY.map(
  (word) =>
    new RegExp(
      `(?:^|[^A-Za-z0-9])${word.split("").join("[^A-Za-z0-9]*")}(?:$|[^A-Za-z0-9])`,
      "i",
    ),
);

export function buildSynthesisText(input: unknown): string {
  if (!isRecord(input)) {
    throw new SynthRequestError("Request body must be an object");
  }

  if (Object.keys(input).some((key) => !REQUEST_KEYS.has(key))) {
    throw new SynthRequestError("Request contains an unsupported field");
  }

  if (typeof input.templateId !== "string" || input.templateId.length === 0) {
    throw new SynthRequestError("templateId must be a non-empty string");
  }

  const template = ALLOWED_TEMPLATES.get(input.templateId);
  if (!template) {
    throw new SynthRequestError("templateId is not allowlisted");
  }

  if (!isRecord(input.slots)) {
    throw new SynthRequestError("slots must be an object");
  }

  const suppliedKeys = Object.keys(input.slots);
  const expectedKeys = Object.keys(template.slots);
  if (
    suppliedKeys.length !== expectedKeys.length ||
    suppliedKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new SynthRequestError("slots do not match the selected template");
  }

  let rendered = template.text;
  for (const slotName of expectedKeys) {
    const value = sanitizeSlotValue(input.slots[slotName], slotName);
    validateManifestSlotValue(value, slotName, template.slots[slotName]);
    rendered = rendered.split(`{${slotName}}`).join(value);
  }
  return rendered;
}

function validateManifestSlotValue(
  value: string,
  slotName: string,
  constraint: string,
): void {
  if (
    constraint === "single word from user transcript" &&
    !/^[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*$/.test(value)
  ) {
    throw new SynthRequestError(`${slotName} must be a single word`);
  }

  if (constraint === "integer 2-9" && !/^[2-9]$/.test(value)) {
    throw new SynthRequestError(`${slotName} must be an integer from 2 to 9`);
  }
}

export function sanitizeSlotValue(value: unknown, slotName = "slot"): string {
  if (typeof value !== "string") {
    throw new SynthRequestError(`${slotName} must be a string`);
  }

  const sanitized = value
    .replace(/[^A-Za-z0-9\s.,!?"'():; -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) {
    throw new SynthRequestError(`${slotName} is empty after sanitization`);
  }
  if (sanitized.length > MAX_SLOT_CHARACTERS) {
    throw new SynthRequestError(`${slotName} is too long`);
  }

  const words = sanitized.match(WORD_PATTERN) ?? [];
  if (words.length > MAX_SLOT_WORDS) {
    throw new SynthRequestError(`${slotName} exceeds six words`);
  }

  if (PROFANITY_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    throw new SynthRequestError(`${slotName} contains blocked language`);
  }

  return sanitized;
}

export class SynthRequestError extends Error {}
