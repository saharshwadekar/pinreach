import type { CheckResult } from "../lib/types";

export type SiteId = "flipkart" | "jiomart" | "myntra" | "amazon";

/**
 * What a site needs to check one product: its id plus any site-specific details.
 * `session` holds short-lived or sensitive values (e.g. a security token): never cached or logged.
 */
export type ProductRef = { id: string; extra?: Record<string, string>; session?: Record<string, string> };

/**
 * One store. Everything else (cities, saved addresses, nearest-first search, panel)
 * is shared, so adding a store means writing just these four functions.
 */
export interface Site {
  id: SiteId;
  name: string;
  /** A stable key for the product on this URL, or null when it isn't a product page. */
  productKey(loc: Location): string | null;
  /** Works out what to check. Called once, when the user clicks the button. */
  resolve(loc: Location, doc: Document): Promise<ProductRef | null>;
  /** Checks one pincode. Throws RateLimitedError when the store asks us to slow down. */
  check(product: ProductRef, pin: number, debug: boolean): Promise<CheckResult>;

  /** Not yet verified against live responses: the panel shows a badge and a "Copy log" button. */
  experimental?: boolean;
  /** Upper limit on parallel checks (Amazon must go one at a time). */
  maxConcurrency?: number;
  /** One line shown in the panel, e.g. that Amazon switches your pincode and restores it. */
  note?: string;
  /** Called after every run, even a cancelled one (Amazon restores your pincode here). */
  finish?(product: ProductRef): Promise<void>;
  /** What the page looked like, for the log when a product can't be identified. */
  diagnose?(doc: Document): unknown;
}
