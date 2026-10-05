import { RateLimitedError } from "../lib/scheduler";
import type { CheckResult } from "../lib/types";
import type { Site } from "./types";

// Flipkart's own website calls these when you type a pincode on a product page.
// The response shape below was verified against live responses (Oct 2026); see tests/fixtures.
const SERVICEABILITY_API = "https://1.rome.api.flipkart.com/api/3/product/serviceability";
const PAGE_API = "https://1.rome.api.flipkart.com/api/4/page/fetch";

export type ProductContext = { pid: string; lid: string | null };

/** Product page URLs look like /some-name/p/itm…, usually with ?pid=…&lid=… */
function isProductPage(loc: Location): boolean {
  return /\/p\/itm[a-z0-9]+/i.test(loc.pathname);
}

const headers = () => ({
  "Content-Type": "application/json",
  "X-User-Agent": `${navigator.userAgent} FKUA/website/42/website/Desktop`,
});

/** Retry-After is either seconds or an HTTP date. */
function retryAfterSec(value: string | null): number | null {
  if (!value) return null;
  const sec = Number(value);
  if (Number.isFinite(sec)) return sec > 0 ? sec : null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : null;
}

async function post(url: string, body: unknown): Promise<unknown> {
  // No cookies: checks are anonymous, so they never touch your Flipkart account or saved location.
  const res = await fetch(url, { method: "POST", credentials: "omit", headers: headers(), body: JSON.stringify(body) });
  if (res.status === 429) throw new RateLimitedError(retryAfterSec(res.headers.get("Retry-After")));
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
}

/**
 * Finds the product (and the listing shown on the page) for the current URL.
 * Most URLs carry ?pid=…; links shared from Google often don't, so we ask Flipkart once.
 */
export async function resolveProduct(loc: Location): Promise<ProductContext | null> {
  if (!isProductPage(loc)) return null;
  const q = new URLSearchParams(loc.search);
  const pid = q.get("pid");
  if (pid) return { pid, lid: q.get("lid") };

  const json = (await post(PAGE_API, { pageUri: loc.pathname + loc.search, isReloadRequest: false })) as {
    RESPONSE?: { pageData?: { pageContext?: { productId?: string; listingId?: string } } };
  };
  const ctx = json?.RESPONSE?.pageData?.pageContext;
  return ctx?.productId ? { pid: ctx.productId, lid: ctx.listingId ?? null } : null;
}

type Money = { value?: number } | null | undefined;
type ListingSummary = {
  available?: boolean;
  serviceable?: boolean;
  deliveryInfo?: { primaryOption?: { text?: string } };
  pricing?: { finalPrice?: Money };
  sellerInfo?: { name?: string };
};

/** Reads one serviceability response. Only explicit fields are trusted; no text guessing. */
export function parseServiceability(json: unknown, pid: string): CheckResult {
  const product = (json as { RESPONSE?: Record<string, { listingSummary?: ListingSummary }> })?.RESPONSE?.[pid];
  const ls = product?.listingSummary;
  if (!ls) return { status: "unknown", detail: "Not on sale right now" };

  const price = typeof ls.pricing?.finalPrice?.value === "number" ? ls.pricing.finalPrice.value : undefined;
  const seller = ls.sellerInfo?.name || undefined;
  const extra = { ...(price !== undefined && { price }), ...(seller && { seller }) };

  if (ls.available === false) return { status: "not_deliverable", detail: "Out of stock", ...extra };
  if (ls.serviceable === true) return { status: "deliverable", detail: ls.deliveryInfo?.primaryOption?.text || "Deliverable", ...extra };
  if (ls.serviceable === false) return { status: "not_deliverable", ...extra };
  return { status: "unknown", ...extra };
}

/** Checks one pincode for the product. Throws RateLimitedError on HTTP 429. */
export async function checkPincode(ctx: ProductContext, pin: number, debug = false): Promise<CheckResult> {
  const json = await post(SERVICEABILITY_API, {
    requestContext: { products: [{ productId: ctx.pid, ...(ctx.lid ? { listingId: ctx.lid } : {}) }] },
    locationContext: { pincode: String(pin) },
  });
  if (debug) console.log(`[PinReach] ${pin}`, json);
  return parseServiceability(json, ctx.pid);
}

export const flipkart: Site = {
  id: "flipkart",
  name: "Flipkart",
  // Path + pid only: Flipkart appends tracking parameters that must not reset the panel.
  productKey: (loc) => (isProductPage(loc) ? loc.pathname + (new URLSearchParams(loc.search).get("pid") ?? "") : null),
  async resolve(loc) {
    const ctx = await resolveProduct(loc);
    if (!ctx) return null;
    const extra: Record<string, string> = ctx.lid ? { lid: ctx.lid } : {};
    return { id: ctx.pid, extra };
  },
  check: (p, pin, debug) => checkPincode({ pid: p.id, lid: p.extra?.lid ?? null }, pin, debug),
};
