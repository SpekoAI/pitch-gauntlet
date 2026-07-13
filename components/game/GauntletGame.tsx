"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import CaptionBar from "@/components/CaptionBar";
import PersonaCards from "@/components/PersonaCards";
import WaveRing from "@/components/WaveRing";
import {
  bestComeback,
  countWords,
  findRepeatedWord,
  formatMs,
} from "@/lib/game-utils";
import {
  pickLine,
  pickOpener,
  personaById,
  slotTemplateFor,
  wavPath,
} from "@/lib/manifest";
import { calculateScore, type ScoreResult } from "@/lib/scoring";
import {
  startSegmentRecorder,
  type SegmentRecorder,
} from "@/lib/segment-recorder";
import {
  createTriggerEngineState,
  processTriggerEvent,
  type PersonaId,
  type TriggerEngineState,
} from "@/lib/trigger-engine";

const RUN_CAP_MS = 90_000;
const SEGMENT_MS = 3_000;
const TICK_MS = 1_000;
const SILENCE_RMS = 0.02;
const MAX_SLOT_SYNTHS = 2;

type Phase =
  | "rules"
  | "requesting"
  | "countdown"
  | "running"
  | "scoring"
  | "result"
  | "denied"
  | "capped"
  | "unsupported";

interface Caption {
  speaker: string | null;
  text: string;
  tone: "panel" | "founder";
}

interface SynthHud {
  serverMs: number;
  firstByteMs: number | null;
}

interface RunOutcome {
  survivalMs: number;
  score: ScoreResult;
  interruptions: number;
  fillerCount: number;
  buzzwordCount: number;
  wpm: number;
  comeback: string | null;
  roast: string | null;
  endedBy: "finish" | "time" | "panel";
}

interface PublishState {
  status: "idle" | "saving" | "done" | "error";
  id: string | null;
}

function sumCounts(counts: readonly number[]): number {
  return counts.reduce((total, value) => total + value, 0);
}

export default function GauntletGame() {
  const [phase, setPhase] = useState<Phase>("rules");
  const [countdown, setCountdown] = useState(3);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [caption, setCaption] = useState<Caption>({
    speaker: null,
    text: "",
    tone: "founder",
  });
  const [activePersona, setActivePersona] = useState<PersonaId | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [synthHud, setSynthHud] = useState<SynthHud | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [publish, setPublish] = useState<PublishState>({
    status: "idle",
    id: null,
  });
  const [displayName, setDisplayName] = useState("");
  const [isS26, setIsS26] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<SegmentRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<TriggerEngineState>(createTriggerEngineState());
  const startTsRef = useRef(0);
  const lastElapsedRef = useRef(0);
  const lastLoudRef = useRef(0);
  const runningRef = useRef(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usedLinesRef = useRef(new Set<string>());
  const slotSynthsRef = useRef(0);
  const snapshotsRef = useRef<string[]>([]);
  const snapshotTimesRef = useRef<number[]>([]);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const endingRef = useRef(false);

  const cleanup = useCallback(() => {
    runningRef.current = false;
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (silenceLoopRef.current) {
      clearInterval(silenceLoopRef.current);
      silenceLoopRef.current = null;
    }
    playbackRef.current?.pause();
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setAnalyser(null);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const currentElapsed = useCallback(() => {
    const raw = performance.now() - startTsRef.current;
    const clamped = Math.max(raw, lastElapsedRef.current);
    lastElapsedRef.current = clamped;
    return Math.round(clamped);
  }, []);

  const currentSilence = useCallback(() => {
    return Math.max(0, performance.now() - lastLoudRef.current);
  }, []);

  const playPanelLine = useCallback(
    (personaId: PersonaId, text: string, src: string | Blob) => {
      setActivePersona(personaId);
      setInterrupting(true);
      setCaption({ speaker: personaById(personaId).name, text, tone: "panel" });
      playbackRef.current?.pause();
      const url = typeof src === "string" ? src : URL.createObjectURL(src);
      const audio = new Audio(url);
      playbackRef.current = audio;
      audio.onended = () => {
        setInterrupting(false);
        if (typeof src !== "string") {
          URL.revokeObjectURL(url);
        }
      };
      void audio.play().catch(() => setInterrupting(false));
    },
    [],
  );

  const fireSlotSynth = useCallback(
    async (personaId: PersonaId): Promise<boolean> => {
      if (slotSynthsRef.current >= MAX_SLOT_SYNTHS) {
        return false;
      }
      const repeated = findRepeatedWord(engineRef.current.transcript);
      const template = slotTemplateFor(personaId);
      if (!repeated || !template) {
        return false;
      }
      const slots: Record<string, string> = {};
      for (const key of Object.keys(template.slots)) {
        if (key === "word") {
          slots[key] = repeated.word;
        } else if (key === "count") {
          slots[key] = String(Math.min(9, Math.max(2, repeated.count)));
        } else {
          return false;
        }
      }
      slotSynthsRef.current += 1;
      const started = performance.now();
      try {
        const response = await fetch("/api/synth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateId: template.templateId, slots }),
        });
        if (!response.ok) {
          return false;
        }
        const serverMs = Math.round(performance.now() - started);
        const firstByteHeader = response.headers.get("x-speko-first-byte-ms");
        const blob = await response.blob();
        if (!runningRef.current) {
          return false;
        }
        let text = template.template;
        for (const [key, value] of Object.entries(slots)) {
          text = text.split(`{${key}}`).join(value);
        }
        setSynthHud({
          serverMs,
          firstByteMs: firstByteHeader ? Number(firstByteHeader) : null,
        });
        playPanelLine(personaId, text, blob);
        return true;
      } catch {
        return false;
      }
    },
    [playPanelLine],
  );

  const endRun = useCallback(
    async (endedBy: RunOutcome["endedBy"]) => {
      if (endingRef.current) {
        return;
      }
      endingRef.current = true;
      const survivalMs = Math.min(currentElapsed(), RUN_CAP_MS);
      const engine = engineRef.current;
      cleanup();
      setPhase("scoring");

      const fillerCount = sumCounts(engine.fillerMatchCounts);
      const buzzwordCount = sumCounts(engine.buzzwordMatchCounts);
      const words = countWords(engine.transcript);
      const minutes = Math.max(survivalMs / 60_000, 1 / 60);
      const wpm = Math.round(words / minutes);
      const score = calculateScore({
        survivalTimeSeconds: survivalMs / 1000,
        interruptionsTriggered: engine.interruptionCount,
        fillerCount,
        wpm,
        buzzwordCount,
      });
      const comeback = bestComeback(
        snapshotsRef.current,
        snapshotTimesRef.current,
        engine.transcript,
        survivalMs,
      );

      let roast: string | null = null;
      try {
        const personaId = activePersona ?? "skeptic";
        const response = await fetch("/api/roast", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            personaId,
            stats: { wpm, fillerCount, buzzwordCount },
          }),
        });
        if (response.ok) {
          const data = (await response.json()) as { line?: string };
          roast = data.line ?? null;
        }
      } catch {
        roast = null;
      }

      setOutcome({
        survivalMs,
        score,
        interruptions: engine.interruptionCount,
        fillerCount,
        buzzwordCount,
        wpm,
        comeback: comeback?.text ?? null,
        roast,
        endedBy,
      });
      setPhase("result");
    },
    [activePersona, cleanup, currentElapsed],
  );

  const dispatchEngineEvent = useCallback(
    async (transcriptDelta: string) => {
      if (!runningRef.current) {
        return;
      }
      const event = {
        transcriptDelta,
        elapsedMs: currentElapsed(),
        silenceMs: currentSilence(),
      };
      const { state, decision } = processTriggerEvent(
        engineRef.current,
        event,
      );
      engineRef.current = state;
      if (!decision) {
        return;
      }
      setInterruptionCount(decision.interruptionNumber);
      snapshotsRef.current.push(state.transcript);
      snapshotTimesRef.current.push(decision.elapsedMs);

      const wantsSlot =
        (decision.trigger === "buzzword" ||
          decision.trigger === "continuous_monologue") &&
        slotSynthsRef.current < MAX_SLOT_SYNTHS;
      let played = false;
      if (wantsSlot) {
        played = await fireSlotSynth(decision.personaId);
      }
      if (!played) {
        const line = pickLine(
          decision.personaId,
          decision.trigger,
          usedLinesRef.current,
        );
        usedLinesRef.current.add(line.lineId);
        playPanelLine(decision.personaId, line.text, wavPath(line));
      }
      if (decision.interruptionNumber >= 6) {
        setTimeout(() => void endRun("panel"), 2_200);
      }
    },
    [currentElapsed, currentSilence, endRun, fireSlotSynth, playPanelLine],
  );

  const beginRun = useCallback(
    (stream: MediaStream) => {
      engineRef.current = createTriggerEngineState();
      usedLinesRef.current = new Set();
      slotSynthsRef.current = 0;
      snapshotsRef.current = [];
      snapshotTimesRef.current = [];
      lastElapsedRef.current = 0;
      endingRef.current = false;
      setInterruptionCount(0);
      setSynthHud(null);
      setOutcome(null);
      setPublish({ status: "idle", id: null });

      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      source.connect(node);
      setAnalyser(node);

      startTsRef.current = performance.now();
      lastLoudRef.current = performance.now();
      runningRef.current = true;

      const timeData = new Uint8Array(node.fftSize);
      silenceLoopRef.current = setInterval(() => {
        node.getByteTimeDomainData(timeData);
        let sum = 0;
        for (const sample of timeData) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / timeData.length);
        if (rms > SILENCE_RMS) {
          lastLoudRef.current = performance.now();
        }
      }, 120);

      recorderRef.current = startSegmentRecorder(stream, {
        segmentMs: SEGMENT_MS,
        onSegment: (blob) => {
          void (async () => {
            if (!runningRef.current) {
              return;
            }
            try {
              const response = await fetch("/api/stt-chunk", {
                method: "POST",
                headers: { "content-type": blob.type || "audio/webm" },
                body: blob,
              });
              if (!response.ok) {
                return;
              }
              const data = (await response.json()) as { text?: string };
              const text = (data.text ?? "").trim();
              if (text.length > 0) {
                setCaption({ speaker: "You", text, tone: "founder" });
              }
              await dispatchEngineEvent(text);
            } catch {
              // a dropped chunk is not fatal to the run
            }
          })();
        },
      });

      tickerRef.current = setInterval(() => {
        if (!runningRef.current) {
          return;
        }
        const elapsed = currentElapsed();
        setElapsedMs(elapsed);
        if (elapsed >= RUN_CAP_MS) {
          void endRun("time");
          return;
        }
        void dispatchEngineEvent("");
      }, TICK_MS);

      const opener = pickOpener();
      playPanelLine(opener.personaId, opener.text, wavPath(opener));
      setPhase("running");
    },
    [currentElapsed, dispatchEngineEvent, endRun, playPanelLine],
  );

  const startGame = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPhase("unsupported");
      return;
    }
    setPhase("requesting");
    try {
      const capResponse = await fetch("/api/run-start", { method: "POST" });
      if (capResponse.status === 429) {
        setPhase("capped");
        return;
      }
    } catch {
      // fail open; the cap is a cost guard, not a gate on play
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      setPhase("countdown");
      setCountdown(3);
      let remaining = 3;
      const interval = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
          beginRun(stream);
        }
      }, 900);
    } catch {
      setPhase("denied");
    }
  }, [beginRun]);

  const publishRun = useCallback(async () => {
    if (!outcome || publish.status === "saving") {
      return;
    }
    setPublish({ status: "saving", id: null });
    try {
      const response = await fetch("/api/publish-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          s26: isS26,
          survivalMs: outcome.survivalMs,
          percentile: outcome.score.percentile,
          interruptions: outcome.interruptions,
          bestComeback: outcome.comeback,
        }),
      });
      if (!response.ok) {
        setPublish({ status: "error", id: null });
        return;
      }
      const data = (await response.json()) as { id: string };
      try {
        const mine = JSON.parse(
          localStorage.getItem("gauntlet-runs") ?? "[]",
        ) as string[];
        localStorage.setItem(
          "gauntlet-runs",
          JSON.stringify([...mine, data.id]),
        );
      } catch {
        // localStorage is a convenience, not a requirement
      }
      setPublish({ status: "done", id: data.id });
    } catch {
      setPublish({ status: "error", id: null });
    }
  }, [displayName, isS26, outcome, publish.status]);

  const deleteRun = useCallback(async () => {
    if (!publish.id) {
      return;
    }
    await fetch("/api/delete-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: publish.id }),
    }).catch(() => undefined);
    setPublish({ status: "idle", id: null });
  }, [publish.id]);

  // ---- render ----

  if (phase === "rules" || phase === "requesting") {
    return (
      <StageShell>
        <div className="mx-auto max-w-lg border border-rulec bg-card p-8 text-center">
          <h1 className="font-display text-3xl uppercase text-parchment">
            The rules
          </h1>
          <p className="mt-4 text-parchment-dim">
            Up to 90 seconds. They interrupt. Survive.
          </p>
          <p className="mt-2 text-sm text-parchment-dim">
            Say numbers early. Avoid buzzwords. Do not ramble.
          </p>
          <button
            type="button"
            disabled={phase === "requesting"}
            onClick={() => void startGame()}
            className="mt-8 border-2 border-spotlight bg-spotlight px-8 py-3 font-display text-lg uppercase tracking-wider text-stage transition-transform duration-200 ease-out-quint hover:scale-[1.02] disabled:opacity-60"
          >
            {phase === "requesting" ? "Checking the room..." : "I am ready"}
          </button>
          <p className="mt-4 text-xs leading-relaxed text-parchment-dim">
            Ephemeral processing. Audio chunks are transcribed then discarded.
            Nothing is stored unless you publish your result.
          </p>
        </div>
      </StageShell>
    );
  }

  if (phase === "denied" || phase === "unsupported") {
    return (
      <StageShell>
        <div className="mx-auto max-w-lg border border-rulec bg-card p-8 text-center">
          <h1 className="font-display text-2xl uppercase text-parchment">
            {phase === "denied" ? "No mic, no pitch" : "This browser cannot pitch"}
          </h1>
          <p className="mt-4 text-parchment-dim">
            {phase === "denied"
              ? "The panel needs to hear you. Allow microphone access and try again."
              : "In-app browsers usually block the microphone. Open gauntlet.speko.dev in Safari or Chrome to play."}
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <button
              type="button"
              onClick={() => setPhase("rules")}
              className="border border-spotlight px-5 py-2 text-sm uppercase tracking-wider text-spotlight"
            >
              Try again
            </button>
            <Link
              href="/"
              className="border border-rulec px-5 py-2 text-sm uppercase tracking-wider text-parchment-dim hover:text-parchment"
            >
              Watch replays instead
            </Link>
          </div>
        </div>
      </StageShell>
    );
  }

  if (phase === "capped") {
    return (
      <StageShell>
        <div className="mx-auto max-w-lg border border-interrupt bg-card p-8 text-center">
          <h1 className="font-display text-2xl uppercase text-interrupt-bright">
            The panel is resting
          </h1>
          <p className="mt-4 text-parchment-dim">
            Today's session budget is spent. Watch the carnage instead, or come
            back tomorrow.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block border border-spotlight px-6 py-2 text-sm uppercase tracking-wider text-spotlight"
          >
            Watch the carnage
          </Link>
        </div>
      </StageShell>
    );
  }

  if (phase === "countdown") {
    return (
      <StageShell>
        <div className="flex h-[50vh] items-center justify-center">
          <p className="font-display text-9xl text-spotlight tabular">
            {countdown > 0 ? countdown : "GO"}
          </p>
        </div>
      </StageShell>
    );
  }

  if (phase === "scoring") {
    return (
      <StageShell>
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4">
          <p className="font-display text-3xl uppercase text-parchment">
            The panel is deliberating
          </p>
          <p className="text-parchment-dim">Scoring your delivery...</p>
        </div>
      </StageShell>
    );
  }

  if (phase === "result" && outcome) {
    const shareText = `I survived ${formatMs(outcome.survivalMs)} against the AI VC panel (top ${100 - outcome.score.percentile <= 50 ? `${100 - outcome.score.percentile}%` : `${outcome.score.percentile}th percentile`}). Think you can do better?`;
    const shareUrl = publish.id
      ? `https://gauntlet.speko.dev/result/${publish.id}`
      : "https://gauntlet.speko.dev";
    return (
      <StageShell>
        <div className="mx-auto max-w-2xl px-2">
          <div className="border-4 border-parchment bg-card p-8 text-center">
            <p className="font-display text-sm uppercase tracking-[0.3em] text-interrupt-bright">
              Verdict
            </p>
            <h1
              className="mt-2 font-display uppercase leading-none text-parchment"
              style={{ fontSize: "clamp(3rem, 10vw, 6rem)" }}
            >
              Survived {formatMs(outcome.survivalMs)}
            </h1>
            <p className="mt-3 text-lg text-spotlight">
              Better than {outcome.score.percentile}% of pitches on this stage
            </p>
            <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-px border border-rulec bg-rulec text-center">
              <Stat label="Interruptions" value={String(outcome.interruptions)} />
              <Stat label="Fillers" value={String(outcome.fillerCount)} />
              <Stat label="WPM" value={String(outcome.wpm)} />
            </div>
            {outcome.comeback && (
              <div className="mt-6 border-l-2 border-spotlight pl-4 text-left">
                <p className="text-xs uppercase tracking-widest text-parchment-dim">
                  Best comeback
                </p>
                <p className="mt-1 text-parchment">
                  &quot;{outcome.comeback}&quot;
                </p>
              </div>
            )}
            {outcome.roast && (
              <p className="mt-6 text-sm italic text-parchment-dim">
                Panel note: {outcome.roast}
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noreferrer"
              className="border-2 border-spotlight bg-spotlight px-6 py-2 font-display uppercase tracking-wider text-stage"
            >
              Share on X
            </a>
            <button
              type="button"
              onClick={() => {
                cleanup();
                endingRef.current = false;
                setPhase("rules");
              }}
              className="border border-rulec px-6 py-2 uppercase tracking-wider text-parchment-dim hover:text-parchment"
            >
              Run it back
            </button>
          </div>

          <div className="mt-8 border border-rulec bg-stage-deep p-5">
            {publish.status === "done" && publish.id ? (
              <div className="text-center text-sm">
                <p className="text-parchment">
                  On the board.{" "}
                  <Link
                    className="text-spotlight underline underline-offset-4"
                    href={`/result/${publish.id}`}
                  >
                    Your poster
                  </Link>{" "}
                  |{" "}
                  <Link
                    className="text-spotlight underline underline-offset-4"
                    href="/board"
                  >
                    The board
                  </Link>
                </p>
                <button
                  type="button"
                  onClick={() => void deleteRun()}
                  className="mt-2 text-xs text-parchment-dim underline underline-offset-4 hover:text-interrupt-bright"
                >
                  Delete my run
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={40}
                  placeholder="Name or handle"
                  className="w-full border border-rulec bg-stage px-3 py-2 text-parchment placeholder:text-parchment-dim focus:border-spotlight focus:outline-none sm:w-56"
                />
                <label className="flex items-center gap-2 text-xs text-parchment-dim">
                  <input
                    type="checkbox"
                    checked={isS26}
                    onChange={(event) => setIsS26(event.target.checked)}
                    className="accent-[var(--spotlight)]"
                  />
                  Current YC batch
                </label>
                <button
                  type="button"
                  disabled={publish.status === "saving" || !displayName.trim()}
                  onClick={() => void publishRun()}
                  className="border border-spotlight px-5 py-2 text-sm uppercase tracking-wider text-spotlight disabled:opacity-50"
                >
                  {publish.status === "saving" ? "Saving..." : "Post to the board"}
                </button>
              </div>
            )}
            {publish.status === "error" && (
              <p className="mt-2 text-center text-xs text-interrupt-bright">
                Could not save the run. Try again.
              </p>
            )}
            <p className="mt-3 text-center text-xs text-parchment-dim">
              Publishing stores only your name and the numbers above. Never audio.
            </p>
          </div>
        </div>
      </StageShell>
    );
  }

  // running
  return (
    <StageShell>
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between px-1 pb-3 text-sm text-parchment-dim">
          <p className="tabular">
            <span className="font-display text-2xl text-spotlight">
              {formatMs(elapsedMs)}
            </span>{" "}
            / 1:30
          </p>
          <div className="flex items-center gap-3">
            {synthHud && (
              <span className="border border-rulec px-2 py-1 text-xs">
                live synthesis: {synthHud.serverMs}ms server
                {synthHud.firstByteMs !== null &&
                  ` (first byte ${synthHud.firstByteMs}ms)`}
              </span>
            )}
            <span className="tabular">
              {interruptionCount}/6 interruptions
            </span>
          </div>
        </div>
        <PersonaCards activeId={activePersona} interrupting={interrupting} />
        <div className="py-4">
          <WaveRing analyser={analyser} active size={220} />
        </div>
        <CaptionBar
          speaker={caption.speaker}
          text={caption.text}
          tone={caption.tone}
        />
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => void endRun("finish")}
            className="border border-rulec px-8 py-3 uppercase tracking-widest text-parchment-dim transition-colors hover:border-interrupt hover:text-interrupt-bright"
          >
            I rest my case
          </button>
        </div>
      </div>
    </StageShell>
  );
}

function StageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="stage-vignette min-h-[80vh] px-4 py-10 sm:px-6 sm:py-14">
      {children}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-2 py-3">
      <p className="font-display text-2xl text-parchment tabular">{value}</p>
      <p className="mt-1 text-[0.65rem] uppercase tracking-widest text-parchment-dim">
        {label}
      </p>
    </div>
  );
}
