import { ImageResponse } from "next/og";
import { db, dbConfigured } from "@/lib/db";
import { formatMs } from "@/lib/game-utils";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAGE = "#221f1a";
const STAGE_DEEP = "#1a1815";
const PARCHMENT = "#e9e2d4";
const PARCHMENT_DIM = "#a49c8c";
const SPOTLIGHT = "#d9b36a";
const INTERRUPT = "#c25137";

interface RunRow {
  display_name: string;
  survival_ms: number;
  percentile: number | null;
  interruptions: number;
}

let antonFont: ArrayBuffer | null = null;

async function loadAnton(request: Request): Promise<ArrayBuffer | null> {
  if (antonFont) {
    return antonFont;
  }
  try {
    const url = new URL("/fonts/Anton-Regular.ttf", request.url);
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    antonFont = await response.arrayBuffer();
    return antonFont;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id) || !dbConfigured()) {
    return new Response("Not found", { status: 404 });
  }

  let run: RunRow | null = null;
  try {
    const sql = db();
    const rows = await sql<RunRow[]>`
      SELECT display_name, survival_ms, percentile, interruptions
      FROM gauntlet.runs
      WHERE id = ${id} AND published
      LIMIT 1
    `;
    run = rows[0] ?? null;
  } catch {
    run = null;
  }
  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  const font = await loadAnton(request);
  const display = font ? "Anton" : "sans-serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: STAGE,
          color: PARCHMENT,
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            border: `6px solid ${PARCHMENT}`,
            background: STAGE_DEEP,
            padding: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: display,
              fontSize: 26,
              letterSpacing: 10,
              textTransform: "uppercase",
              color: INTERRUPT,
            }}
          >
            Pitch Gauntlet
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: 30,
              color: PARCHMENT_DIM,
              textTransform: "uppercase",
              fontFamily: display,
              letterSpacing: 3,
            }}
          >
            {run.display_name}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: display,
              fontSize: 120,
              lineHeight: 1,
              marginTop: 10,
              textTransform: "uppercase",
            }}
          >
            Survived {formatMs(run.survival_ms)}
          </div>
          <div
            style={{
              display: "flex",
              gap: 48,
              marginTop: 28,
              fontSize: 28,
              color: PARCHMENT_DIM,
            }}
          >
            <div style={{ display: "flex" }}>
              {`${run.interruptions} interruptions`}
            </div>
            {run.percentile !== null && (
              <div style={{ display: "flex", color: SPOTLIGHT }}>
                {`better than ${Math.round(run.percentile)}% of pitches`}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 24,
            fontSize: 24,
            color: PARCHMENT_DIM,
          }}
        >
          <div style={{ display: "flex" }}>gauntlet.speko.dev</div>
          <div style={{ display: "flex" }}>voices by Speko</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: font
        ? [{ name: "Anton", data: font, style: "normal" as const, weight: 400 as const }]
        : undefined,
    },
  );
}
