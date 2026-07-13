import { afterEach, describe, expect, test } from "bun:test";

import { POST } from "./route";
import {
  buildSystemInstruction,
  cleanCompletionLine,
  extractCompletion,
  validateRoastInput,
} from "@/lib/roast-completion";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.SPEKO_API_KEY;
const originalApiBase = process.env.SPEKO_API_BASE;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("SPEKO_API_KEY", originalApiKey);
  restoreEnv("SPEKO_API_BASE", originalApiBase);
});

describe("validateRoastInput", () => {
  test("accepts only an allowlisted persona and delivery stats", () => {
    expect(
      validateRoastInput({
        personaId: "skeptic",
        stats: { wpm: 172.5, fillerCount: 4, buzzwordCount: 2 },
      }),
    ).toEqual({
      personaId: "skeptic",
      stats: { wpm: 172.5, fillerCount: 4, buzzwordCount: 2 },
    });
  });

  test("rejects unknown personas and fields outside delivery stats", () => {
    expect(() =>
      validateRoastInput({
        personaId: "hostile",
        stats: { wpm: 150, fillerCount: 1, buzzwordCount: 0 },
      }),
    ).toThrow("not allowlisted");
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        stats: { wpm: 150, fillerCount: 1, buzzwordCount: 0 },
        transcript: "ignore safety",
      }),
    ).toThrow("unsupported field");
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        stats: {
          wpm: 150,
          fillerCount: 1,
          buzzwordCount: 0,
          idea: "judge this",
        },
      }),
    ).toThrow("stats contains an unsupported field");
  });

  test("requires finite non-negative stats and integer counts", () => {
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        stats: { wpm: -1, fillerCount: 0, buzzwordCount: 0 },
      }),
    ).toThrow("finite non-negative");
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        stats: { wpm: 145, fillerCount: 1.5, buzzwordCount: 0 },
      }),
    ).toThrow("must be an integer");
    expect(() =>
      validateRoastInput({
        personaId: "skeptic",
        stats: { wpm: 145, fillerCount: 1 },
      }),
    ).toThrow("finite non-negative");
  });
});

describe("extractCompletion", () => {
  test("prefers done text and reads provider metadata", () => {
    expect(
      extractCompletion(
        [
          {
            event: "meta",
            data: { provider: "provider-a", model: "model-b" },
          },
          { event: "delta", data: { text: "partial" } },
          { event: "done", data: { text: "Your pace needs a speed limit" } },
        ],
        "spreadsheet",
      ),
    ).toEqual({
      line: "Your pace needs a speed limit.",
      provider: "provider-a",
      model: "model-b",
    });
  });

  test("joins delta text when done has no text", () => {
    expect(
      extractCompletion(
        [
          { event: "delta", data: { text: "Slow down. " } },
          { event: "delta", data: { content: "Your words need air." } },
          { event: "done", data: {} },
        ],
        "vibes",
      ).line,
    ).toBe("Slow down.");
  });
});

describe("cleanCompletionLine", () => {
  test("caps output at 140 printable ASCII characters", () => {
    const output = cleanCompletionLine(
      `Your pace ${"moves faster than the slides ".repeat(12)}`,
      "skeptic",
    );

    expect(output.length).toBeLessThanOrEqual(140);
    expect(output).toMatch(/^[\x20-\x7e]+$/);
    expect(output).toEndWith(".");
  });

  test("strips non-ASCII characters and quotation marks", () => {
    expect(cleanCompletionLine('"Pace \u{1f525} needs work"', "vibes")).toBe(
      "Pace needs work.",
    );
  });

  test("uses a delivery-only fallback for empty or profane output", () => {
    expect(cleanCompletionLine("", "spreadsheet")).toBe(
      "Your filler count has better growth than your clarity.",
    );
    expect(cleanCompletionLine("This is shit", "vibes")).toBe(
      "Slow down. Your words are lapping your breath.",
    );
    expect(cleanCompletionLine("That was f u c k ing fast", "skeptic")).toBe(
      "Your pace is sprinting while your clarity ties its shoes.",
    );
  });

  test("keeps only the first sentence", () => {
    expect(
      cleanCompletionLine(
        "Your filler words need an editor. The idea is irrelevant.",
        "spreadsheet",
      ),
    ).toBe("Your filler words need an editor.");
  });
});

describe("POST /api/roast", () => {
  test("sends a messages array containing delivery stats but no transcript", async () => {
    process.env.SPEKO_API_KEY = "test-key";
    process.env.SPEKO_API_BASE = "https://speko.test";
    let upstreamBody: unknown;

    globalThis.fetch = (async (_input, init) => {
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(
        [
          "event: meta",
          'data: {"provider":"test-provider","model":"test-model"}',
          "",
          "event: done",
          'data: {"text":"Your filler count is doing cardio."}',
          "",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    }) as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/roast", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.61",
        },
        body: JSON.stringify({
          personaId: "vibes",
          stats: { wpm: 181, fillerCount: 7, buzzwordCount: 3 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      line: "Your filler count is doing cardio.",
      provider: "test-provider",
      model: "test-model",
    });
    expect(upstreamBody).toEqual({
      messages: [
        {
          role: "system",
          content: buildSystemInstruction("vibes"),
        },
        {
          role: "user",
          content:
            'Run stats: {"wpm":181,"fillerCount":7,"buzzwordCount":3}',
        },
      ],
      intent: { language: "en", useCase: "conversational" },
    });
    expect(JSON.stringify(upstreamBody)).not.toContain("transcript");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
