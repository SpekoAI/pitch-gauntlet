export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(
    key: string,
    cost?: number,
    nowMs?: number,
  ): RateLimitResult | Promise<RateLimitResult>;
}

export interface TokenBucketOptions {
  capacity: number;
  refillTokensPerSecond: number;
  idleTtlMs?: number;
  maxBuckets?: number;
}

interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

/**
 * Process-local token bucket. The RateLimiter interface is intentionally small
 * so a shared Postgres implementation can replace this without changing routes.
 */
export class InMemoryTokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillTokensPerMs: number;
  private readonly idleTtlMs: number;
  private readonly maxBuckets: number;
  private readonly sweepIntervalMs: number;
  private lastSweepAtMs = Number.NEGATIVE_INFINITY;

  constructor(options: TokenBucketOptions) {
    if (!Number.isFinite(options.capacity) || options.capacity <= 0) {
      throw new Error("capacity must be greater than zero");
    }

    if (
      !Number.isFinite(options.refillTokensPerSecond) ||
      options.refillTokensPerSecond <= 0
    ) {
      throw new Error("refillTokensPerSecond must be greater than zero");
    }

    const maxBuckets = options.maxBuckets ?? 10_000;
    if (!Number.isInteger(maxBuckets) || maxBuckets <= 0) {
      throw new Error("maxBuckets must be a positive integer");
    }

    const defaultIdleTtlMs = Math.max(
      60_000,
      (options.capacity / options.refillTokensPerSecond) * 2_000,
    );
    const idleTtlMs = options.idleTtlMs ?? defaultIdleTtlMs;
    if (!Number.isFinite(idleTtlMs) || idleTtlMs <= 0) {
      throw new Error("idleTtlMs must be greater than zero");
    }

    this.capacity = options.capacity;
    this.refillTokensPerMs = options.refillTokensPerSecond / 1_000;
    this.idleTtlMs = idleTtlMs;
    this.maxBuckets = maxBuckets;
    this.sweepIntervalMs = Math.min(60_000, idleTtlMs);
  }

  consume(key: string, cost = 1, nowMs = Date.now()): RateLimitResult {
    if (!key) {
      throw new Error("rate limit key is required");
    }

    if (!Number.isFinite(cost) || cost <= 0 || cost > this.capacity) {
      throw new Error("cost must be greater than zero and no more than capacity");
    }

    if (!Number.isFinite(nowMs)) {
      throw new Error("nowMs must be finite");
    }

    this.evictIdleBuckets(nowMs);
    let existing = this.buckets.get(key);
    if (!existing && this.buckets.size >= this.maxBuckets) {
      this.evictOldestBucket();
      existing = this.buckets.get(key);
    }
    const elapsedMs = existing
      ? Math.max(0, nowMs - existing.updatedAtMs)
      : 0;
    const available = existing
      ? Math.min(
          this.capacity,
          existing.tokens + elapsedMs * this.refillTokensPerMs,
        )
      : this.capacity;
    const allowed = available >= cost;
    const tokens = allowed ? available - cost : available;

    this.buckets.delete(key);
    this.buckets.set(key, {
      tokens,
      updatedAtMs: existing ? Math.max(existing.updatedAtMs, nowMs) : nowMs,
    });

    return {
      allowed,
      remaining: Math.max(0, Math.floor(tokens)),
      retryAfterMs: allowed
        ? 0
        : Math.ceil((cost - available) / this.refillTokensPerMs),
    };
  }

  clear(): void {
    this.buckets.clear();
    this.lastSweepAtMs = Number.NEGATIVE_INFINITY;
  }

  get bucketCount(): number {
    return this.buckets.size;
  }

  private evictIdleBuckets(nowMs: number): void {
    const sweepDue = nowMs - this.lastSweepAtMs >= this.sweepIntervalMs;
    if (!sweepDue && this.buckets.size < this.maxBuckets) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.updatedAtMs >= this.idleTtlMs) {
        this.buckets.delete(key);
      }
    }
    this.lastSweepAtMs = Math.max(this.lastSweepAtMs, nowMs);
  }

  private evictOldestBucket(): void {
    let oldestKey: string | null = null;
    let oldestAtMs = Number.POSITIVE_INFINITY;

    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAtMs < oldestAtMs) {
        oldestKey = key;
        oldestAtMs = bucket.updatedAtMs;
      }
    }

    if (oldestKey !== null) {
      this.buckets.delete(oldestKey);
    }
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const vercelForwarded = request.headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0];
  const candidate =
    request.headers.get("cf-connecting-ip") ??
    vercelForwarded ??
    request.headers.get("x-real-ip") ??
    forwarded ??
    "unknown";

  return candidate.trim().slice(0, 128) || "unknown";
}
