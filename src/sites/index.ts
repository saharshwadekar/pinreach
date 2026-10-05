import { amazon } from "./amazon";
import { flipkart } from "./flipkart";
import { jiomart } from "./jiomart";
import { myntra } from "./myntra";
import type { Site } from "./types";

/** Supported stores by hostname. Add a store here and to manifest.json. */
const SITES: Record<string, Site> = {
  "www.flipkart.com": flipkart,
  "www.jiomart.com": jiomart,
  "www.myntra.com": myntra,
  "www.amazon.in": amazon,
};

export const siteFor = (hostname: string): Site | null => SITES[hostname] ?? null;
export const SUPPORTED = [...new Set(Object.values(SITES).map((s) => (s.experimental ? `${s.name} (beta)` : s.name)))];
