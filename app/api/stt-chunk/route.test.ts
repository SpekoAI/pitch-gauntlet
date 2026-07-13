import { describe, expect, test } from "bun:test";

import { InMemoryTokenBucket } from "@/lib/ratelimit";
import { STT_RATE_LIMIT_OPTIONS } from "@/lib/stt-rate-limit";
import { extractTranscription } from "@/lib/transcription";
import { POST } from "./route";

describe("extractTranscription", () => {
  test("prefers the done transcript and confidence", () => {
    expect(
      extractTranscription([
        {
          event: "transcript",
          data: { text: "partial", isFinal: false, confidence: 0.5 },
        },
        {
          event: "done",
          data: { text: "final words", confidence: 0.92 },
        },
      ]),
    ).toEqual({ text: "final words", confidence: 0.92 });
  });

  test("falls back to the latest transcript event", () => {
    expect(
      extractTranscription([
        { event: "meta", data: { provider: "test" } },
        { event: "transcript", data: { text: "one", confidence: 0.3 } },
        { event: "transcript", data: { text: "one two", confidence: 0.7 } },
        { event: "done", data: {} },
      ]),
    ).toEqual({ text: "one two", confidence: 0.7 });
  });

  test("returns an empty result when no transcript is present", () => {
    expect(extractTranscription([])).toEqual({ text: "", confidence: null });
  });
});

describe("POST /api/stt-chunk", () => {
  test("allows a 90 second pitch at three second chunk cadence", () => {
    const limiter = new InMemoryTokenBucket(STT_RATE_LIMIT_OPTIONS);

    for (let chunk = 0; chunk < 30; chunk += 1) {
      expect(limiter.consume("pitch", 1, chunk * 3_000).allowed).toBe(true);
    }
  });

  test("permits a bounded burst and refills at 20 chunks per minute", () => {
    const limiter = new InMemoryTokenBucket(STT_RATE_LIMIT_OPTIONS);

    for (let chunk = 0; chunk < STT_RATE_LIMIT_OPTIONS.capacity; chunk += 1) {
      expect(limiter.consume("burst", 1, 0).allowed).toBe(true);
    }

    expect(limiter.consume("burst", 1, 0)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 3_000,
    });
    expect(limiter.consume("burst", 1, 3_000).allowed).toBe(true);
  });

  test("requires a declared duration no greater than 15 seconds", async () => {
    const missing = await POST(
      audioRequest({ "x-forwarded-for": "duration-missing" }),
    );
    expect(missing.status).toBe(400);

    const excessive = await POST(
      audioRequest({
        "x-audio-duration-ms": "15001",
        "x-forwarded-for": "duration-excessive",
      }),
    );
    expect(excessive.status).toBe(400);
  });

  test("proxies binary audio and parses the Speko event stream", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SPEKO_API_KEY;
    const originalBase = process.env.SPEKO_API_BASE;
    let upstreamHeaders = new Headers();
    let upstreamUrl = "";
    let upstreamAudio = new Uint8Array();

    process.env.SPEKO_API_KEY = "test-key";
    process.env.SPEKO_API_BASE = "https://speko.test";
    globalThis.fetch = (async (input, init) => {
      upstreamUrl = String(input);
      upstreamHeaders = new Headers(init?.headers);
      upstreamAudio = new Uint8Array(await new Response(init?.body).arrayBuffer());
      return new Response(
        [
          'event: transcript\ndata: {"text":"partial","confidence":0.5}',
          'event: done\ndata: {"text":"final text","confidence":0.9}',
          "",
        ].join("\n\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }) as typeof fetch;

    try {
      const response = await POST(
        audioRequest({
          "x-audio-duration-ms": "7000",
          "x-forwarded-for": "proxy-success",
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        text: "final text",
        confidence: 0.9,
        msElapsed: expect.any(Number),
      });
      expect(upstreamHeaders.get("authorization")).toBe("Bearer test-key");
      expect(upstreamHeaders.get("x-speko-intent")).toBe(
        '{"language":"en"}',
      );
      expect(upstreamUrl).toBe("https://speko.test/v1/transcribe");
      expect(upstreamAudio).toEqual(Uint8Array.from([1, 2]));
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("SPEKO_API_KEY", originalKey);
      restoreEnv("SPEKO_API_BASE", originalBase);
    }
  });
});

function audioRequest(extraHeaders: Record<string, string>): Request {
  return new Request("https://example.test/api/stt-chunk", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      ...extraHeaders,
    },
    body: Uint8Array.from([1, 2]).buffer,
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
