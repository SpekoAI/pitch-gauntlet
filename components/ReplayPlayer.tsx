"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CaptionBar from "@/components/CaptionBar";
import PersonaCards from "@/components/PersonaCards";
import WaveRing from "@/components/WaveRing";
import { LINES, personaById, wavPath } from "@/lib/manifest";
import type { PersonaId } from "@/lib/trigger-engine";

export interface ReplayEvent {
  tMs: number;
  type: "pitch_caption" | "interruption";
  text?: string;
  personaId?: PersonaId;
  lineId?: string;
}

export interface Replay {
  id: string;
  title: string;
  subtitle: string;
  durationMs: number;
  timeline: ReplayEvent[];
}

interface Caption {
  speaker: string | null;
  text: string;
  tone: "panel" | "founder";
}

function lineText(lineId: string | undefined): string {
  if (!lineId) {
    return "";
  }
  return LINES.find((line) => line.lineId === lineId)?.text ?? "";
}

/**
 * Plays a scripted replay: captions type in, interjections light the persona
 * card, and (only after the user enables sound) the real prebaked wavs play.
 * Autoplay is visual-only per browser policy - and honesty: nothing pretends
 * to be a human voice, founder lines are captions labeled as a replay.
 */
export default function ReplayPlayer({ replay }: { replay: Replay }) {
  const [caption, setCaption] = useState<Caption>({
    speaker: null,
    text: "",
    tone: "founder",
  });
  const [activePersona, setActivePersona] = useState<PersonaId | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const events = useMemo(
    () => [...replay.timeline].sort((a, b) => a.tMs - b.tMs),
    [replay],
  );

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    let cancelled = false;

    function schedule() {
      for (const event of events) {
        timers.current.push(
          setTimeout(() => {
            if (cancelled) {
              return;
            }
            if (event.type === "pitch_caption") {
              setActivePersona(null);
              setInterrupting(false);
              setCaption({
                speaker: "The founder",
                text: event.text ?? "",
                tone: "founder",
              });
            } else if (event.personaId) {
              setActivePersona(event.personaId);
              setInterrupting(true);
              setCaption({
                speaker: personaById(event.personaId).name,
                text: lineText(event.lineId),
                tone: "panel",
              });
              if (soundOnRef.current && event.lineId) {
                const line = LINES.find(
                  (candidate) => candidate.lineId === event.lineId,
                );
                if (line) {
                  audioRef.current?.pause();
                  const audio = new Audio(wavPath(line));
                  audioRef.current = audio;
                  void audio.play().catch(() => undefined);
                }
              }
              timers.current.push(
                setTimeout(() => {
                  if (!cancelled) {
                    setInterrupting(false);
                  }
                }, 900),
              );
            }
          }, event.tMs),
        );
      }
      timers.current.push(
        setTimeout(() => {
          if (!cancelled) {
            clearAll();
            schedule();
          }
        }, replay.durationMs),
      );
    }

    function clearAll() {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
      timers.current = [];
    }

    schedule();
    return () => {
      cancelled = true;
      clearAll();
      audioRef.current?.pause();
    };
  }, [events, replay.durationMs]);

  return (
    <div className="border border-rulec bg-stage-deep/60">
      <div className="flex items-center justify-between border-b border-rulec px-4 py-2">
        <div>
          <p className="font-display text-sm uppercase tracking-wide text-parchment">
            {replay.title}
          </p>
          <p className="text-xs text-parchment-dim">{replay.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setSoundOn((value) => !value)}
          className={[
            "border px-3 py-1 text-xs uppercase tracking-wider transition-colors",
            soundOn
              ? "border-spotlight text-spotlight"
              : "border-rulec text-parchment-dim hover:text-parchment",
          ].join(" ")}
        >
          {soundOn ? "Sound on" : "Sound off"}
        </button>
      </div>
      <div className="px-4 pt-3">
        <PersonaCards activeId={activePersona} interrupting={interrupting} compact />
      </div>
      <div className="py-2">
        <WaveRing analyser={null} active size={130} />
      </div>
      <CaptionBar speaker={caption.speaker} text={caption.text} tone={caption.tone} />
    </div>
  );
}
