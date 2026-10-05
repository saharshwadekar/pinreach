# 📍 PinReach

**Found the best deal but it says "Not deliverable at your location"?**
PinReach shows where it *can* be delivered, with the delivery date and price, so you can send it to a relative, friend or office and pick it up later without missing the deal.

Works on **Flipkart**, **JioMart**, **Myntra** and **Amazon**, all verified live. On a product page, click **📍 Where can I get this?** and PinReach checks:

1. **Saved addresses**: parents, relatives, friends, office, hostel. These are the most reliable results.
2. **Favourite cities**: always checked, whatever the stop setting.
3. **174 cities, nearest first**: metros, state capitals and Tier-2/3 cities, in **batches of the nearest 20**. A run stops when **5 are found** or **the batch ends**, whichever comes first. **Find next 5** and **Search next 20 cities** continue from there.

Each place that delivers shows the **delivery date and the price there**. A place that costs more than the cheapest one found is flagged, for example `₹1,099 +₹100`.

> **Cities are checked at one central pincode** (Mumbai is checked as 400001) and are marked "(central)". Your relative's exact pincode in that city may be served differently, so add it as a saved address to be sure.

Your own pincode is **not** checked, because the store already shows whether it delivers to you. It is only used to sort cities by distance. **Use my current location** (◎) gives exact distances. Otherwise distances are estimated from your pincode's area and shown as `~117 km`.

## Install (no build needed)

1. Unzip `release/pinreach-1.0.0.zip`.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
3. Click the PinReach toolbar icon, set your pincode (or ◎ for your location), and add saved addresses and favourite cities.

## Build from source

Requires [Bun](https://bun.sh).

```sh
bun install
bun run build        # builds dist/
```

Then in Chrome or Edge:
1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**
2. Click **Load unpacked** and select the `dist/` folder
3. Click the PinReach toolbar icon, then set your pincode (or ◎) and add saved addresses

## Scripts

| Command | What it does |
|---|---|
| `bun run build` | Bundle the extension into `dist/` |
| `bun run watch` | Rebuild on every change in `src/` |
| `bun test` | Run unit tests |
| `bun run typecheck` | TypeScript check |
| `bun run icons` | Regenerate the toolbar icons |

## How it works

- `src/sites/`: one small module per store, behind a shared `Site` interface (`productKey`, `resolve`, `check`). Each module reads only explicit fields from the store (deliverable or not, delivery date, price, seller) and never guesses from page text. Real responses are kept in `tests/fixtures/`.
  - `flipkart.ts`: the serviceability API behind Flipkart's pincode box.
  - `jiomart.ts`: JioMart's storefront API (Fynd platform). The pincode goes in an `x-location-detail` header, and one price call per pincode returns `is_serviceable`, the delivery promise, price and seller.
  - `myntra.ts`: the same `serviceability/check` request Myntra's product page sends (built from the page's own product data), returning `serviceable` and the delivery `promiseDate`.
  - `amazon.ts`: switches the session's "Deliver to" pincode (two-step token, like Amazon's own popup), reads the product page's delivery box, and restores your pincode after the run.
- `src/lib/planner.ts`: decides what to check and in what order: saved, then favourites, then cities sorted by distance.
- `src/lib/scheduler.ts`: the fast nearest-first search (see below).
- `src/data/major-cities.ts`: the 174 cities. All pincodes are checked against the India Post / GeoNames directory.
- `src/data/pin-prefix.ts`: the centre of each 3-digit pincode area (7 KB, built in), used to estimate distance from any pincode.
- `src/content/panel.ts`: the floating panel, the same for every store. `src/content/main.ts` picks the store by hostname. You can drag it, and it follows the page's light or dark look.

### Adding a store

1. Write `src/sites/<store>.ts` exporting a `Site`. Verify it against live responses and save them in `tests/fixtures/`.
2. Register its hostname in `src/sites/index.ts`.
3. Add the hostname to `content_scripts.matches` and `host_permissions` in `src/manifest.json`.

While a new store is unverified, set `experimental: true` on its `Site`. Its panel then shows a **Beta** badge and a **Copy log** button: a compact (at most ~30 KB), redacted log of what the store answered, and it skips the cache so every run logs fresh answers.

To capture a new store's real responses, use `tools/capture-console.js`. Paste it into the DevTools console on a product page, use the store's own pincode box twice (a pincode that delivers and one that doesn't), then run `copy(PinReachCapture.dump())`. Cookies, tokens and session values are redacted, and nothing is sent anywhere.

### Fast nearest-first search

- **Nearest first, exact:** a fast answer for a far city never beats a slower, nearer one. Once the K nearest are found, nothing farther is requested.
- **Batches:** a run never goes past the current batch of cities, so "nothing deliverable nearby" ends quickly.
- **Parallel:** 2 requests at a time by default (1 to 3 in Settings). The first request runs alone.
- **Adapts to the store:** on HTTP 429 every worker pauses together, with a visible countdown (30 s, then 60 s, then 2 min, or Flipkart's `Retry-After`). The same city is retried and parallelism drops to 1. After a calm streak, the delay shortens and parallel workers come back one by one.
- **Cache:** answers are kept for 3 hours, one storage entry per result (safe under parallel writes), so Continue and Find more never re-check a city.

## Privacy and safety

- **Flipkart and JioMart checks are anonymous:** sent without your cookies, so they never touch your account, cart or saved delivery location.
- **Myntra checks use your Myntra session** (Myntra expects it), but are read-only: nothing in your account changes.
- **Amazon checks use your Amazon session** and temporarily switch your "Deliver to" pincode, one check at a time, switching it back at the end of the run.
- **Nothing leaves your browser** except those requests to the store you're on. Your pincode, location, addresses and results stay in `chrome.storage.local`.
- **No requests while browsing:** the product is identified only when you click the button.

## Debugging

If a result looks wrong, turn on **Settings → Debug logs** in the popup, then open DevTools on the product page and look for `[PinReach]` logs. Each one is the raw store response for one pincode. The parser in `src/sites/<store>.ts` is the only place that interprets it.

## Known limits

- **Amazon switches your Amazon delivery pincode** for each check, one at a time, and switches it back at the end of the run (even if stopped). Closing the tab mid-run can leave the last checked pincode set.
- **JioMart groceries are served by local stores,** so they are often available in one city and not the next. That is real, not a bug. Old JioMart links (`/p/groceries/…/<number>`) work only if the page links to the current `/product/…` page.
- **One seller:** PinReach checks the listing shown on the page (or Flipkart's default seller). Another seller on the same product might deliver where this one doesn't.
- **Undocumented APIs:** every store can change its API without notice. When that happens, turn on Debug logs to see the raw answers, and compare them with the fixtures in `tests/fixtures/`.

## Roadmap

- [x] Flipkart, JioMart, Myntra, Amazon.in
- [ ] Meesho (its website's pincode check could not be found; parked)
- [ ] Check other sellers of the same product
- [ ] Alert when a deal goes live and is deliverable to a saved address
- [ ] Map view of deliverable areas
