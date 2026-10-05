import { RateLimitedError } from "../lib/scheduler";
import type { CheckResult } from "../lib/types";
import type { ProductRef, Site } from "./types";

// JioMart runs on the Fynd commerce platform. Its storefront API takes the pincode in an
// `x-location-detail` header. Verified against live responses (Oct 2026); see tests/fixtures.
const API = "https://www.jiomart.com/api/service/application/catalog";
// Public storefront credentials that every visitor's browser uses. Read from the page when
// possible (they may rotate); these are the values seen in Oct 2026.
const FALLBACK_APP = { id: "685945f46c8c7aee3f3af605", token: "TpKw7wD9h" };
// Big-city pincodes used once to discover the product's size code (e.g. "OS" for one-size items).
const SIZE_PROBE_PINS = [400001, 110001, 560001];

let app = FALLBACK_APP;

function readAppCredentials(doc: Document) {
  const html = [...doc.scripts].map((s) => s.textContent ?? "").join("\n");
  const id = html.match(/"application_id"\s*:\s*"([a-f0-9]{24})"/)?.[1];
  const token = html.match(/"token"\s*:\s*"([A-Za-z0-9_-]{6,40})"/)?.[1];
  if (id && token) app = { id, token };
}

async function get(path: string, pin: number): Promise<{ status: number; json: unknown }> {
  const res = await fetch(API + path, {
    credentials: "omit", // anonymous: never touches your JioMart account or saved location
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${btoa(`${app.id}:${app.token}`)}`,
      "x-location-detail": JSON.stringify({ pincode: String(pin) }),
    },
  });
  if (res.status === 429) throw new RateLimitedError(Number(res.headers.get("Retry-After")) || null);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON error page; handled by the caller as unknown
  }
  return { status: res.status, json };
}

/** /product/<slug> is the current URL style; old /p/<dept>/<name>/<id> pages link to it. */
function slugFrom(path: string): string | null {
  return path.match(/^\/product\/([a-z0-9-]+)/i)?.[1] ?? null;
}

const deliveryText = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "Deliverable";
  return `Delivery by ${d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
};

type PriceResponse = {
  is_serviceable?: boolean;
  price?: { effective?: number };
  seller?: { name?: string };
  delivery_promise?: { min?: string; max?: string };
};

/** Reads one v3 price response. Only explicit fields are trusted. */
export function parseJioMartPrice(status: number, json: unknown): CheckResult {
  const r = (json ?? {}) as PriceResponse;
  if (r.is_serviceable === false) return { status: "not_deliverable" };
  if (status === 200 && r.is_serviceable === true) {
    return {
      status: "deliverable",
      detail: deliveryText(r.delivery_promise?.max ?? r.delivery_promise?.min),
      ...(typeof r.price?.effective === "number" && { price: r.price.effective }),
      ...(r.seller?.name && { seller: r.seller.name }),
    };
  }
  return { status: status >= 500 ? "error" : "unknown", ...(status !== 200 && { detail: `HTTP ${status}` }) };
}

/** First available size code from a sizes response, e.g. "OS". */
export function firstSize(json: unknown): string | null {
  const sizes = (json as { sizes?: { value?: string; is_available?: boolean }[] })?.sizes ?? [];
  return sizes.find((s) => s.is_available && s.value)?.value ?? null;
}

export const jiomart: Site = {
  id: "jiomart",
  name: "JioMart",

  productKey(loc) {
    const slug = slugFrom(loc.pathname);
    if (slug) return slug;
    const old = loc.pathname.match(/^\/p\/.+\/(\d+)\/?$/)?.[1];
    return old ? `p:${old}` : null;
  },

  async resolve(loc, doc): Promise<ProductRef | null> {
    readAppCredentials(doc);
    // Old-style pages: find the real product link on the page.
    const link = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content;
    const slug = slugFrom(loc.pathname) ?? (link ? slugFrom(new URL(link, loc.href).pathname) : null);
    if (!slug) return null;

    // The size on the URL wins (fashion); otherwise ask a few big cities which size exists.
    let size = new URLSearchParams(loc.search).get("size");
    for (const pin of SIZE_PROBE_PINS) {
      if (size) break;
      size = firstSize((await get(`/v1.0/products/${slug}/sizes/`, pin)).json);
    }
    return { id: slug, extra: { size: size ?? "OS" } };
  },

  async check(p, pin, debug) {
    const size = encodeURIComponent(p.extra?.size ?? "OS");
    const { status, json } = await get(`/v3.0/products/${p.id}/sizes/${size}/price/?pincode=${pin}`, pin);
    if (debug) console.log(`[PinReach] jiomart ${pin}`, status, json);
    return parseJioMartPrice(status, json);
  },
};
