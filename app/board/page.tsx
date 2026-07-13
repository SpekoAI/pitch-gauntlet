import type { Metadata } from "next";
import Link from "next/link";
import { db, dbConfigured } from "@/lib/db";
import { formatMs } from "@/lib/game-utils";

export const metadata: Metadata = {
  title: "The board - Pitch Gauntlet",
  description: "Who survived the AI VC panel the longest.",
};

export const revalidate = 60;

interface RunRow {
  id: string;
  display_name: string;
  s26: boolean;
  survival_ms: number;
  percentile: number | null;
  interruptions: number;
  best_comeback: string | null;
  created_at: string;
}

async function loadRuns(s26Only: boolean): Promise<RunRow[]> {
  if (!dbConfigured()) {
    return [];
  }
  try {
    const sql = db();
    if (s26Only) {
      return await sql<RunRow[]>`
        SELECT id, display_name, s26, survival_ms, percentile, interruptions, best_comeback, created_at
        FROM gauntlet.runs
        WHERE published AND s26
        ORDER BY survival_ms DESC, percentile DESC NULLS LAST
        LIMIT 100
      `;
    }
    return await sql<RunRow[]>`
      SELECT id, display_name, s26, survival_ms, percentile, interruptions, best_comeback, created_at
      FROM gauntlet.runs
      WHERE published
      ORDER BY survival_ms DESC, percentile DESC NULLS LAST
      LIMIT 100
    `;
  } catch {
    return [];
  }
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const s26Only = params.tab === "s26";
  const runs = await loadRuns(s26Only);

  return (
    <main className="stage-vignette min-h-[80vh]">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-interrupt-bright">
          The board
        </p>
        <h1
          className="mt-1 font-display uppercase text-parchment"
          style={{ fontSize: "clamp(2.2rem, 6vw, 4rem)" }}
        >
          Longest survivors
        </h1>

        <div className="mt-6 flex gap-2">
          <Tab href="/board" active={!s26Only}>
            Everyone
          </Tab>
          <Tab href="/board?tab=s26" active={s26Only}>
            Current YC batch
          </Tab>
        </div>

        {runs.length === 0 ? (
          <div className="mt-10 border border-rulec bg-card p-10 text-center">
            <p className="font-display text-xl uppercase text-parchment">
              Nobody has survived yet
            </p>
            <p className="mt-2 text-sm text-parchment-dim">
              The board fills with people who dared. Be the first name on it.
            </p>
            <Link
              href="/play"
              className="mt-6 inline-block border-2 border-spotlight bg-spotlight px-6 py-2 font-display uppercase tracking-wider text-stage"
            >
              Take the Gauntlet
            </Link>
          </div>
        ) : (
          <table className="mt-8 w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-rulec text-xs uppercase tracking-widest text-parchment-dim">
                <th className="py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Name</th>
                <th className="py-2 pr-3 text-right font-normal">Survived</th>
                <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">
                  Interruptions
                </th>
                <th className="hidden py-2 text-right font-normal sm:table-cell">
                  Percentile
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, index) => (
                <tr
                  key={run.id}
                  className="border-b border-rulec transition-colors hover:bg-card"
                >
                  <td className="py-3 pr-3 font-display text-xl text-spotlight tabular">
                    {index + 1}
                  </td>
                  <td className="py-3 pr-3">
                    <Link
                      href={`/result/${run.id}`}
                      className="text-parchment underline-offset-4 hover:underline"
                    >
                      {run.display_name}
                    </Link>
                    {run.s26 && (
                      <span className="ml-2 border border-spotlight px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest text-spotlight">
                        YC
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right font-display text-lg text-parchment tabular">
                    {formatMs(run.survival_ms)}
                  </td>
                  <td className="hidden py-3 pr-3 text-right text-parchment-dim tabular sm:table-cell">
                    {run.interruptions}
                  </td>
                  <td className="hidden py-3 text-right text-parchment-dim tabular sm:table-cell">
                    {run.percentile !== null ? `${Math.round(run.percentile)}` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={[
        "border px-4 py-1.5 text-sm uppercase tracking-wider transition-colors",
        active
          ? "border-spotlight text-spotlight"
          : "border-rulec text-parchment-dim hover:text-parchment",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}
