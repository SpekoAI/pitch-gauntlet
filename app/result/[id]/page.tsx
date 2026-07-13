import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, dbConfigured } from "@/lib/db";
import { formatMs } from "@/lib/game-utils";

export const revalidate = 300;

interface RunRow {
  id: string;
  display_name: string;
  s26: boolean;
  survival_ms: number;
  percentile: number | null;
  interruptions: number;
  best_comeback: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadRun(id: string): Promise<RunRow | null> {
  if (!UUID_PATTERN.test(id) || !dbConfigured()) {
    return null;
  }
  try {
    const sql = db();
    const rows = await sql<RunRow[]>`
      SELECT id, display_name, s26, survival_ms, percentile, interruptions, best_comeback
      FROM gauntlet.runs
      WHERE id = ${id} AND published
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const run = await loadRun(id);
  if (!run) {
    return { title: "Run not found - Pitch Gauntlet" };
  }
  const title = `${run.display_name} survived ${formatMs(run.survival_ms)} - Pitch Gauntlet`;
  return {
    title,
    openGraph: {
      title,
      images: [`/result/${run.id}/og`],
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await loadRun(id);
  if (!run) {
    notFound();
  }

  const shareText = `${run.display_name} survived ${formatMs(run.survival_ms)} against the AI VC panel. Think you can do better?`;
  const shareUrl = `https://gauntlet.speko.dev/result/${run.id}`;

  return (
    <main className="stage-vignette min-h-[80vh]">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <div className="border-4 border-parchment bg-card p-8 text-center">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-interrupt-bright">
            Official result
          </p>
          <p className="mt-4 font-display text-xl uppercase text-parchment-dim">
            {run.display_name}
            {run.s26 && (
              <span className="ml-2 border border-spotlight px-1.5 py-0.5 align-middle text-[0.6rem] tracking-widest text-spotlight">
                YC
              </span>
            )}
          </p>
          <h1
            className="mt-1 font-display uppercase leading-none text-parchment"
            style={{ fontSize: "clamp(3rem, 10vw, 6rem)" }}
          >
            Survived {formatMs(run.survival_ms)}
          </h1>
          <div className="mt-5 flex justify-center gap-8 text-sm text-parchment-dim">
            <p>
              <span className="font-display text-xl text-parchment tabular">
                {run.interruptions}
              </span>{" "}
              interruptions
            </p>
            {run.percentile !== null && (
              <p>
                better than{" "}
                <span className="font-display text-xl text-spotlight tabular">
                  {Math.round(run.percentile)}%
                </span>{" "}
                of pitches
              </p>
            )}
          </div>
          {run.best_comeback && (
            <div className="mt-6 border-l-2 border-spotlight pl-4 text-left">
              <p className="text-xs uppercase tracking-widest text-parchment-dim">
                Best comeback
              </p>
              <p className="mt-1 text-parchment">&quot;{run.best_comeback}&quot;</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noreferrer"
            className="border-2 border-spotlight bg-spotlight px-6 py-2 font-display uppercase tracking-wider text-stage"
          >
            Share on X
          </a>
          <Link
            href="/play"
            className="border border-rulec px-6 py-2 uppercase tracking-wider text-parchment-dim hover:text-parchment"
          >
            Beat this run
          </Link>
          <Link
            href="/board"
            className="border border-rulec px-6 py-2 uppercase tracking-wider text-parchment-dim hover:text-parchment"
          >
            The board
          </Link>
        </div>
      </div>
    </main>
  );
}
