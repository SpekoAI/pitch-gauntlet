import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";
import { getClientIp, InMemoryTokenBucket } from "@/lib/ratelimit";

export const runtime = "nodejs";

const limiter = new InMemoryTokenBucket({
  capacity: 6,
  refillTokensPerSecond: 6 / 3_600,
});

const MAX_SURVIVAL_MS = 200_000;

function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeComeback(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const limit = await limiter.consume(`publish:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many posts" }, { status: 429 });
  }
  if (!dbConfigured()) {
    return NextResponse.json(
      { error: "The board is offline" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;

  const displayName = sanitizeName(input.displayName);
  if (!displayName) {
    return NextResponse.json(
      { error: "A display name is required" },
      { status: 400 },
    );
  }
  const survivalMs = Number(input.survivalMs);
  if (
    !Number.isInteger(survivalMs) ||
    survivalMs < 0 ||
    survivalMs > MAX_SURVIVAL_MS
  ) {
    return NextResponse.json({ error: "Invalid survival" }, { status: 400 });
  }
  const percentile = Number(input.percentile);
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
    return NextResponse.json({ error: "Invalid percentile" }, { status: 400 });
  }
  const interruptions = Number(input.interruptions);
  if (
    !Number.isInteger(interruptions) ||
    interruptions < 0 ||
    interruptions > 6
  ) {
    return NextResponse.json(
      { error: "Invalid interruptions" },
      { status: 400 },
    );
  }
  const s26 = input.s26 === true;
  const bestComeback = sanitizeComeback(input.bestComeback);

  const salt = process.env.HASH_SALT ?? "gauntlet";
  const ipHash = createHash("sha256").update(`${ip}${salt}`).digest("hex");

  try {
    const sql = db();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gauntlet.runs
        (display_name, s26, survival_ms, percentile, interruptions, best_comeback, ip_hash, published)
      VALUES
        (${displayName}, ${s26}, ${survivalMs}, ${percentile}, ${interruptions}, ${bestComeback}, ${ipHash}, true)
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("publish-run failed", error);
    return NextResponse.json(
      { error: "The board is offline" },
      { status: 503 },
    );
  }
}
