import { describe, expect, test } from "bun:test";

import { getClientIp, InMemoryTokenBucket } from "./ratelimit";

describe("InMemoryTokenBucket", () => {
  test("allows requests up to capacity and then rejects", () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 2,
      refillTokensPerSecond: 1,
    });

    expect(limiter.consume("one", 1, 0)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
    expect(limiter.consume("one", 1, 0)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
    expect(limiter.consume("one", 1, 0)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1_000,
    });
  });

  test("refills tokens over time without exceeding capacity", () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 3,
      refillTokensPerSecond: 2,
    });

    limiter.consume("one", 3, 0);

    expect(limiter.consume("one", 1, 250)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 250,
    });
    expect(limiter.consume("one", 1, 500).allowed).toBe(true);
    expect(limiter.consume("one", 1, 10_000).remaining).toBe(2);
  });

  test("keeps buckets independent", () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 1,
      refillTokensPerSecond: 1,
    });

    expect(limiter.consume("one", 1, 0).allowed).toBe(true);
    expect(limiter.consume("one", 1, 0).allowed).toBe(false);
    expect(limiter.consume("two", 1, 0).allowed).toBe(true);
  });

  test("rejects invalid configuration and costs", () => {
    expect(
      () =>
        new InMemoryTokenBucket({
          capacity: 0,
          refillTokensPerSecond: 1,
        }),
    ).toThrow();
    expect(
      () =>
        new InMemoryTokenBucket({
          capacity: 1,
          refillTokensPerSecond: 1,
          maxBuckets: 0,
        }),
    ).toThrow();
    expect(
      () =>
        new InMemoryTokenBucket({
          capacity: 1,
          refillTokensPerSecond: 1,
          idleTtlMs: 0,
        }),
    ).toThrow();

    const limiter = new InMemoryTokenBucket({
      capacity: 1,
      refillTokensPerSecond: 1,
    });
    expect(() => limiter.consume("one", 2, 0)).toThrow();
  });

  test("evicts idle buckets lazily", () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 1,
      refillTokensPerSecond: 1,
      idleTtlMs: 1_000,
      maxBuckets: 10,
    });

    limiter.consume("old", 1, 0);
    limiter.consume("active", 1, 500);
    expect(limiter.bucketCount).toBe(2);

    limiter.consume("new", 1, 1_000);
    expect(limiter.bucketCount).toBe(2);
    expect(limiter.consume("old", 1, 1_000).allowed).toBe(true);
  });

  test("bounds bucket cardinality and evicts the oldest entry", () => {
    const limiter = new InMemoryTokenBucket({
      capacity: 1,
      refillTokensPerSecond: 0.01,
      idleTtlMs: 1_000_000,
      maxBuckets: 2,
    });

    limiter.consume("oldest", 1, 0);
    limiter.consume("second", 1, 1);
    limiter.consume("third", 1, 2);

    expect(limiter.bucketCount).toBe(2);
    expect(limiter.consume("oldest", 1, 2).allowed).toBe(true);
    expect(limiter.bucketCount).toBe(2);
  });
});

describe("getClientIp", () => {
  test("uses the first forwarded address", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });

    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  test("prefers a platform-provided connecting address", () => {
    const request = new Request("https://example.test", {
      headers: {
        "cf-connecting-ip": "203.0.113.2",
        "x-forwarded-for": "203.0.113.1",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.2");
  });

  test("uses Vercel's platform forwarding header before generic forwarding", () => {
    const request = new Request("https://example.test", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.3",
        "x-forwarded-for": "198.51.100.1",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.3");
  });
});
