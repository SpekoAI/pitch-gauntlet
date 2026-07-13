import { NextResponse } from "next/server";
import { db, dbConfigured } from "@/lib/db";
import { getClientIp, InMemoryTokenBucket } from "@/lib/ratelimit";

export const runtime = "nodejs";

const limiter = new InMemoryTokenBucket({
  capacity: 10,
  refillTokensPerSecond: 10 / 3_600,
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deletes a published run by id. The uuid itself is the capability: it is
 * only ever shown to the publisher (and stored in their localStorage).
 */
export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(`delete:${getClientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
  const id = (body as Record<string, unknown> | null)?.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const sql = db();
    await sql`DELETE FROM gauntlet.runs WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("delete-run failed", error);
    return NextResponse.json(
      { error: "The board is offline" },
      { status: 503 },
    );
  }
}
