// Checks a nearest-first list as fast as Flipkart allows, and stops as soon as the
// K nearest hits are known.
//
// - Parallel workers pull items in order (concurrency N).
// - The first network request runs alone so the caller can learn which API works.
// - "Nearest K" is exact even with parallelism: we only stop once every item *before*
//   the K-th hit has been answered, so a slower, nearer request can't be skipped.
// - On a rate-limit every worker pauses together, the item is retried, concurrency
//   drops to 1 and the delay doubles. A streak of successes shortens the delay again and
//   restores parallel workers one at a time, up to the requested concurrency.

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSec: number | null) {
    super("rate-limited");
  }
}

export type Outcome = "done" | "enough" | "stopped" | "gave_up";

export type QueueOptions<T, R> = {
  items: T[];
  /** Resolve a single item. Throw RateLimitedError when the site asks to slow down. */
  check: (item: T) => Promise<{ value: R; cached: boolean }>;
  onResult: (index: number, value: R) => void;
  /** Items that count towards `stopAfterHits` (e.g. deliverable cities). */
  isHit: (item: T, value: R) => boolean;
  stopAfterHits: number; // 0 = check everything
  concurrency: number;
  delayMs: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  maxPauses: number;
  /** Wait out a rate-limit (show a countdown). Resolve false to stop. */
  onRateLimit: (attempt: number, retryAfterSec: number | null) => Promise<boolean>;
  cancelled: () => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const SPEED_UP_AFTER = 8; // successes in a row before shortening the delay
const RESTORE_AFTER = 12; // successes in a row (since the last rate-limit) before adding a worker back

export async function runQueue<T, R>(o: QueueOptions<T, R>): Promise<Outcome> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minDelay = o.minDelayMs ?? Math.min(o.delayMs, 300);
  const maxDelay = o.maxDelayMs ?? 8000;

  const n = o.items.length;
  const answered = new Array<boolean>(n).fill(false);
  const hit = new Array<boolean>(n).fill(false);
  const retry: number[] = [];
  let next = 0;
  const maxConcurrency = Math.max(1, o.concurrency);
  let concurrency = maxConcurrency;
  let delay = o.delayMs;
  let streak = 0;
  let calm = 0; // successes since the last rate-limit
  const alive = new Set<number>();
  const running: Promise<void>[] = [];
  let pauses = 0;
  let outcome: Outcome | null = null;
  let pause: Promise<boolean> | null = null;

  let releaseWarmup!: () => void;
  const warmup = new Promise<void>((r) => (releaseWarmup = r));
  let warmedUp = false;

  /** True once the K nearest hits are known for certain. */
  const haveEnough = () => {
    if (o.stopAfterHits <= 0) return false;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      if (!answered[i]) return false; // a nearer item is still unknown
      if (hit[i] && ++hits >= o.stopAfterHits) return true;
    }
    return false;
  };

  /**
   * Index of the K-th hit among answers so far. Items after it can never be among
   * the K nearest, so they are not worth a request even while nearer answers are pending.
   */
  const cutoff = () => {
    if (o.stopAfterHits <= 0) return n - 1;
    let hits = 0;
    for (let i = 0; i < n; i++) if (hit[i] && ++hits >= o.stopAfterHits) return i;
    return n - 1;
  };

  const take = (): number | null => {
    if (retry.length) return retry.shift()!;
    return next < n && next <= cutoff() ? next++ : null;
  };

  async function handleRateLimit(e: RateLimitedError): Promise<boolean> {
    if (!pause) {
      pause = (async () => {
        concurrency = 1;
        delay = Math.min(maxDelay, delay * 2);
        streak = 0;
        calm = 0;
        if (pauses >= o.maxPauses) {
          outcome ??= "gave_up";
          return false;
        }
        const go = await o.onRateLimit(++pauses, e.retryAfterSec);
        if (!go) outcome ??= "stopped";
        return go;
      })().finally(() => (pause = null));
    }
    return pause;
  }

  async function worker(id: number) {
    if (id > 0) await warmup;
    while (outcome === null) {
      if (o.cancelled()) return void (outcome = "stopped");
      if (pause && !(await pause)) return;
      if (id >= concurrency) return; // concurrency was reduced after a rate-limit
      const i = take();
      if (i === null) return;

      let res: { value: R; cached: boolean };
      try {
        res = await o.check(o.items[i]!);
      } catch (e) {
        if (!(e instanceof RateLimitedError)) throw e;
        retry.unshift(i); // retry the same item first, so nearest-first order holds
        if (!(await handleRateLimit(e))) return;
        continue;
      }

      if (o.cancelled()) return void (outcome = "stopped");
      answered[i] = true;
      hit[i] = o.isHit(o.items[i]!, res.value);
      o.onResult(i, res.value);

      if (!warmedUp && !res.cached) {
        warmedUp = true;
        releaseWarmup();
      }
      if (haveEnough()) outcome ??= "enough";

      if (!res.cached) {
        if (++streak >= SPEED_UP_AFTER) {
          streak = 0;
          delay = Math.max(minDelay, Math.round(delay * 0.8));
        }
        if (++calm >= RESTORE_AFTER && concurrency < maxConcurrency) {
          calm = 0;
          concurrency++;
          if (!alive.has(concurrency - 1)) spawn(concurrency - 1);
        }
        await sleep(delay);
      }
    }
  }

  function spawn(id: number) {
    alive.add(id);
    // Worker 0 always releases the warm-up when it ends, e.g. when everything was cached.
    const w = id === 0 ? worker(0).finally(releaseWarmup) : worker(id);
    running.push(w.finally(() => alive.delete(id)));
  }
  for (let id = 0; id < concurrency; id++) spawn(id);
  // Workers can be added while we wait, so walk the growing list.
  for (let k = 0; k < running.length; k++) await running[k];

  return outcome ?? "done";
}
