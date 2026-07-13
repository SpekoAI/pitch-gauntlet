import { NextResponse } from "next/server";

import { parsePcmSampleRate, pcmToWav } from "@/lib/pcm-to-wav";
import {
  getClientIp,
  InMemoryTokenBucket,
  type RateLimiter,
  type RateLimitResult,
} from "@/lib/ratelimit";
import { buildSynthesisText, SynthRequestError } from "@/lib/synth-request";

export const runtime = "nodejs";

const MAX_JSON_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const limiter: RateLimiter = new InMemoryTokenBucket({
  capacity: 12,
  refillTokensPerSecond: 0.2,
});

export async function POST(request: Request): Promise<Response> {
  const limit = await limiter.consume(`synth:${getClientIp(request)}`);
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

  let input: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
      return jsonError(413, "Request body is too large");
    }
    input = JSON.parse(body);
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }

  let text: string;
  try {
    text = buildSynthesisText(input);
  } catch (error) {
    const message =
      error instanceof SynthRequestError
        ? error.message
        : "Invalid synth request";
    return jsonError(400, message);
  }

  const config = readSpekoConfig();
  if (!config) {
    return jsonError(500, "Speech service is not configured");
  }

  const startedAt = performance.now();

  try {
    const upstream = await fetch(`${config.baseUrl}/v1/synthesize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        intent: { language: "en", useCase: "conversational" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      await consumeErrorBody(upstream);
      return jsonError(502, `Speech service returned ${upstream.status}`);
    }

    const format = upstream.headers.get("x-speko-audio-format");
    if (!format) {
      return jsonError(502, "Speech service omitted the PCM format");
    }

    const sampleRate = parsePcmSampleRate(format);
    const pcm = new Uint8Array(await upstream.arrayBuffer());
    if (pcm.byteLength === 0) {
      return jsonError(502, "Speech service returned empty audio");
    }

    const wav = pcmToWav(pcm, sampleRate);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "audio/wav",
      "X-Latency-Ms": String(Math.round(performance.now() - startedAt)),
      "X-RateLimit-Remaining": String(limit.remaining),
    });
    copyHeader(upstream.headers, headers, "x-speko-first-byte-ms");
    copyHeader(upstream.headers, headers, "x-speko-provider");
    copyHeader(upstream.headers, headers, "x-speko-model");

    const body = Uint8Array.from(wav).buffer;
    return new Response(body, { status: 200, headers });
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

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (value) {
    target.set(name, value);
  }
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
