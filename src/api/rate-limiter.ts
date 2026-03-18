/**
 * Rate limiter that queues concurrent requests to maintain a target rate.
 * Safe for use with parallel fetch workers.
 */
export class RateLimiter {
  private nextAllowedTime = 0;
  private readonly minIntervalMs: number;

  constructor(requestsPerSecond: number = 5) {
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  async wait(): Promise<void> {
    const now = Date.now();

    // Reserve the next slot atomically
    if (this.nextAllowedTime <= now) {
      this.nextAllowedTime = now + this.minIntervalMs;
      return; // No wait needed
    }

    const waitTime = this.nextAllowedTime - now;
    this.nextAllowedTime += this.minIntervalMs;

    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}
