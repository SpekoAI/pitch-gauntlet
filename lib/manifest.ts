import manifestJson from "@/prebake/interjections-final.json";
import type { PersonaId, TriggerKind } from "@/lib/trigger-engine";

export interface ManifestPersona {
  id: PersonaId;
  name: string;
  casting: string;
  style: string;
}

export interface ManifestLine {
  personaId: PersonaId;
  lineId: string;
  text: string;
  tags: string[];
}

export interface ManifestSlotTemplate {
  personaId: PersonaId;
  templateId: string;
  template: string;
  slots: Record<string, string>;
}

interface Manifest {
  personas: ManifestPersona[];
  lines: ManifestLine[];
  slotTemplates: ManifestSlotTemplate[];
}

const manifest = manifestJson as unknown as Manifest;

export const PERSONAS: ManifestPersona[] = manifest.personas;
export const LINES: ManifestLine[] = manifest.lines;
export const SLOT_TEMPLATES: ManifestSlotTemplate[] = manifest.slotTemplates;

/** Trigger-engine kinds map to the tag vocabulary used in the manifest. */
export const TRIGGER_TAG: Record<TriggerKind, string> = {
  filler_burst: "filler",
  no_number_mentioned: "no-number",
  continuous_monologue: "monologue",
  buzzword: "buzzword",
  silence: "silence",
};

export function personaById(id: PersonaId): ManifestPersona {
  const persona = PERSONAS.find((candidate) => candidate.id === id);
  if (!persona) {
    throw new Error(`unknown persona: ${id}`);
  }
  return persona;
}

export function wavPath(line: ManifestLine): string {
  return `/prebaked/${line.personaId}/${line.lineId}.wav`;
}

/**
 * Picks a line for a persona matching the trigger tag, avoiding recently
 * used lineIds when possible. Falls back to any line for the persona.
 */
export function pickLine(
  personaId: PersonaId,
  trigger: TriggerKind,
  usedLineIds: ReadonlySet<string>,
  random: () => number = Math.random,
): ManifestLine {
  const tag = TRIGGER_TAG[trigger];
  const forPersona = LINES.filter(
    (line) => line.personaId === personaId && !line.tags.includes("opener"),
  );
  const tagged = forPersona.filter((line) => line.tags.includes(tag));
  const pool = tagged.length > 0 ? tagged : forPersona;
  const fresh = pool.filter((line) => !usedLineIds.has(line.lineId));
  const candidates = fresh.length > 0 ? fresh : pool;
  const index = Math.floor(random() * candidates.length);
  return candidates[Math.min(index, candidates.length - 1)] ?? pool[0]!;
}

export function pickOpener(random: () => number = Math.random): ManifestLine {
  const openers = LINES.filter((line) => line.tags.includes("opener"));
  const index = Math.floor(random() * openers.length);
  return openers[Math.min(index, openers.length - 1)] ?? LINES[0]!;
}

export function slotTemplateFor(
  personaId: PersonaId,
): ManifestSlotTemplate | undefined {
  return SLOT_TEMPLATES.find((template) => template.personaId === personaId);
}
