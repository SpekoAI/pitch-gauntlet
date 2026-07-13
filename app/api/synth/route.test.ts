import { describe, expect, test } from "bun:test";

import { POST } from "./route";
import {
  buildSynthesisText,
  sanitizeSlotValue,
  SynthRequestError,
} from "@/lib/synth-request";

describe("buildSynthesisText", () => {
  test("renders a final-manifest template with its exact sanitized slots", () => {
    expect(
      buildSynthesisText({
        templateId: "sk-t1",
        slots: { word: "  synergy@@ ", count: " 3 " },
      }),
    ).toBe("You said synergy 3 times. What does it actually do?");
  });

  test("replaces every occurrence of a repeated slot", () => {
    expect(
      buildSynthesisText({
        templateId: "vb-t1",
        slots: { word: "platform" },
      }),
    ).toBe("platform? We are doing platform now?");
  });

  test("rejects raw text, line ids, and unknown fields", () => {
    expect(() => buildSynthesisText({ text: "say anything" })).toThrow(
      "unsupported field",
    );
    expect(() =>
      buildSynthesisText({
        lineId: "sk-01",
        slots: {},
      }),
    ).toThrow("unsupported field");
    expect(() =>
      buildSynthesisText({
        templateId: "sp-t1",
        slots: { word: "synergy" },
        voice: "attacker",
      }),
    ).toThrow("unsupported field");
  });

  test("requires an allowlisted template and slots object", () => {
    expect(() => buildSynthesisText({})).toThrow("templateId must be");
    expect(() =>
      buildSynthesisText({ templateId: "made-up", slots: {} }),
    ).toThrow(SynthRequestError);
    expect(() =>
      buildSynthesisText({ templateId: "constructor", slots: {} }),
    ).toThrow("not allowlisted");
    expect(() => buildSynthesisText({ templateId: "sp-t1" })).toThrow(
      "slots must be",
    );
  });

  test("rejects missing, extra, or mismatched slots", () => {
    expect(() =>
      buildSynthesisText({ templateId: "sk-t1", slots: { word: "synergy" } }),
    ).toThrow("do not match");
    expect(() =>
      buildSynthesisText({
        templateId: "sp-t1",
        slots: { word: "synergy", extra: "ignore this" },
      }),
    ).toThrow("do not match");
  });

  test("enforces the manifest single-word constraint", () => {
    expect(() =>
      buildSynthesisText({
        templateId: "sp-t1",
        slots: { word: "machine learning" },
      }),
    ).toThrow("word must be a single word");
  });

  test("enforces the manifest count range", () => {
    for (const count of ["1", "10", "three", "2.0"]) {
      expect(() =>
        buildSynthesisText({
          templateId: "sk-t1",
          slots: { word: "synergy", count },
        }),
      ).toThrow("count must be an integer from 2 to 9");
    }

    expect(
      buildSynthesisText({
        templateId: "sk-t1",
        slots: { word: "synergy", count: "9" },
      }),
    ).toBe("You said synergy 9 times. What does it actually do?");
  });
});

describe("sanitizeSlotValue", () => {
  test("strips unsupported characters and normalizes whitespace", () => {
    expect(sanitizeSlotValue("  revenue@@@ growth\nnow  ")).toBe(
      "revenue growth now",
    );
  });

  test("preserves basic punctuation", () => {
    expect(sanitizeSlotValue("customer's slow-growth, maybe: yes?")).toBe(
      "customer's slow-growth, maybe: yes?",
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
    expect(() => sanitizeSlotValue("f-u-c-k this")).toThrow(
      "blocked language",
    );
  });

  test("rejects empty and non-string values", () => {
    expect(() => sanitizeSlotValue("@@@")).toThrow("empty");
    expect(() => sanitizeSlotValue(42)).toThrow("must be a string");
  });
});

describe("POST /api/synth", () => {
  test("rejects non-template modes before calling the speech service", async () => {
    const response = await POST(
      synthRequest(
        { lineId: "sk-01" },
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
            templateId: "sk-t1",
            slots: { word: "synergy@@", count: "3" },
          },
          "synth-proxy-success",
        ),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(
        Number(response.headers.get("x-latency-ms")),
      ).toBeGreaterThanOrEqual(0);
      expect(response.headers.get("x-speko-first-byte-ms")).toBe("171");
      expect(response.headers.get("x-speko-provider")).toBe("test-provider");
      expect(JSON.parse(upstreamBody)).toEqual({
        text: "You said synergy 3 times. What does it actually do?",
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
