// Myntra and Amazon: product pages, Myntra's real recorded request/response, Amazon's page decision,
// and the size limit of the beta-store Copy log.
import { describe, expect, test } from "bun:test";
import { compactJson, redact, shrink } from "../src/lib/redact";
import { siteFor } from "../src/sites";
import { parseAmazon, type AmazonPage } from "../src/sites/amazon";
import { buildMyntraRequest, parseMyntra } from "../src/sites/myntra";
import myntraRequest from "./fixtures/myntra-v2-request-411045.json";
import myntraServiceable from "./fixtures/myntra-v2-response-serviceable-411045.json";

const loc = (url: string) => new URL(url) as unknown as Location;

describe("product pages", () => {
  test("Myntra: /<category>/<brand>/<name>/<styleId>/buy", () => {
    const s = siteFor("www.myntra.com")!;
    expect(s.experimental).toBeFalsy(); // verified live, out of beta
    expect(s.productKey(loc("https://www.myntra.com/tshirts/roadster/roadster-men-t-shirt/11545192/buy"))).toBe("11545192");
    expect(s.productKey(loc("https://www.myntra.com/men-tshirts"))).toBeNull();
  });

  test("Amazon: /dp/<ASIN> and /gp/product/<ASIN>, one check at a time", () => {
    const s = siteFor("www.amazon.in")!;
    expect(s.productKey(loc("https://www.amazon.in/boAt-Airdopes/dp/B0BX3ZLXSW/ref=sr_1_1"))).toBe("B0BX3ZLXSW");
    expect(s.productKey(loc("https://www.amazon.in/gp/product/B0BX3ZLXSW"))).toBe("B0BX3ZLXSW");
    expect(s.productKey(loc("https://www.amazon.in/s?k=airdopes"))).toBeNull();
    expect(s.maxConcurrency).toBe(1);
  });
});

// Myntra: real request/response recorded from Myntra's own product page (Sonata watch 30712420).
describe("Myntra (real recording)", () => {
  const watch = {
    id: "30712420",
    extra: {
      skuId: "98838612",
      sellerPartnerId: "4028",
      price: "1284",
      warehouses: JSON.stringify(["78567", "15774"]),
      procurement: "0",
      articleType: "Watches",
      launchDate: "",
      flags: JSON.stringify({ isHazmat: false, isLarge: false, isJewellery: false, isFragile: false, codEnabled: true, openBoxPickupEnabled: true, tryAndBuyEnabled: false, isReturnable: true }),
    },
  };

  test("builds exactly the request Myntra's page sends", () => {
    expect(buildMyntraRequest(watch, 411045, 1791225666215)).toEqual(myntraRequest);
  });

  test("serviceable: delivery date from the DELIVERY promiseDate", () => {
    const r = parseMyntra(200, myntraServiceable);
    expect(r.status).toBe("deliverable");
    expect(r.detail).toBe("Delivery by Tue, 13 Oct"); // promiseDate 1791860400000, in IST
  });

  test("not serviceable, and errors are never a false yes", () => {
    expect(parseMyntra(200, { serviceable: false, itemServiceabilityEntries: [{ serviceable: false }] }).status).toBe("not_deliverable");
    expect(parseMyntra(400, { code: 1001, message: "Invalid input" }).status).toBe("unknown");
    expect(parseMyntra(200, { message: "Delivery by tomorrow" }).status).toBe("unknown");
  });
});

describe("Amazon decision (sample page)", () => {
  const page = (p: Partial<AmazonPage>): AmazonPage => ({ shownLocation: "Deliver to Pune 411001", delivery: "", availability: "", undeliverable: false, addToCart: false, captcha: false, ...p });

  test("deliverable when the page shows the new pincode, a delivery date and Add to Cart", () => {
    const r = parseAmazon(page({ delivery: "FREE delivery Monday, 12 October. Details", addToCart: true, price: 1299 }), 411001);
    expect(r).toMatchObject({ status: "deliverable", detail: "FREE delivery Monday, 12 October", price: 1299 });
  });
  test("Amazon's own undeliverable box wins", () => {
    expect(parseAmazon(page({ undeliverable: true, addToCart: true, delivery: "FREE delivery Monday" }), 411001).status).toBe("not_deliverable");
    expect(parseAmazon(page({ delivery: "This item cannot be shipped to your selected delivery location." }), 411001).status).toBe("not_deliverable");
  });
  test("never trusts a page still showing another pincode", () => {
    const r = parseAmazon(page({ shownLocation: "Deliver to Mumbai 400001", delivery: "FREE delivery Monday", addToCart: true }), 411001);
    expect(r).toMatchObject({ status: "unknown", detail: "Location didn't switch" });
  });
  test("out of stock", () => expect(parseAmazon(page({ availability: "Currently unavailable." }), 411001).detail).toBe("Out of stock"));
});

describe("Copy log redaction", () => {
  test("hides secrets and personal details, keeps delivery data", () => {
    const out = redact({ csrfToken: "abc", sessionId: "s1", userEmail: "x@y.com", phone: "9876543210", pincode: "411001", note: "call 9876543210 or mail me@ex.com", delivery: "FREE delivery Monday" }) as Record<string, string>;
    expect(out.csrfToken).toBe("[redacted]");
    expect(out.sessionId).toBe("[redacted]");
    expect(out.userEmail).toBe("[redacted]");
    expect(out.phone).toBe("[redacted]");
    expect(out.note).toBe("call [phone] or mail [email]");
    expect(out.pincode).toBe("411001");
    expect(out.delivery).toBe("FREE delivery Monday");
  });
});

describe("Copy log size", () => {
  // A huge recording, like 60 store API calls with full product data.
  const bigResponse = { products: Array.from({ length: 500 }, (_, i) => ({ id: i, name: "x".repeat(2000), tags: Array(50).fill("tag") })) };
  const report = { site: "example", entries: Array.from({ length: 60 }, () => ({ url: "/api/v1/products", responseBody: bigResponse })) };

  test("stays under the limit and on one line", () => {
    const text = compactJson(report, 30000);
    expect(text.length).toBeLessThanOrEqual(30000 + 10);
    expect(text.includes("\n")).toBe(false);
  });

  test("keeps the shape: first items, with a note of how many were cut", () => {
    const out = shrink({ list: [1, 2, 3, 4, 5, 6], text: "a".repeat(50) }, { depth: 5, items: 3, chars: 10 }) as { list: unknown[]; text: string };
    expect(out.list).toEqual([1, 2, 3, "…[+3 more]"]);
    expect(out.text).toBe("aaaaaaaaaa…[+40 chars]");
  });
});
