import { NextResponse } from "next/server";

import {
  getClientIp,
  InMemoryTokenBucket,
  type RateLimiter,
  type RateLimitResult,
} from "@/lib/ratelimit";
import {
  parseJsonServerSentEvents,
} from "@/lib/speko-sse";
import { STT_RATE_LIMIT_OPTIONS } from "@/lib/stt-rate-limit";
import { extractTranscription } from "@/lib/transcription";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 15_000;
const UPSTREAM_TIMEOUT_MS = 30_000;
const limiter: RateLimiter = new InMemoryTokenBucket(STT_RATE_LIMIT_OPTIONS);

export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(`stt:${getClientIp(request)}`);
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/octet-stream") {
    return jsonError(415, "Content-Type must be application/octet-stream");
  }

  const durationMs = Number(request.headers.get("x-audio-duration-ms"));
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > MAX_AUDIO_DURATION_MS
  ) {
    return jsonError(
      400,
      "x-audio-duration-ms must be greater than zero and no more than 15000",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
    return jsonError(413, "Audio chunk exceeds the 4 MiB limit");
  }

  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) {
    return jsonError(400, "Audio chunk is empty");
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return jsonError(413, "Audio chunk exceeds the 4 MiB limit");
  }

  const config = readSpekoConfig();
  if (!config) {
    return jsonError(500, "Speech service is not configured");
  }

  const startedAt = performance.now();

  try {
    const upstream = await fetch(`${config.baseUrl}/v1/transcribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/octet-stream",
        "x-speko-intent": JSON.stringify({ language: "en" }),
      },
      body: audio,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      await consumeErrorBody(upstream);
      return jsonError(502, `Speech service returned ${upstream.status}`);
    }

    const events = parseJsonServerSentEvents(await upstream.text());
    const result = extractTranscription(events);
    const msElapsed = Math.round(performance.now() - startedAt);

    return NextResponse.json(
      { ...result, msElapsed },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(limit.remaining),
        },
      },
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return jsonError(504, "Speech service timed out");
    }

    return jsonError(502, "Speech service response was invalid");
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
