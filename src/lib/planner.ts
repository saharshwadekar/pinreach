import { approxCity, approxLocation, MAJOR_CITIES } from "../data/major-cities";
import { distanceKm } from "./geo";
import type { CheckItem, Settings } from "./types";

export type HomePosition = { lat: number; lng: number; exact: boolean; nearCity: string | null };

/** Exact position when the user shared their location, otherwise estimated from the pincode prefix. */
export function homePosition(s: Settings): HomePosition | null {
  if (s.homeLat != null && s.homeLng != null) return { lat: s.homeLat, lng: s.homeLng, exact: true, nearCity: null };
  const loc = s.homePin ? approxLocation(s.homePin) : null;
  return loc ? { ...loc, exact: false, nearCity: approxCity(s.homePin!)?.city ?? null } : null;
}

const round = (km: number) => Math.round(km);

/**
 * Builds the ordered list of pincodes to check: saved addresses → favourite cities → other cities, nearest first.
 * Saved and favourite places come first, so the scheduler always checks them before it can stop early.
 * The home pincode itself is never checked (Flipkart already shows whether it delivers
 * there); it is only used to sort cities by distance.
 */
export function planChecks(s: Settings): CheckItem[] {
  const items: CheckItem[] = [];
  const seen = new Set<number>(s.homePin ? [s.homePin] : []);
  const add = (item: CheckItem) => {
    if (seen.has(item.pin)) return;
    seen.add(item.pin);
    items.push(item);
  };

  const home = homePosition(s);

  for (const a of s.saved) {
    const c = approxCity(a.pin);
    add({ pin: a.pin, group: "saved", label: a.label, place: c ? `near ${c.city}` : "", distanceKm: null });
  }

  const approx = home ? !home.exact : false;
  const cities = home
    ? MAJOR_CITIES.map((c) => ({ c, d: distanceKm(home.lat, home.lng, c.lat, c.lng) as number | null })).sort((a, b) => a.d! - b.d!)
    : MAJOR_CITIES.map((c) => ({ c, d: null as number | null }));
  const km = (d: number | null) => (d === null ? null : round(d));

  const favs = new Set(s.favCities);
  for (const { c, d } of cities.filter(({ c }) => favs.has(c.pin))) {
    add({ pin: c.pin, group: "favorite", label: c.city, place: "", distanceKm: km(d), approx });
  }

  const limit = s.maxCities > 0 ? s.maxCities : cities.length;
  for (const { c, d } of cities.filter(({ c }) => !seen.has(c.pin)).slice(0, limit)) {
    add({ pin: c.pin, group: "city", label: c.city, place: "", distanceKm: km(d), approx });
  }

  return items;
}

/**
 * Limits a plan to the nearest `cityLimit` regular cities. Saved addresses and favourite
 * cities are always kept. This is the hard break that stops a run even when nothing is found.
 */
export function limitToBatch(plan: CheckItem[], cityLimit: number): { items: CheckItem[]; citiesLeft: number } {
  const cities = plan.filter((i) => i.group === "city");
  return {
    items: [...plan.filter((i) => i.group !== "city"), ...cities.slice(0, cityLimit)],
    citiesLeft: Math.max(0, cities.length - cityLimit),
  };
}
