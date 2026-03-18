import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../src/api/rate-limiter";

describe("RateLimiter", () => {
  it("enforces minimum interval between requests", async () => {
    const limiter = new RateLimiter(10); // 10 req/s = 100ms interval

    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;

    // Should have waited at least 200ms for 3 calls (2 waits)
    expect(elapsed).toBeGreaterThanOrEqual(180); // small tolerance
  });

  it("does not wait when enough time has passed", async () => {
    const limiter = new RateLimiter(1000); // 1ms interval

    const start = Date.now();
    await limiter.wait();
    await new Promise((r) => setTimeout(r, 10));
    await limiter.wait();
    const elapsed = Date.now() - start;

    // Should not have added significant delay
    expect(elapsed).toBeLessThan(100);
  });
});
