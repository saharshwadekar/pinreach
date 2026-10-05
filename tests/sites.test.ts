import { describe, expect, test } from "bun:test";
import { siteFor } from "../src/sites";
import { firstSize, parseJioMartPrice } from "../src/sites/jiomart";
import serviceable from "./fixtures/jiomart-price-serviceable-411001.json";
import notServiceable from "./fixtures/jiomart-price-not-serviceable-744101.json";
import sizes from "./fixtures/jiomart-sizes-400001.json";

const loc = (url: string) => new URL(url) as unknown as Location;

describe("site registry", () => {
  test("picks the store by hostname", () => {
    expect(siteFor("www.flipkart.com")?.id).toBe("flipkart");
    expect(siteFor("www.jiomart.com")?.id).toBe("jiomart");
    expect(siteFor("www.example.com")).toBeNull();
  });

  test("Flipkart product pages, ignoring tracking parameters", () => {
    const fk = siteFor("www.flipkart.com")!;
    const a = fk.productKey(loc("https://www.flipkart.com/boat-airdopes-131/p/itm2905dfd0be40c?pid=ACCFSDGXX3S6DVBG&lid=X"));
    const b = fk.productKey(loc("https://www.flipkart.com/boat-airdopes-131/p/itm2905dfd0be40c?pid=ACCFSDGXX3S6DVBG&otracker=search"));
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(fk.productKey(loc("https://www.flipkart.com/search?q=airdopes"))).toBeNull();
  });

  test("JioMart product pages, both URL styles", () => {
    const jm = siteFor("www.jiomart.com")!;
    expect(jm.productKey(loc("https://www.jiomart.com/product/boat-airdopes-138-mfqi8b-7620739"))).toBe("boat-airdopes-138-mfqi8b-7620739");
    expect(jm.productKey(loc("https://www.jiomart.com/p/groceries/aashirvaad-atta-5-kg/606695220"))).toBe("p:606695220");
    expect(jm.productKey(loc("https://www.jiomart.com/c/groceries/2"))).toBeNull();
  });
});

// Real JioMart responses (boAt Airdopes 138), captured Oct 2026: see tests/fixtures.
describe("parseJioMartPrice (real responses)", () => {
  test("serviceable: price, seller and delivery date", () => {
    const r = parseJioMartPrice(200, serviceable);
    expect(r.status).toBe("deliverable");
    expect(r.price).toBe(799);
    expect(r.seller).toBe("Reliance Retail Limited");
    expect(r.detail).toMatch(/^Delivery by \w{3}, \d{1,2} \w{3}$/); // e.g. "Delivery by Tue, 6 Oct"
  });

  test("not serviceable: HTTP 400 with is_serviceable=false", () => {
    expect(parseJioMartPrice(400, notServiceable)).toEqual({ status: "not_deliverable" });
  });

  test("anything unexpected is unknown or error, never a false yes", () => {
    expect(parseJioMartPrice(404, { detail: "Not Found" }).status).toBe("unknown");
    expect(parseJioMartPrice(502, null).status).toBe("error");
    expect(parseJioMartPrice(200, { price: { effective: 10 } }).status).toBe("unknown"); // no explicit is_serviceable
  });

  test("finds the size code to check", () => {
    expect(firstSize(sizes)).toBe("OS");
    expect(firstSize({ sellable: false, sizes: [] })).toBeNull();
  });
});
