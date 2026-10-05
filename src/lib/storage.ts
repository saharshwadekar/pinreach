import { DEFAULT_SETTINGS, type CheckResult, type Settings } from "./types";

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
// One storage key per result, so parallel writes can't overwrite each other.
// Bump the version whenever parsing changes, so stale (possibly wrong) answers are ignored.
const CACHE_PREFIX = "c2:";
const LEGACY_KEYS = ["cache"]; // single-object cache from v0.1, which lost writes under parallel checks

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

type CacheEntry = CheckResult & { at: number };

export async function getCached(key: string): Promise<CheckResult | null> {
  const k = CACHE_PREFIX + key;
  const { [k]: hit } = (await chrome.storage.local.get(k)) as Record<string, CacheEntry | undefined>;
  if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) return null;
  const { at: _, ...result } = hit;
  return result;
}

export async function putCached(key: string, result: CheckResult): Promise<void> {
  // Only cache real answers; unknown/error should be retried next time.
  if (result.status !== "deliverable" && result.status !== "not_deliverable") return;
  await chrome.storage.local.set({ [CACHE_PREFIX + key]: { ...result, at: Date.now() } satisfies CacheEntry });
}

/** Drops expired and outdated cache entries. Called once per run, not per result. */
export async function pruneCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const stale = Object.entries(all)
    .filter(([k, v]) => LEGACY_KEYS.includes(k) || (/^c\d+:/.test(k) && (!k.startsWith(CACHE_PREFIX) || now - (v as CacheEntry).at >= CACHE_TTL_MS)))
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}
