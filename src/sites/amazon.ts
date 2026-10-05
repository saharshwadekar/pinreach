import { RateLimitedError } from "../lib/scheduler";
import type { CheckResult } from "../lib/types";
import type { ProductRef, Site } from "./types";

// EXPERIMENTAL: written from Amazon.in's known web flow, not yet verified live (blocked on the
// build machine). Amazon has no separate pincode check: the "Deliver to" box changes the whole
// session's location. So each check (1) switches the session pincode, (2) reads the product
// page's own delivery box, and finish() switches back to your original pincode afterwards.
// Must run one at a time, and needs your session (credentials: "include").
const ADDRESS_CHANGE = "/portal-migration/hz/glow/address-change?actionSource=glow";
const ADDRESS_MODAL = "/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=Detail&storeContext=generic&actionSource=desktop-modal";

const PIN_RE = /\b[1-9]\d{5}\b/;
/** Visible text of the first matching element; scripts/styles inside it are ignored. */
const text = (doc: Document, ...selectors: string[]) => {
  for (const s of selectors) {
    const el = doc.querySelector(s);
    if (!el) continue;
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    const t = copy.textContent?.replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return "";
};

/** What the product page says, read from Amazon's own delivery/availability boxes only. */
export type AmazonPage = {
  shownLocation: string; // "Deliver to … Pune 411001"
  delivery: string; // "FREE delivery Monday, 12 October"
  availability: string; // "In stock" / "Currently unavailable."
  undeliverable: boolean; // Amazon's dedicated "cannot be delivered to your location" box
  addToCart: boolean;
  price?: number;
  captcha: boolean;
};

export function readAmazonPage(doc: Document): AmazonPage {
  const priceText = text(doc, ".priceToPay .a-offscreen", "#corePrice_feature_div .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-offscreen", "#price_inside_buybox");
  const price = Number(priceText.replace(/[₹,\s]/g, ""));
  return {
    shownLocation: text(doc, "#glow-ingress-line2", "#contextualIngressPtLabel_deliveryShortLine"),
    delivery: text(doc, "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE", "#deliveryBlockMessage", "#mir-layout-DELIVERY_BLOCK"),
    availability: text(doc, "#availability"),
    undeliverable: !!doc.querySelector("#exports_desktop_undeliverable_buybox, #undeliverableMessage_feature_div"),
    addToCart: !!doc.querySelector("#add-to-cart-button, #buy-now-button"),
    ...(Number.isFinite(price) && price > 0 && { price }),
    captcha: !!doc.querySelector('form[action*="validateCaptcha"]'),
  };
}

const NOT_DELIVERABLE = /cannot be (delivered|shipped)|can't be (delivered|shipped)|not deliverable|(doesn't|does not|unable to) (deliver|ship)/i;

/** Decides from the page's own boxes. Unknown unless the page clearly says one way or the other. */
export function parseAmazon(page: AmazonPage, pin: number): CheckResult {
  const raw = page;
  if (!page.shownLocation.includes(String(pin))) return { status: "unknown", detail: "Location didn't switch", raw };
  if (/currently unavailable/i.test(page.availability)) return { status: "not_deliverable", detail: "Out of stock", raw };
  if (page.undeliverable || NOT_DELIVERABLE.test(page.delivery) || NOT_DELIVERABLE.test(page.availability)) {
    return { status: "not_deliverable", raw, ...(page.price && { price: page.price }) };
  }
  if (page.addToCart && /deliver/i.test(page.delivery)) {
    return { status: "deliverable", detail: page.delivery.replace(/\.\s*Details.*$/i, "").slice(0, 60), raw, ...(page.price && { price: page.price }) };
  }
  return { status: "unknown", raw };
}

/**
 * The token Amazon requires for the location change, and where it came from (for the log).
 * Two steps, like the "Deliver to" button: the button's popup config carries token #1, which
 * opens the address popup; the popup carries token #2 (CSRF_TOKEN), which the change needs.
 */
async function findCsrfToken(doc: Document): Promise<{ token: string; from: string } | null> {
  const trigger = doc.querySelector("#nav-global-location-data-modal-action, [data-a-modal*='get-rendered-address-selections']");
  let url = ADDRESS_MODAL;
  let headers: Record<string, string> = {};
  try {
    const cfg = JSON.parse(trigger?.getAttribute("data-a-modal") ?? "null");
    if (cfg?.url) url = cfg.url;
    if (cfg?.ajaxHeaders) headers = cfg.ajaxHeaders;
  } catch {
    // no usable popup config: try the default popup address
  }
  const res = await fetch(url, { credentials: "include", headers: { ...headers, "x-requested-with": "XMLHttpRequest" } });
  const html = await res.text();
  const via = trigger ? "Deliver-to button → address popup" : "address popup (default)";
  const a = html.match(/CSRF_TOKEN\s*[:=]\s*["']([^"']+)["']/)?.[1];
  if (a) return { token: a, from: `${via}: CSRF_TOKEN` };
  const b = html.match(/anti-csrftoken-a2z["']?\s*[:=]\s*["']([^"']+)["']/)?.[1];
  if (b) return { token: b, from: `${via}: anti-csrftoken-a2z` };
  const inPage = doc.querySelector<HTMLInputElement>('input[name="anti-csrftoken-a2z"]')?.value;
  return inPage ? { token: inPage, from: `page input (popup gave HTTP ${res.status}, no token)` } : null;
}

async function switchPincode(p: ProductRef, pin: string): Promise<unknown> {
  const res = await fetch(ADDRESS_CHANGE, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "anti-csrftoken-a2z": p.session?.csrf ?? "", "x-requested-with": "XMLHttpRequest" },
    body: JSON.stringify({ locationType: "LOCATION_INPUT", zipCode: pin, deviceType: "web", storeContext: "generic", pageType: "Detail", actionSource: "glow" }),
  });
  if (res.status === 429 || res.status === 503) throw new RateLimitedError(Number(res.headers.get("Retry-After")) || null);
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    // Keep the start of a non-JSON answer: it shows what Amazon wanted instead.
    return { status: res.status, contentType: res.headers.get("content-type"), start: body.slice(0, 600) };
  }
}

export const amazon: Site = {
  id: "amazon",
  name: "Amazon",
  // Verified live on a real product page (Oct 2026); no longer beta.
  maxConcurrency: 1,
  note: "Switches your Amazon delivery pincode for each check and switches it back at the end.",

  productKey: (loc) => loc.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/)?.[1] ?? null,

  async resolve(loc, doc) {
    const asin = loc.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/)?.[1];
    if (!asin) return null;
    const csrf = await findCsrfToken(doc);
    if (!csrf) return null;
    const original = text(doc, "#glow-ingress-line2").match(PIN_RE)?.[0] ?? "";
    // The token itself stays in `session` (never logged); only where it came from goes in the log.
    return { id: asin, extra: { headerSource: csrf.from }, session: { csrf: csrf.token, original } };
  },

  async check(p, pin) {
    const change = await switchPincode(p, String(pin));
    const res = await fetch(`/dp/${p.id}?th=1&psc=1`, { credentials: "include" });
    if (res.status === 429 || res.status === 503) throw new RateLimitedError(null);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const page = readAmazonPage(doc);
    if (page.captcha) throw new RateLimitedError(null); // a CAPTCHA means "slow down": pause, then retry
    const result = parseAmazon(page, pin);
    return { ...result, raw: { addressChange: change, page } };
  },

  async finish(p) {
    // Put your own pincode back. If none was set before, Amazon keeps the last one checked.
    if (p.session?.original) await switchPincode(p, p.session.original).catch(() => undefined);
  },

  diagnose(doc) {
    return {
      hasGlow: !!doc.querySelector("#glow-ingress-line2"),
      hasHiddenFormKey: !!doc.querySelector('input[name="anti-csrftoken-a2z"]'),
      hasDeliverToConfig: !!doc.querySelector("#nav-global-location-data-modal-action[data-a-modal]"),
      deliverToConfigKeys: (() => {
        try {
          return Object.keys(JSON.parse(doc.querySelector("#nav-global-location-data-modal-action")?.getAttribute("data-a-modal") ?? "{}"));
        } catch {
          return "unreadable";
        }
      })(),
      hasDeliveryBlock: !!doc.querySelector("#mir-layout-DELIVERY_BLOCK"),
    };
  },
};
