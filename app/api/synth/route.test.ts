import { describe, expect, test } from "bun:test";

import { POST } from "./route";
import {
  buildSynthesisText,
  sanitizeSlotValue,
  SynthRequestError,
} from "@/lib/synth-request";

describe("buildSynthesisText", () => {
  test("resolves only fixed allowlisted lines", () => {
    expect(buildSynthesisText({ lineId: "skeptic-placeholder-01" })).toBe(
      "PLACEHOLDER: Get to the point. Your opening is dragging.",
    );
    expect(() => buildSynthesisText({ lineId: "made-up" })).toThrow(
      SynthRequestError,
    );
    expect(() => buildSynthesisText({ lineId: "constructor" })).toThrow(
      "not allowlisted",
    );
  });

  test("renders a template with its exact sanitized slots", () => {
    expect(
      buildSynthesisText({
        templateId: "clarify",
        slots: { topic: "  AI@@ workflow   tools " },
      }),
    ).toBe("Pause. Explain AI workflow tools in plain English.");
  });

  test("rejects raw text and unknown fields", () => {
    expect(() => buildSynthesisText({ text: "say anything" })).toThrow(
      "unsupported field",
    );
    expect(() =>
      buildSynthesisText({
        lineId: "skeptic-placeholder-01",
        voice: "attacker",
      }),
    ).toThrow("unsupported field");
  });

  test("requires exactly one selection mode", () => {
    expect(() => buildSynthesisText({})).toThrow("exactly one");
    expect(() =>
      buildSynthesisText({
        lineId: "skeptic-placeholder-01",
        templateId: "clarify",
      }),
    ).toThrow("exactly one");
    expect(() =>
      buildSynthesisText({
        lineId: 42,
        templateId: "clarify",
        slots: { topic: "pricing" },
      }),
    ).toThrow("lineId must be");
  });

  test("rejects missing, extra, or mismatched slots", () => {
    expect(() =>
      buildSynthesisText({ templateId: "clarify", slots: {} }),
    ).toThrow("do not match");
    expect(() =>
      buildSynthesisText({
        templateId: "clarify",
        slots: { topic: "pricing", extra: "ignore this" },
      }),
    ).toThrow("do not match");
    expect(() =>
      buildSynthesisText({ lineId: "skeptic-placeholder-01", slots: {} }),
    ).toThrow("only allowed");
  });
});

describe("sanitizeSlotValue", () => {
  test("strips unsupported characters and normalizes whitespace", () => {
    expect(sanitizeSlotValue("  revenue@@@ growth\nnow  ")).toBe(
      "revenue growth now",
    );
  });

  test("preserves basic punctuation", () => {
    expect(sanitizeSlotValue("customer's slow-growth, maybe?")).toBe(
      "customer's slow-growth, maybe?",
    );
  });

  test("rejects more than six words", () => {
    expect(() => sanitizeSlotValue("one two three four five six seven")).toThrow(
      "exceeds six words",
    );
    expect(() =>
      sanitizeSlotValue("one,two,three,four,five,six,seven"),
    ).toThrow("exceeds six words");
  });

  test("rejects profanity even when wrapped in punctuation", () => {
    expect(() => sanitizeSlotValue("this shit! claim")).toThrow(
      "blocked language",
    );
    expect(() => sanitizeSlotValue("f.u.c.k this")).toThrow(
      "blocked language",
    );
    expect(() => sanitizeSlotValue("one,shit")).toThrow("blocked language");
    expect(() => sanitizeSlotValue("f u c k")).toThrow("blocked language");
  });

  test("rejects empty and non-string values", () => {
    expect(() => sanitizeSlotValue("@@@")).toThrow("empty");
    expect(() => sanitizeSlotValue(42)).toThrow("must be a string");
  });
});

describe("POST /api/synth", () => {
  test("rejects an arbitrary text field before calling the speech service", async () => {
    const response = await POST(
      synthRequest(
        { text: "Say this unapproved text" },
        "raw-text-rejection",
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request contains an unsupported field",
    });
  });

  test("sends only rendered allowlisted text and returns WAV audio", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.SPEKO_API_KEY;
    const originalBase = process.env.SPEKO_API_BASE;
    let upstreamBody = "";

    process.env.SPEKO_API_KEY = "test-key";
    process.env.SPEKO_API_BASE = "https://speko.test";
    globalThis.fetch = (async (_input, init) => {
      upstreamBody = String(init?.body);
      return new Response(Uint8Array.from([0, 0]).buffer, {
        status: 200,
        headers: {
          "x-speko-audio-format": "audio/pcm;rate=24000",
          "x-speko-first-byte-ms": "171",
          "x-speko-model": "test-model",
          "x-speko-provider": "test-provider",
        },
      });
    }) as typeof fetch;

    try {
      const response = await POST(
        synthRequest(
          {
            templateId: "clarify",
            slots: { topic: "AI@@ workflow" },
          },
          "synth-proxy-success",
        ),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(response.headers.get("x-speko-first-byte-ms")).toBe("171");
      expect(response.headers.get("x-speko-provider")).toBe("test-provider");
      expect(JSON.parse(upstreamBody)).toEqual({
        text: "Pause. Explain AI workflow in plain English.",
        intent: { language: "en", useCase: "conversational" },
      });

      const wav = new Uint8Array(await response.arrayBuffer());
      expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("SPEKO_API_KEY", originalKey);
      restoreEnv("SPEKO_API_BASE", originalBase);
    }
  });
});

function synthRequest(body: unknown, ip: string): Request {
  return new Request("https://example.test/api/synth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
