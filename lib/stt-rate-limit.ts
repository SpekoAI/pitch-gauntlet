import type { TokenBucketOptions } from "./ratelimit";

export const STT_RATE_LIMIT_OPTIONS: TokenBucketOptions = {
  capacity: 12,
  refillTokensPerSecond: 20 / 60,
};
