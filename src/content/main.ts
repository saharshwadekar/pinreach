import { siteFor } from "../sites";
import { Panel } from "./panel";

// Stores are single-page apps, so watch for URL changes instead of relying on page loads.
// The product is identified only when the user clicks, so browsing costs no requests.
const site = siteFor(location.hostname);
let panel: Panel | null = null;
let lastKey: string | null = null;

function sync() {
  const key = site?.productKey(location) ?? null;
  if (key === lastKey) return;
  lastKey = key;
  panel?.destroy();
  panel = site && key ? new Panel(site) : null;
}

if (site) {
  sync();
  setInterval(sync, 1000);
}
