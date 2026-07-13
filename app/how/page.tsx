import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works - Pitch Gauntlet",
  description:
    "How the AI VC panel hears you, interrupts you, and scores you.",
};

const DOCS_URL =
  "https://docs.speko.dev?utm_source=pitch-gauntlet&utm_medium=viral&utm_campaign=viral-3x";

export default function HowPage() {
  return (
    <main className="stage-vignette min-h-[80vh]">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-interrupt-bright">
          Behind the curtain
        </p>
        <h1
          className="mt-1 font-display uppercase text-parchment"
          style={{ fontSize: "clamp(2.2rem, 6vw, 3.5rem)" }}
        >
          How it works
        </h1>

        <div className="mt-8 space-y-8 leading-relaxed text-parchment-dim">
          <section>
            <h2 className="font-display text-lg uppercase text-parchment">
              The panel hears you
            </h2>
            <p className="mt-2">
              While you pitch, your microphone audio is cut into 3 second
              segments and each one is transcribed live through Speko&apos;s
              speech-to-text API (/v1/transcribe). Segments are processed and
              discarded. Nothing is recorded, nothing is stored.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg uppercase text-parchment">
              The interruptions
            </h2>
            <p className="mt-2">
              The triggers are plain heuristics running on your live
              transcript: filler bursts, thirty seconds without a number,
              monologuing, buzzwords, and silence. The panel only ever reacts
              to what you actually said. It knows nothing about you or your
              company, and the roast targets delivery only.
            </p>
            <p className="mt-2">
              Most interruption lines were synthesized ahead of time with
              Speko&apos;s /v1/synthesize voices. A couple per run are
              synthesized live from what you said, and the HUD shows the
              measured server time for those in milliseconds. That number is
              real, per request, not a marketing claim.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg uppercase text-parchment">
              The score
            </h2>
            <p className="mt-2">
              Survival time, interruptions, filler count, pace, and buzzwords
              feed a deterministic score. The percentile compares you against
              a seed distribution that recalibrates as more runs come in.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg uppercase text-parchment">
              The stack
            </h2>
            <p className="mt-2">
              Speech-to-text, the three voices, and the live synthesis all run
              on the{" "}
              <a
                className="text-spotlight underline underline-offset-4"
                href={DOCS_URL}
              >
                Speko API
              </a>
              . The barge-in speed you just experienced is the product.
            </p>
          </section>
        </div>

        <Link
          href="/play"
          className="mt-10 inline-block border-2 border-spotlight bg-spotlight px-6 py-3 font-display uppercase tracking-wider text-stage"
        >
          Face the panel
        </Link>
      </div>
    </main>
  );
}
