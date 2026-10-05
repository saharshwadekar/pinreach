export type SavedAddress = { label: string; pin: number };

export type Theme = "auto" | "light" | "dark";

export type Settings = {
  homePin: number | null;
  homeLat: number | null; // set by "Use my current location" for exact distances
  homeLng: number | null;
  saved: SavedAddress[];
  favCities: number[]; // pincodes of favourite cities: always checked, whatever stopAfterHits says
  theme: Theme;
  position: { right: number; bottom: number } | null; // where the button was dragged to
  maxCities: number; // how many major cities to check, nearest first (0 = all)
  stopAfterHits: number; // stop once this many nearest deliverable cities are found (0 = don't stop on hits)
  batchSize: number; // cities per batch: a run never checks past the current batch, found or not
  concurrency: number; // parallel requests (drops to 1 automatically if Flipkart rate-limits)
  delayMs: number; // starting pause between requests per worker; adapts at runtime
  debug: boolean; // log raw responses to the page console
};

export const DEFAULT_SETTINGS: Settings = {
  homePin: null,
  homeLat: null,
  homeLng: null,
  saved: [],
  favCities: [],
  theme: "auto",
  position: null,
  maxCities: 0,
  stopAfterHits: 5,
  batchSize: 20,
  concurrency: 2,
  delayMs: 500,
  debug: false,
};

export type Group = "saved" | "favorite" | "city";

export type CheckItem = {
  pin: number;
  group: Group;
  label: string; // "Mom & Dad" / "Mumbai"
  place: string; // "near Pune" / "Major city"
  distanceKm: number | null; // from home
  approx?: boolean; // distance estimated from the pincode prefix, not exact location
};

export type DeliveryStatus = "deliverable" | "not_deliverable" | "unknown" | "error";

export type CheckResult = {
  status: DeliveryStatus;
  detail?: string; // e.g. "Delivery by 10 Oct, Saturday" or an error message
  price?: number; // final price (₹) for that pincode
  seller?: string;
  raw?: unknown; // what the store answered; only for experimental stores' "Copy log", never cached
};
