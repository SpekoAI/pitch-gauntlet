"use client";

import { PERSONAS, type ManifestPersona } from "@/lib/manifest";
import type { PersonaId } from "@/lib/trigger-engine";

interface PersonaCardsProps {
  activeId: PersonaId | null;
  interrupting: boolean;
  compact?: boolean;
}

function PersonaCard({
  persona,
  active,
  interrupting,
  compact,
}: {
  persona: ManifestPersona;
  active: boolean;
  interrupting: boolean;
  compact: boolean;
}) {
  return (
    <div
      className={[
        "border px-4 transition-all duration-300 ease-out-quint",
        compact ? "py-2" : "py-4",
        active
          ? interrupting
            ? "interrupt-pulse border-interrupt-bright bg-card"
            : "border-spotlight bg-card"
          : "border-rulec bg-transparent opacity-70",
      ].join(" ")}
    >
      <p
        className={[
          "font-display uppercase tracking-wide",
          compact ? "text-sm" : "text-lg sm:text-xl",
          active
            ? interrupting
              ? "text-interrupt-bright"
              : "text-spotlight"
            : "text-parchment",
        ].join(" ")}
      >
        {persona.name}
      </p>
      {!compact && (
        <p className="mt-1 text-xs text-parchment-dim">{persona.casting}</p>
      )}
    </div>
  );
}

export default function PersonaCards({
  activeId,
  interrupting,
  compact = false,
}: PersonaCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {PERSONAS.map((persona) => (
        <PersonaCard
          key={persona.id}
          persona={persona}
          active={activeId === persona.id}
          interrupting={interrupting && activeId === persona.id}
          compact={compact}
        />
      ))}
    </div>
  );
}
