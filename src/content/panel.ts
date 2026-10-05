import type { ProductRef, Site } from "../sites/types";
import { RateLimitedError, runQueue } from "../lib/scheduler";
import { getCached, getSettings, pruneCache, putCached, saveSettings } from "../lib/storage";
import { limitToBatch, planChecks } from "../lib/planner";
import type { CheckItem, CheckResult, Theme } from "../lib/types";
import { compactJson, redact } from "../lib/redact";
import { PANEL_CSS } from "./panel-css";

const TIPS = ["Delivery OTP comes to your phone", "Pay online, not cash on delivery", "Returns and installation happen at that address"];
const TAGS = { saved: "Saved", favorite: "Favourite", city: "" } as const;

/** Wait times after each rate-limit in a run; after the last one we give up. */
const BACKOFF_SEC = [30, 60, 120];

/** Placeholder cards shown while checking: a fixed count, so the layout never jumps. */
const SKELETON_CARDS = 2;
const skeletons = (n = SKELETON_CARDS) => Array.from({ length: n }, () => `<li class="skel" aria-hidden="true"><span></span><span></span></li>`).join("");
const loadingBody = `<h4>Available at</h4><ul class="found" aria-busy="true">${skeletons()}</ul>`;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const km = (i: CheckItem) => (i.distanceKm === null ? "" : i.distanceKm < 1 ? "< 1 km" : `${i.approx ? "~" : ""}${i.distanceKm} km`);

/** "auto" follows the page (stores are light), not the OS, so the panel never clashes with the site. */
function pageIsDark(): boolean {
  const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number);
  if (!m || m.length < 3 || m[3] === 0) return false; // transparent body: assume a light page
  const [r, g, b] = m as [number, number, number];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
}

export class Panel {
  private host = document.createElement("div");
  private root = this.host.attachShadow({ mode: "open" });
  private $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
  private product: ProductRef | null = null; // resolved on first use, so idle pages cost nothing
  private runId = 0;
  private target = 0; // how many nearest deliverable cities the current run looks for
  private cityLimit = 0; // how many of the nearest cities are in scope (grows one batch at a time)
  private missesOpen = false; // keep "Not available" expanded across re-renders
  private copied: number | null = null; // pincode whose Copy button shows "Copied"
  private lastHtml = "";
  private log: object[] = []; // raw store answers, for experimental stores' "Copy log"

  constructor(private site: Site) {
    this.host.id = "pinreach-root";
    this.root.innerHTML = `<style>${PANEL_CSS}</style>
      <div class="card collapsed">
        <button class="fab" title="Drag to move">📍 Where can I get this?</button>
        <div class="panel">
          <header title="Drag to move">
            <b>PinReach</b>${site.experimental ? `<span class="beta" title="${site.name} support is new: results may be wrong. Use Copy log to report.">Beta</span>` : ""}<span class="status"></span>
            <button class="icon-btn close" title="Close">✕</button>
          </header>
          <div class="progress"><i></i></div>
          <div class="bar" hidden>
            <span class="bar-text"></span><button class="resume">Resume</button><button class="stop">Stop</button>
          </div>
          <div class="body"></div>
          <div class="foot">
            ${site.note ? `<p class="note">${site.note}</p>` : ""}
            <div class="actions"><button class="primary" hidden></button>${site.experimental ? `<button class="ghost-btn copylog" title="Copies what ${site.name} answered, with personal details hidden">Copy log</button>` : ""}</div>
            <details class="tips"><summary>Ordering to someone else's address?</summary><ul>${TIPS.map((t) => `<li>${t}</li>`).join("")}</ul></details>
          </div>
        </div>
      </div>`;
    const card = this.$(".card");
    this.$(".fab").addEventListener("click", () => {
      if (card.dataset.dragged) return void delete card.dataset.dragged;
      card.classList.remove("collapsed");
      void this.run();
    });
    this.$(".close").addEventListener("click", () => {
      this.runId++; // stops an in-flight run
      card.classList.add("collapsed");
    });
    this.makeDraggable(card);
    // Beta stores only: a compact, redacted log of what the store answered, for fixing it.
    this.root.querySelector(".copylog")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const report = {
        pinreach: chrome.runtime.getManifest().version,
        site: this.site.id,
        page: location.origin + location.pathname,
        product: this.product && { id: this.product.id, extra: this.product.extra },
        pageData: this.site.diagnose?.(document),
        // Raw answers for the first 5 checks are enough to diagnose; the rest keep just the result.
        entries: this.log.map((e, i) => (i < 5 ? e : { ...e, raw: undefined })),
      };
      const text = compactJson(redact(report), 30000);
      await navigator.clipboard.writeText(text);
      btn.textContent = `Copied ${Math.ceil(text.length / 1024)} KB (${this.log.length} checks)`;
      setTimeout(() => (btn.textContent = "Copy log"), 2500);
    });
    // The theme is chosen in the toolbar popup only; follow it live.
    chrome.storage.onChanged.addListener(this.onSettingsChanged);
    void getSettings().then((s) => {
      this.applyTheme(s.theme);
      if (s.position) this.place(card, s.position.right, s.position.bottom);
    });
    document.body.appendChild(this.host);
  }

  destroy() {
    this.runId++;
    chrome.storage.onChanged.removeListener(this.onSettingsChanged);
    this.host.remove();
  }

  private onSettingsChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const theme = (changes.settings?.newValue as { theme?: Theme } | undefined)?.theme;
    if (area === "local" && theme) this.applyTheme(theme);
  };

  private applyTheme(theme: Theme) {
    this.$(".card").dataset.theme = theme === "auto" ? (pageIsDark() ? "dark" : "light") : theme;
  }

  private place(card: HTMLElement, right: number, bottom: number) {
    const r = Math.min(Math.max(0, right), innerWidth - 80);
    const b = Math.min(Math.max(0, bottom), innerHeight - 50);
    card.style.right = `${r}px`;
    card.style.bottom = `${b}px`;
    card.style.setProperty("--room", `${innerHeight - b - 16}px`); // the panel never grows off-screen
    return { right: r, bottom: b };
  }

  /** Drag the button or the panel header so it never covers part of the page you need. */
  private makeDraggable(card: HTMLElement) {
    for (const handle of [this.$(".fab"), this.$("header")]) {
      handle.addEventListener("pointerdown", (down: PointerEvent) => {
        if ((down.target as HTMLElement).closest(".icon-btn") || down.button !== 0) return;
        const rect = card.getBoundingClientRect();
        const start = { x: down.clientX, y: down.clientY, right: innerWidth - rect.right, bottom: innerHeight - rect.bottom };
        let pos: { right: number; bottom: number } | null = null;
        const move = (e: PointerEvent) => {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (!pos && Math.hypot(dx, dy) < 5) return; // a click, not a drag
          pos = this.place(card, start.right - dx, start.bottom - dy);
        };
        const up = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", up);
          if (!pos) return;
          card.dataset.dragged = "1"; // swallow the click that follows a drag
          setTimeout(() => delete card.dataset.dragged, 0);
          void saveSettings({ position: pos });
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
      });
    }
  }

  private set status(text: string) {
    this.$(".status").textContent = text;
  }

  /** The single primary button under the results ("Find next 5"). */
  private showAction(label: string | null, onClick?: () => void) {
    const btn = this.$<HTMLButtonElement>(".primary");
    btn.hidden = !label;
    btn.textContent = label ?? "";
    btn.onclick = onClick ? () => ((btn.hidden = true), onClick()) : null;
  }

  /** The notice bar under the header, with an optional action and Stop button. */
  private showBar(html: string | null, action?: string, onAction?: () => void, onStop?: () => void) {
    const bar = this.$(".bar");
    const resume = this.$<HTMLButtonElement>(".resume");
    const stop = this.$<HTMLButtonElement>(".stop");
    bar.hidden = html === null;
    if (html === null) return;
    this.$(".bar-text").innerHTML = html;
    resume.hidden = !action;
    resume.textContent = action ?? "";
    resume.onclick = onAction ?? null;
    stop.hidden = !onStop;
    stop.onclick = onStop ?? null;
  }

  /**
   * Shows a countdown and waits it out. Resolves true to continue, false if the user
   * pressed Stop or the run was cancelled (panel closed / page changed).
   */
  private waitOut(seconds: number, attempt: number, id: number): Promise<boolean> {
    const until = Date.now() + seconds * 1000;
    return new Promise((resolve) => {
      const finish = (go: boolean) => {
        clearInterval(timer);
        this.showBar(null);
        resolve(go);
      };
      const tick = () => {
        if (id !== this.runId) return finish(false);
        const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        this.showBar(`${this.site.name} asked us to slow down. Resuming in <b>${clock(left)}</b>`, "Resume", () => finish(true), () => finish(false));
        this.status = `Paused ${attempt}/${BACKOFF_SEC.length}`;
        if (left === 0) finish(true);
      };
      const timer = setInterval(tick, 250);
      tick();
    });
  }

  private setBody(html: string) {
    if (html === this.lastHtml) return; // no flicker when nothing visible changed
    this.lastHtml = html;
    this.$(".body").innerHTML = html;
  }

  private askHomePin() {
    this.status = "";
    this.setBody(`<p class="sub" style="margin-top:10px">Your pincode, to find the nearest cities:</p>
      <form class="setup">
        <input name="pin" inputmode="numeric" maxlength="6" placeholder="411001" required pattern="[1-9][0-9]{5}">
        <button>Start</button>
      </form>`);
    this.$("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveSettings({ homePin: Number(new FormData(e.target as HTMLFormElement).get("pin")) });
      void this.run();
    });
  }

  /** Deliverable places are highlighted at the top; everything else is folded away. */
  private render(items: CheckItem[], results: Map<number, CheckResult>, finished: boolean) {
    const hits = items.filter((i) => results.get(i.pin)?.status === "deliverable");
    const misses = items.filter((i) => results.has(i.pin) && results.get(i.pin)!.status !== "deliverable");
    this.$(".progress i").style.width = `${(results.size / Math.max(1, items.length)) * 100}%`;

    // Prices can differ by pincode: flag any place that costs more than the cheapest one found.
    const prices = hits.map((i) => results.get(i.pin)!.price).filter((p): p is number => p !== undefined);
    const best = prices.length ? Math.min(...prices) : undefined;

    const hitRows = hits
      .map((i) => {
        const r = results.get(i.pin)!;
        const pin = i.group === "city" ? `${i.pin} (central)` : String(i.pin);
        const meta = [pin, km(i), r.detail].filter(Boolean).map((s) => esc(s!)).join(" · ");
        const tag = TAGS[i.group] ? `<span class="tag">${TAGS[i.group]}</span>` : "";
        const price =
          r.price === undefined
            ? ""
            : `<span class="price${best !== undefined && r.price > best ? " higher" : ""}">${rupees(r.price)}${
                best !== undefined && r.price > best ? ` <small>+${rupees(r.price - best)}</small>` : ""
              }</span>`;
        const copied = this.copied === i.pin;
        return `<li class="hit"${r.seller ? ` title="Sold by ${esc(r.seller)}"` : ""}>
          <div class="who"><b>${esc(i.label)}${tag}</b><small>${meta}</small></div>${price}
          <button class="copy" data-pin="${i.pin}">${copied ? "Copied" : "Copy"}</button></li>`;
      })
      .join("");

    const missNames = misses.map((i) => esc(i.label) + (results.get(i.pin)!.status === "not_deliverable" ? "" : " (?)")).join(", ");

    this.setBody(`
      <h4>Available at${hits.length ? ` · ${hits.length}` : ""}</h4>
      ${
        finished
          ? hits.length
            ? `<ul class="found">${hitRows}</ul>`
            : `<p class="empty">Not available in any place checked.</p>`
          : `<ul class="found" aria-busy="true">${hitRows}${skeletons()}</ul>`
      }
      ${misses.length ? `<details class="misses"${this.missesOpen ? " open" : ""}><summary>Not available · ${misses.length}</summary><p>${missNames}</p></details>` : ""}`);

    this.root.querySelector(".misses")?.addEventListener("toggle", (e) => (this.missesOpen = (e.target as HTMLDetailsElement).open));
    this.root.querySelectorAll<HTMLButtonElement>(".copy").forEach((b) =>
      b.addEventListener("click", () => {
        void navigator.clipboard.writeText(b.dataset.pin!);
        this.copied = Number(b.dataset.pin);
        b.textContent = "Copied";
        setTimeout(() => {
          if (this.copied !== Number(b.dataset.pin)) return;
          this.copied = null;
          b.textContent = "Copy";
        }, 1500);
      }),
    );
  }

  /**
   * "fresh": nearest N within the first batch. "more": raise the target by N ("Find next 5").
   * "batch": widen the search by one more batch of cities. "same": continue after Stop / a rate-limit.
   * Cached places are instant, so widening never re-checks anything.
   */
  async run(target: "fresh" | "more" | "batch" | "same" = "fresh") {
    const id = ++this.runId;
    this.showBar(null);
    this.showAction(null);
    const settings = await getSettings();
    if (!settings.homePin && settings.homeLat == null) return this.askHomePin(); // needed to sort cities by distance

    if (!this.product) {
      this.status = "Finding product…";
      this.setBody(loadingBody);
      let busy = false;
      try {
        this.product = await this.site.resolve(location, document);
      } catch (e) {
        busy = e instanceof RateLimitedError;
        this.product = null;
      }
      if (id !== this.runId) return;
      if (!this.product) {
        if (this.site.experimental) this.log.push({ resolveFailed: true, busy, page: this.site.diagnose?.(document) });
        this.status = "";
        this.setBody(`<p class="empty">${busy ? `${this.site.name} is busy right now.` : "Couldn't identify this product."}</p>`);
        this.showAction("Try again", () => void this.run());
        return;
      }
    }
    const product = this.product;
    void pruneCache();

    const batch = settings.stopAfterHits; // 0 = don't stop on hits; batches still apply
    if (batch === 0) this.target = 0;
    else if (target === "more") this.target += batch;
    else if (target === "fresh" || this.target === 0) this.target = batch;
    if (target === "fresh" || this.cityLimit === 0) this.cityLimit = settings.batchSize;
    else if (target === "batch") this.cityLimit += settings.batchSize;

    const { items, citiesLeft } = limitToBatch(planChecks(settings), this.cityLimit);
    const results = new Map<number, CheckResult>();
    const draw = (finished = false) => this.render(items, results, finished);
    const found = () => items.filter((i) => results.get(i.pin)?.status === "deliverable").length;
    this.status = "Starting…";
    draw();

    let outcome: Awaited<ReturnType<typeof runQueue>>;
    try {
      outcome = await runQueue<CheckItem, CheckResult>({
        items,
        concurrency: Math.min(settings.concurrency, this.site.maxConcurrency ?? Infinity),
        delayMs: settings.delayMs,
        stopAfterHits: this.target,
        maxPauses: BACKOFF_SEC.length,
        cancelled: () => id !== this.runId,
        // Only regular cities count towards "nearest N": saved and favourite places are always checked.
        isHit: (item, r) => item.group === "city" && r.status === "deliverable",
        onResult: (index, r) => {
          results.set(items[index]!.pin, r);
          this.status = `${found()} found · ${results.size}/${items.length}`;
          draw();
        },
        onRateLimit: (attempt, retryAfter) => this.waitOut(Math.max(retryAfter ?? 0, BACKOFF_SEC[attempt - 1]!), attempt, id),
        check: async (item) => {
          const key = `${this.site.id}:${product.id}:${JSON.stringify(product.extra ?? {})}:${item.pin}`;
          // Experimental stores skip the cache, so every test run produces a complete, fresh log.
          const cached = this.site.experimental ? null : await getCached(key);
          if (cached) return { value: cached, cached: true };

          let full: CheckResult;
          try {
            full = await this.site.check(product, item.pin, settings.debug || !!this.site.experimental);
          } catch (e) {
            if (e instanceof RateLimitedError) {
              if (this.site.experimental) this.log.push({ pin: item.pin, rateLimited: true });
              throw e;
            }
            full = { status: "error", detail: (e as Error).message };
          }
          const { raw, ...result } = full; // raw answers go to the log only, never the cache
          if (this.site.experimental) this.log.push({ pin: item.pin, result, raw });
          if (settings.debug) console.log(`[PinReach] ${this.site.id} ${item.pin}`, result, raw);
          if (!this.site.experimental) await putCached(key, result);
          return { value: result, cached: false };
        },
      });
    } finally {
      // Always clean up, even when stopped or cancelled (Amazon restores your own pincode here).
      await this.site.finish?.(product).catch(() => undefined);
    }

    if (id !== this.runId) return;
    draw(true);
    const n = found();
    const checkedCities = items.filter((i) => i.group === "city" && results.has(i.pin)).length;
    this.status = `${n} found · nearest ${checkedCities} cities`;
    const nextBatch = Math.min(settings.batchSize, citiesLeft);

    switch (outcome) {
      case "enough":
        this.showAction(`Find next ${batch}`, () => void this.run("more"));
        break;
      case "done":
        // The batch is used up before reaching the target: that is the break. Offer the next batch.
        if (nextBatch) this.showAction(`Search next ${nextBatch} cities`, () => void this.run("batch"));
        else this.status = `${n} found · all cities checked`;
        break;
      case "stopped":
        this.showBar("Stopped.", "Continue", () => void this.run("same"));
        break;
      case "gave_up":
        this.showBar(`${this.site.name} is busy. Try again in a few minutes.`, "Retry", () => void this.run("same"));
        break;
    }
  }
}
