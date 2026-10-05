// PinReach capture script: records a store's own pincode-check requests so a new store
// can be built from real responses. Paste into the browser DevTools console on a product page.
//
// 1. Paste this whole file into the Console and press Enter.
// 2. Use the store's own pincode box: enter a pincode that delivers (e.g. 400001), then one
//    that probably doesn't (e.g. 744101 Port Blair). On Amazon, use "Deliver to" and then open
//    "See all buying options".
// 3. Run:  copy(PinReachCapture.dump())   and paste the result to Claude.
//
// Privacy: cookies, authorization, CSRF, session and token values are replaced with
// "[redacted]". Nothing is sent anywhere: the result only goes to your clipboard.
(() => {
  if (window.PinReachCapture) return console.log("PinReach capture is already running.");
  const entries = [];
  const SENSITIVE = /cookie|auth|token|csrf|xsrf|session|secret|signature|password|otp|phone|mobile|email/i;
  const INTERESTING = /servic|pincode|pin_code|zip|deliver|address|location|glow|offer|aod|availab|promise|shipping/i;
  const PIN = /\b[1-9]\d{5}\b/;
  const MAX_BODY = 30000;

  const redactHeaders = (h) => {
    const out = {};
    for (const [k, v] of Object.entries(h || {})) out[k] = SENSITIVE.test(k) ? "[redacted]" : String(v);
    return out;
  };
  // Redact sensitive-looking JSON fields and long opaque strings in bodies.
  const redactText = (t) =>
    String(t ?? "")
      .slice(0, MAX_BODY)
      .replace(/("(?:[^"]*(?:token|csrf|session|auth|secret|signature|otp|phone|mobile|email)[^"]*)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
      .replace(/([?&](?:[^=&]*(?:token|csrf|session|auth|sig)[^=&]*)=)[^&"]*/gi, "$1[redacted]");

  const record = (e) => {
    const hay = `${e.url} ${e.requestBody ?? ""}`;
    if (!INTERESTING.test(hay) && !PIN.test(hay)) return;
    entries.push({ ...e, url: redactText(e.url), requestBody: redactText(e.requestBody), responseBody: redactText(e.responseBody) });
    console.log(`[PinReach capture] #${entries.length} ${e.method} ${e.status} ${e.url.slice(0, 120)}`);
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || (input && input.method) || "GET").toUpperCase();
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers;
    const res = await origFetch.apply(this, arguments);
    try {
      const text = await res.clone().text();
      record({ via: "fetch", method, url: new URL(url, location.href).href, requestHeaders: redactHeaders(headers), requestBody: typeof init.body === "string" ? init.body : null, status: res.status, responseBody: text });
    } catch {}
    return res;
  };

  const OrigXHR = window.XMLHttpRequest;
  const open = OrigXHR.prototype.open;
  const send = OrigXHR.prototype.send;
  const setHeader = OrigXHR.prototype.setRequestHeader;
  OrigXHR.prototype.open = function (method, url) {
    this.__pr = { method: String(method).toUpperCase(), url: new URL(url, location.href).href, headers: {} };
    return open.apply(this, arguments);
  };
  OrigXHR.prototype.setRequestHeader = function (k, v) {
    if (this.__pr) this.__pr.headers[k] = v;
    return setHeader.apply(this, arguments);
  };
  OrigXHR.prototype.send = function (body) {
    const meta = this.__pr;
    if (meta) {
      this.addEventListener("loadend", () => {
        let text = "";
        try { text = this.responseType === "" || this.responseType === "text" ? this.responseText : JSON.stringify(this.response); } catch {}
        record({ via: "xhr", method: meta.method, url: meta.url, requestHeaders: redactHeaders(meta.headers), requestBody: typeof body === "string" ? body : null, status: this.status, responseBody: text });
      });
    }
    return send.apply(this, arguments);
  };

  window.PinReachCapture = {
    dump: () => JSON.stringify({ page: location.href.split("?")[0], capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, entries }, null, 1),
    count: () => entries.length,
  };
  console.log("%cPinReach capture running.%c Use the store's pincode box twice, then run: copy(PinReachCapture.dump())", "font-weight:bold;color:#2563eb", "");
})();
