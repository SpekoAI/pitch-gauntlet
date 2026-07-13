import { NextResponse } from "next/server";

import {
  getClientIp,
  InMemoryTokenBucket,
  type RateLimiter,
  type RateLimitResult,
} from "@/lib/ratelimit";
import {
  buildSystemInstruction,
  extractCompletion,
  RoastRequestError,
  type RoastInput,
  validateRoastInput,
} from "@/lib/roast-completion";
import { parseJsonServerSentEvents } from "@/lib/speko-sse";

export const runtime = "nodejs";

const MAX_JSON_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const limiter: RateLimiter = new InMemoryTokenBucket({
  capacity: 8,
  refillTokensPerSecond: 8 / 60,
});

export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(`roast:${getClientIp(request)}`);
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    return jsonError(415, "Content-Type must be application/json");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    return jsonError(413, "Request body is too large");
  }

  let input: RoastInput;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
      return jsonError(413, "Request body is too large");
    }
    input = validateRoastInput(JSON.parse(body));
  } catch (error) {
    const message =
      error instanceof RoastRequestError
        ? error.message
        : "Request body must be valid JSON";
    return jsonError(400, message);
  }

  const config = readSpekoConfig();
  if (!config) {
    return jsonError(500, "Completion service is not configured");
  }

  const startedAt = performance.now();

  try {
    const upstream = await fetch(`${config.baseUrl}/v1/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: buildSystemInstruction(input.personaId),
          },
          {
            role: "user",
            content: `Transcript data: ${JSON.stringify(input.transcript)}`,
          },
        ],
        intent: { language: "en", useCase: "conversational" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      await consumeErrorBody(upstream);
      return jsonError(502, `Completion service returned ${upstream.status}`);
    }

    const completion = extractCompletion(
      parseJsonServerSentEvents(await upstream.text()),
      input.personaId,
    );
    const provider =
      upstream.headers.get("x-speko-provider") ?? completion.provider;
    const model = upstream.headers.get("x-speko-model") ?? completion.model;

    return NextResponse.json(
      {
        line: completion.line,
        provider,
        model,
        msElapsed: Math.round(performance.now() - startedAt),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(limit.remaining),
        },
      },
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return jsonError(504, "Completion service timed out");
    }

    return jsonError(502, "Completion service response was invalid");
  }
}

function readSpekoConfig(): { apiKey: string; baseUrl: string } | null {
  const apiKey = process.env.SPEKO_API_KEY?.trim();
  const baseUrl = process.env.SPEKO_API_BASE?.trim().replace(/\/$/, "");

  return apiKey && baseUrl ? { apiKey, baseUrl } : null;
}

function rateLimitedResponse(limit: RateLimitResult): Response {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1_000))),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}

function jsonError(status: number, error: string): Response {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function consumeErrorBody(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    // The status is enough to return a bounded error to the caller.
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}
