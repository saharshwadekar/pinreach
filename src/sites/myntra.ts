import { RateLimitedError } from "../lib/scheduler";
import type { CheckResult } from "../lib/types";
import { jsonAfter } from "./fields";
import type { ProductRef, Site } from "./types";

// Myntra: the request below is the one Myntra's own product page sends (recorded Oct 2026, see
// tests/fixtures/myntra-*). Product pages: /<category>/<brand>/<name>/<styleId>/buy. The page
// embeds its data in `window.__myx = {...}`: sizes with skuId, and per seller the warehouses,
// price and procurement time; plus product flags and article type.
const SERVICEABILITY = "https://www.myntra.com/gateway/v2/serviceability/check";
const CLIENT_ID = "2297"; // Myntra web's own client id, as sent by its product page

type Seller = { sellerPartnerId?: number; discountedPrice?: number; warehouses?: string[]; procurementTimeInDays?: number };
type Size = { skuId?: number; available?: boolean; sizeSellerData?: Seller[] };
type Flags = Partial<Record<(typeof FLAG_KEYS)[number], boolean>>;

const FLAG_KEYS = ["isHazmat", "isLarge", "isJewellery", "isFragile", "codEnabled", "openBoxPickupEnabled", "tryAndBuyEnabled", "isReturnable"] as const;

function pdp(doc: Document): any {
  return jsonAfter(doc, "window.__myx")?.pdpData ?? null;
}

/** The exact request Myntra's product page sends, for one pincode. */
export function buildMyntraRequest(p: ProductRef, pin: number, now = Date.now()) {
  const e = p.extra ?? {};
  const flags: Flags = JSON.parse(e.flags || "{}");
  const price = Number(e.price) || 0;
  return {
    pincode: String(pin),
    clientReferenceId: `guest_${now}`,
    clientId: CLIENT_ID,
    consolidationEnabled: false,
    paymentMode: "ALL",
    serviceType: "FORWARD",
    shippingMethod: "ALL",
    nonWorkingDays: [],
    items: [
      {
        itemReferenceId: e.sellerPartnerId, // Myntra uses the seller id here, not the sku
        codValue: price,
        itemValue: price,
        isHazmat: !!flags.isHazmat,
        isLarge: !!flags.isLarge,
        isJewellery: !!flags.isJewellery,
        isFragile: !!flags.isFragile,
        codEnabled: !!flags.codEnabled,
        openBoxPickupEnabled: !!flags.openBoxPickupEnabled,
        tryAndBuyEnabled: !!flags.tryAndBuyEnabled,
        isReturnable: !!flags.isReturnable,
        procurementTimeInDays: Number(e.procurement) || 0,
        launchDate: e.launchDate ?? "",
        availableInWarehouses: JSON.parse(e.warehouses || "[]"),
        skuId: e.skuId,
        articleType: e.articleType ?? "",
      },
    ],
  };
}

type Entry = { serviceType?: string; promiseDate?: number };
type Response = { serviceable?: boolean; itemServiceabilityEntries?: { serviceable?: boolean; serviceabilityEntries?: Entry[] }[] };

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** Explicit fields only: the item's `serviceable` and the DELIVERY entry's `promiseDate`. */
export function parseMyntra(status: number, json: unknown): CheckResult {
  if (status >= 500) return { status: "error", detail: `HTTP ${status}`, raw: json };
  if (status !== 200) return { status: "unknown", detail: `HTTP ${status}`, raw: json };
  const r = (json ?? {}) as Response;
  const item = r.itemServiceabilityEntries?.[0];
  const ok = item?.serviceable ?? r.serviceable;
  if (ok === false) return { status: "not_deliverable", raw: json };
  if (ok !== true) return { status: "unknown", raw: json };
  const dates = (item?.serviceabilityEntries ?? [])
    .filter((x) => x.serviceType === "DELIVERY" && typeof x.promiseDate === "number")
    .map((x) => x.promiseDate!);
  return { status: "deliverable", detail: dates.length ? `Delivery by ${formatDate(Math.min(...dates))}` : "Deliverable", raw: json };
}

export const myntra: Site = {
  id: "myntra",
  name: "Myntra",
  // Verified live on a real product page (Oct 2026); no longer beta.

  productKey: (loc) => loc.pathname.match(/\/(\d{5,})\/buy\/?$/)?.[1] ?? null,

  async resolve(loc, doc) {
    const data = pdp(doc);
    const styleId = String(data?.id ?? loc.pathname.match(/\/(\d{5,})\/buy/)?.[1] ?? "");
    if (!styleId || !data) return null;
    const sizes: Size[] = data.sizes ?? [];
    // Any in-stock size works for a delivery check; prefer one with a seller listed.
    const size = sizes.find((s) => s.available && s.sizeSellerData?.length) ?? sizes.find((s) => s.sizeSellerData?.length);
    const seller = size?.sizeSellerData?.[0];
    if (!size?.skuId || !seller?.sellerPartnerId) return null;
    const flags = Object.fromEntries(FLAG_KEYS.map((k) => [k, !!data.flags?.[k]]));
    return {
      id: styleId,
      extra: {
        skuId: String(size.skuId),
        sellerPartnerId: String(seller.sellerPartnerId),
        price: String(seller.discountedPrice ?? data.price?.discounted ?? ""),
        warehouses: JSON.stringify(seller.warehouses ?? []),
        procurement: String(seller.procurementTimeInDays ?? 0),
        articleType: String(data.analytics?.articleType ?? ""),
        launchDate: String(data.serviceability?.launchDate ?? ""),
        flags: JSON.stringify(flags),
      },
    };
  },

  async check(p, pin) {
    const res = await fetch(SERVICEABILITY, {
      method: "POST",
      credentials: "include", // Myntra gives every visitor (even logged out) a session it expects here
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-myntraweb": "Yes",
        "X-Requested-With": "browser",
        "x-meta-app": "channel=web",
        "x-location-context": `pincode=${pin};source=USER`,
      },
      body: JSON.stringify(buildMyntraRequest(p, pin)),
    });
    if (res.status === 429) throw new RateLimitedError(Number(res.headers.get("Retry-After")) || null);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = { nonJson: true };
    }
    const price = Number(p.extra?.price) || undefined;
    return { ...parseMyntra(res.status, json), ...(price && { price }) };
  },

  diagnose(doc) {
    const data = pdp(doc);
    const size = data?.sizes?.[0];
    return { hasMyx: !!jsonAfter(doc, "window.__myx"), hasPdpData: !!data, sizes: data?.sizes?.length ?? 0, sellers: size?.sizeSellerData?.length ?? 0 };
  },
};
