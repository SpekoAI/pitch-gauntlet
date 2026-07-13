import { db, dbConfigured } from "@/lib/db";

const EST_USD_PER_RUN = 0.05;

export interface RunBudget {
  allowed: boolean;
  runsToday: number;
  cap: number;
}

export function dailyRunsCap(): number {
  const raw = Number(process.env.DAILY_RUNS_CAP ?? "500");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500;
}

/**
 * Increments today's run counter and reports whether the game may start.
 * Fails OPEN (allowed, counted as zero) when the database is unreachable so
 * a database blip never bricks the game; the daily cap is a cost guard, not
 * a security boundary. The failure is logged for follow-up.
 */
export async function consumeRunBudget(): Promise<RunBudget> {
  const cap = dailyRunsCap();
  if (!dbConfigured()) {
    console.warn("spend: DATABASE_URL missing; run cap not enforced");
    return { allowed: true, runsToday: 0, cap };
  }
  try {
    const sql = db();
    const rows = await sql<{ runs: number }[]>`
      INSERT INTO gauntlet.daily_spend (day, runs, est_usd)
      VALUES (CURRENT_DATE, 1, ${EST_USD_PER_RUN})
      ON CONFLICT (day)
      DO UPDATE SET
        runs = gauntlet.daily_spend.runs + 1,
        est_usd = gauntlet.daily_spend.est_usd + ${EST_USD_PER_RUN}
      RETURNING runs
    `;
    const runsToday = rows[0]?.runs ?? 0;
    return { allowed: runsToday <= cap, runsToday, cap };
  } catch (error) {
    console.warn("spend: run cap check failed", error);
    return { allowed: true, runsToday: 0, cap };
  }
}
