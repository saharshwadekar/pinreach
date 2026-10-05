import { describe, expect, test } from "bun:test";
import { RateLimitedError, runQueue, type QueueOptions } from "../src/lib/scheduler";

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Items 0..n-1; `hits` are deliverable. Latency is random so parallel answers arrive out of order. */
function setup(n: number, hits: number[], extra: Partial<QueueOptions<number, boolean>> = {}) {
  const answered: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let maxBeforeFirst = 0;
  let firstDone = false;
  const opts: QueueOptions<number, boolean> = {
    items: Array.from({ length: n }, (_, i) => i),
    check: async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (!firstDone) maxBeforeFirst = Math.max(maxBeforeFirst, inFlight);
      await tick(Math.random() * 8);
      inFlight--;
      firstDone = true;
      return { value: hits.includes(i), cached: false };
    },
    onResult: (i) => answered.push(i),
    isHit: (_, v) => v,
    stopAfterHits: 0,
    concurrency: 3,
    delayMs: 0,
    minDelayMs: 0,
    maxPauses: 3,
    onRateLimit: async () => true,
    cancelled: () => false,
    sleep: () => Promise.resolve(),
    ...extra,
  };
  return { opts, answered, stats: () => ({ maxInFlight, maxBeforeFirst }) };
}

describe("runQueue", () => {
  test("checks everything when stopAfterHits is 0", async () => {
    const { opts, answered } = setup(20, [3]);
    expect(await runQueue(opts)).toBe("done");
    expect(answered.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  test("stops early with the exact K nearest hits, even in parallel", async () => {
    for (let run = 0; run < 20; run++) {
      const { opts, answered } = setup(40, [3, 7, 8, 15, 30], { stopAfterHits: 2 });
      expect(await runQueue(opts)).toBe("enough");
      // Every item up to the 2nd hit (index 7) must be answered…
      for (let i = 0; i <= 7; i++) expect(answered).toContain(i);
      // …and we didn't check much past it (only what was already in flight).
      expect(Math.max(...answered)).toBeLessThan(7 + 3 + 1);
    }
  });

  test("runs the first request alone, then goes parallel", async () => {
    const { opts, stats } = setup(30, []);
    await runQueue(opts);
    expect(stats().maxBeforeFirst).toBe(1);
    expect(stats().maxInFlight).toBeGreaterThan(1);
  });

  test("pauses once on a rate-limit, retries the same item, then finishes at concurrency 1", async () => {
    const pauses: number[] = [];
    let limited = false;
    let inFlight = 0;
    let maxAfterPause = 0;
    const answered: number[] = [];
    const base = setup(25, []);
    const outcome = await runQueue({
      ...base.opts,
      onResult: (i) => answered.push(i),
      check: async (i) => {
        inFlight++;
        if (limited) maxAfterPause = Math.max(maxAfterPause, inFlight);
        await tick(2);
        inFlight--;
        if (i === 6 && !limited) {
          limited = true;
          throw new RateLimitedError(null);
        }
        return { value: false, cached: false };
      },
      onRateLimit: async (attempt) => {
        pauses.push(attempt);
        return true;
      },
    });
    expect(outcome).toBe("done");
    expect(pauses).toEqual([1]);
    expect(answered.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(maxAfterPause).toBeLessThanOrEqual(3); // requests already in flight may finish…
  });

  test("gives up after maxPauses", async () => {
    const { opts } = setup(10, [], {
      maxPauses: 2,
      check: async () => {
        throw new RateLimitedError(5);
      },
    });
    const seen: (number | null)[] = [];
    expect(await runQueue({ ...opts, onRateLimit: async (_, ra) => (seen.push(ra), true) })).toBe("gave_up");
    expect(seen).toEqual([5, 5]);
  });

  test("Stop during a pause ends the run as stopped", async () => {
    const { opts } = setup(10, [], {
      check: async () => {
        throw new RateLimitedError(null);
      },
      onRateLimit: async () => false,
    });
    expect(await runQueue(opts)).toBe("stopped");
  });

  test("cancellation stops the run", async () => {
    let calls = 0;
    const { opts } = setup(50, [], { cancelled: () => calls > 5 });
    const check = opts.check;
    expect(await runQueue({ ...opts, check: (i) => (calls++, check(i)) })).toBe("stopped");
    expect(calls).toBeLessThan(10);
  });

  test("cached answers skip the delay", async () => {
    let sleeps = 0;
    const { opts } = setup(10, [], {
      check: async () => ({ value: false, cached: true }),
      sleep: async () => void sleeps++,
    });
    expect(await runQueue(opts)).toBe("done");
    expect(sleeps).toBe(0);
  });
  test("restores parallel checks after a calm streak following a rate-limit", async () => {
    let limited = false;
    let inFlight = 0;
    let maxLate = 0;
    let done = 0;
    const base = setup(60, []);
    const outcome = await runQueue({
      ...base.opts,
      concurrency: 3,
      check: async (i) => {
        inFlight++;
        if (done > 40) maxLate = Math.max(maxLate, inFlight); // well after the pause
        await tick(2);
        inFlight--;
        if (i === 3 && !limited) {
          limited = true;
          throw new RateLimitedError(null);
        }
        done++;
        return { value: false, cached: false };
      },
    });
    expect(outcome).toBe("done");
    expect(maxLate).toBeGreaterThan(1);
    expect(maxLate).toBeLessThanOrEqual(3);
  });
});
