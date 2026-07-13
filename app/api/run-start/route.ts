import { NextResponse } from "next/server";
import { getClientIp, InMemoryTokenBucket } from "@/lib/ratelimit";
import { consumeRunBudget } from "@/lib/spend";

export const runtime = "nodejs";

// 5 game starts per IP per day (refill one every ~4.8 hours).
const limiter = new InMemoryTokenBucket({
  capacity: 5,
  refillTokensPerSecond: 5 / 86_400,
});

export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(`run-start:${getClientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Daily personal run limit reached. The panel remembers you." },
      { status: 429 },
    );
  }

  const budget = await consumeRunBudget();
  if (!budget.allowed) {
    return NextResponse.json(
      { error: "The panel is resting. Global daily budget spent." },
      { status: 429 },
    );
  }

  return NextResponse.json({ ok: true });
}
