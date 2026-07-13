import Link from "next/link";
import ReplayPlayer, { type Replay } from "@/components/ReplayPlayer";
import seedReplays from "@/data/seed-replays.json";

const replays = (seedReplays as { replays: Replay[] }).replays;

export default function HomePage() {
  return (
    <main className="stage-vignette">
      <section className="mx-auto max-w-5xl px-6 pb-10 pt-14 sm:pt-20">
        <p className="rise-in font-display text-sm uppercase tracking-[0.3em] text-interrupt-bright">
          Now seating
        </p>
        <h1
          className="rise-in mt-2 font-display uppercase leading-[0.92] text-parchment"
          style={{ fontSize: "clamp(3rem, 9vw, 7rem)", animationDelay: "60ms" }}
        >
          Pitch
          <br />
          Gauntlet
        </h1>
        <p
          className="rise-in mt-5 max-w-xl text-lg text-parchment-dim sm:text-xl"
          style={{ animationDelay: "120ms" }}
        >
          Pitch your startup. Three AI VCs will not be polite.
        </p>

        <div
          className="rise-in mt-8 flex flex-col items-start gap-3"
          style={{ animationDelay: "180ms" }}
        >
          <Link
            href="/play"
            className="border-2 border-spotlight bg-spotlight px-8 py-4 font-display text-xl uppercase tracking-wider text-stage transition-transform duration-200 ease-out-quint hover:scale-[1.02]"
          >
            Take the Gauntlet
          </Link>
          <p className="max-w-md text-xs leading-relaxed text-parchment-dim">
            Ephemeral processing. Audio chunks are transcribed then discarded.
            Nothing is stored unless you publish your result. No account.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-xl uppercase tracking-wide text-parchment">
            Watch the carnage
          </h2>
          <p className="text-xs text-parchment-dim">
            Scripted replays. The interruption voices are real.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {replays.map((replay) => (
            <ReplayPlayer key={replay.id} replay={replay} />
          ))}
        </div>
      </section>
    </main>
  );
}
