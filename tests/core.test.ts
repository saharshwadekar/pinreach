import { describe, expect, test } from "bun:test";
import { approxCity, approxLocation, MAJOR_CITIES } from "../src/data/major-cities";
import { distanceKm } from "../src/lib/geo";
import { parseServiceability } from "../src/sites/flipkart";
import deliverable from "./fixtures/svc-deliverable-411001.json";
import notDeliverable from "./fixtures/svc-not-deliverable-194101.json";
import notOnSale from "./fixtures/svc-not-on-sale.json";
import { homePosition, limitToBatch, planChecks } from "../src/lib/planner";
import { DEFAULT_SETTINGS } from "../src/lib/types";

describe("major cities", () => {
  test("174 cities with unique pincodes inside India", () => {
    expect(MAJOR_CITIES.length).toBe(174);
    expect(new Set(MAJOR_CITIES.map((c) => c.pin)).size).toBe(174);
    expect(new Set(MAJOR_CITIES.map((c) => c.city)).size).toBe(174);
    for (const c of MAJOR_CITIES) {
      expect(c.lat).toBeWithin(6, 37.5);
      expect(c.lng).toBeWithin(68, 97.5);
    }
  });

  test("locates any pincode by its 3-digit area, then names the nearest city", () => {
    expect(approxCity(411057)!.city).toBe("Pune");
    expect(approxCity(560102)!.city).toBe("Bengaluru");
    expect(approxCity(413512)!.city).toBe("Latur"); // a city's own pincode is exact
    expect(approxCity(413705)!.city).toBe("Solapur"); // area "413" centre is nearest Solapur
    expect(approxCity(140001)!.city).toBe("Mohali"); // Ropar area, next to Mohali (not "numerically closest")
    expect(approxLocation(999999)).toBeNull();
  });
});

describe("geo", () => {
  test("Mumbai → Pune is roughly 120 km", () => {
    const d = distanceKm(18.94, 72.835, 18.52, 73.857);
    expect(d).toBeWithin(100, 140);
  });
});

describe("planner", () => {
  const base = { ...DEFAULT_SETTINGS, homePin: 411057, saved: [{ label: "Mom & Dad", pin: 422001 }] };
  const plan = planChecks(base);

  test("orders groups saved → cities, and never checks the home pincode", () => {
    expect(plan[0]!.group).toBe("saved");
    expect(plan.slice(1).every((i) => i.group === "city")).toBe(true);
    expect(plan.some((i) => i.pin === 411057)).toBe(false);
  });

  test("skips a city whose pincode is the home pincode", () => {
    const p = planChecks({ ...DEFAULT_SETTINGS, homePin: 411001 });
    expect(p.some((i) => i.pin === 411001)).toBe(false);
    expect(p.length).toBe(173);
  });

  test("checks all cities by default, nearest first, without repeating saved pincodes", () => {
    const cities = plan.filter((i) => i.group === "city");
    expect(cities.length).toBe(173); // Nashik 422001 is already a saved address
    expect(cities[0]!.label).toBe("Pune");
    const d = cities.map((c) => c.distanceKm!);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });

  test("respects a city limit", () => {
    const p = planChecks({ ...base, maxCities: 5 });
    expect(p.filter((i) => i.group === "city").map((i) => i.label)).toEqual(["Pune", "Navi Mumbai", "Kalyan", "Ahmednagar", "Mumbai"]);
  });

  test("uses exact location when shared", () => {
    const pos = homePosition({ ...base, homeLat: 28.6, homeLng: 77.2 })!;
    expect(pos.exact).toBe(true);
    const first = planChecks({ ...base, homeLat: 28.6, homeLng: 77.2 }).find((i) => i.group === "city")!;
    expect(first.label).toBe("Delhi");
  });

  test("favourite cities come right after saved addresses, nearest first, and are not repeated", () => {
    const p = planChecks({ ...base, favCities: [700001, 400001] }); // Kolkata, Mumbai
    expect(p.map((i) => i.group).slice(0, 3)).toEqual(["saved", "favorite", "favorite"]);
    expect(p.filter((i) => i.group === "favorite").map((i) => i.label)).toEqual(["Mumbai", "Kolkata"]);
    expect(p.filter((i) => i.pin === 400001).length).toBe(1);
  });

  test("batches keep saved + favourites and only the nearest N cities", () => {
    const full = planChecks({ ...base, favCities: [700001] });
    const first = limitToBatch(full, 20);
    expect(first.items.filter((i) => i.group === "city").length).toBe(20);
    expect(first.items.filter((i) => i.group !== "city").map((i) => i.group)).toEqual(["saved", "favorite"]);
    expect(first.citiesLeft).toBe(full.filter((i) => i.group === "city").length - 20);
    // The next batch is a superset: the same 20 nearest, then the next 20.
    const second = limitToBatch(full, 40);
    expect(second.items.slice(0, first.items.length)).toEqual(first.items);
    expect(limitToBatch(full, 500).citiesLeft).toBe(0);
  });

  test("never repeats a pincode", () => {
    const pins = plan.map((i) => i.pin);
    expect(new Set(pins).size).toBe(pins.length);
  });
});

// Real Flipkart responses (boAt Airdopes 131), captured Oct 2026: see tests/fixtures.
describe("parseServiceability (real responses)", () => {
  test("deliverable: date, price and seller", () => {
    expect(parseServiceability(deliverable, "ACCFSDGXX3S6DVBG")).toEqual({
      status: "deliverable",
      detail: "Delivery by 10 Oct, Saturday",
      price: 999,
      seller: "ExcelsiorRetail",
    });
  });

  test("not deliverable: serviceable=false, price still known", () => {
    expect(parseServiceability(notDeliverable, "ACCFSDGXX3S6DVBG")).toEqual({ status: "not_deliverable", price: 999, seller: "ExcelsiorRetail" });
  });

  test("product not on sale has no listing: unknown, never a false answer", () => {
    expect(parseServiceability(notOnSale, "MOBGTAGPTB3VS24W").status).toBe("unknown");
  });

  test("out of stock is not deliverable", () => {
    const r = parseServiceability({ RESPONSE: { P: { listingSummary: { available: false, serviceable: true } } } }, "P");
    expect(r.status).toBe("not_deliverable");
  });

  test("a response for a different product is never trusted", () => {
    expect(parseServiceability(deliverable, "SOMETHINGELSE000").status).toBe("unknown");
  });

  test("text like \"Delivery by\" elsewhere in the response cannot cause a false yes", () => {
    const tricky = { RESPONSE: { P: { titles: { title: "Delivery by Tomorrow Charger" }, listingSummary: { serviceable: false } } } };
    expect(parseServiceability(tricky, "P").status).toBe("not_deliverable");
  });
});
