import { approxCity, MAJOR_CITIES } from "../data/major-cities";
import { homePosition } from "../lib/planner";
import { SUPPORTED } from "../sites";
import { getSettings, saveSettings } from "../lib/storage";
import type { Settings, Theme } from "../lib/types";

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const THEMES: Theme[] = ["auto", "light", "dark"];
const THEME_ICON: Record<Theme, string> = { auto: "◐", light: "☀", dark: "☾" };
const cityByName = new Map(MAJOR_CITIES.map((c) => [c.city.toLowerCase(), c]));

$("#cities").innerHTML = [...MAJOR_CITIES]
  .sort((a, b) => a.city.localeCompare(b.city))
  .map((c) => `<option value="${esc(c.city)}">`)
  .join("");

function applyTheme(theme: Theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  $("#theme").textContent = THEME_ICON[theme];
  $<HTMLButtonElement>("#theme").title = `Theme: ${theme}`;
}

/** Wires every `[data-remove]` button inside `container` to drop that entry. */
function onRemove(container: Element, remove: (value: number) => Promise<Settings>) {
  container.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) =>
    b.addEventListener("click", async () => render(await remove(Number(b.dataset.remove)))),
  );
}

function render(s: Settings) {
  applyTheme(s.theme);

  $<HTMLInputElement>("#home input").value = s.homePin ? String(s.homePin) : "";
  const pos = homePosition(s);
  $("#home-info").textContent = !pos ? "" : pos.exact ? "Using your exact location" : `Near ${pos.nearCity}`;

  const saved = $("#saved");
  saved.innerHTML = s.saved
    .map((a, i) => {
      const near = approxCity(a.pin);
      return `<li><span>${esc(a.label)}<small>${a.pin}${near ? ` · ${esc(near.city)}` : ""}</small></span><button class="x" data-remove="${i}" title="Remove">✕</button></li>`;
    })
    .join("");
  onRemove(saved, (i) => saveSettings({ saved: s.saved.filter((_, j) => j !== i) }));

  const favs = $("#favs");
  favs.innerHTML = s.favCities
    .map((pin) => MAJOR_CITIES.find((c) => c.pin === pin))
    .filter(Boolean)
    .map((c) => `<span class="chip">${esc(c!.city)}<button class="x" data-remove="${c!.pin}" title="Remove">✕</button></span>`)
    .join("");
  onRemove(favs, (pin) => saveSettings({ favCities: s.favCities.filter((p) => p !== pin) }));

  for (const el of document.querySelectorAll<HTMLSelectElement | HTMLInputElement>("details [name]")) {
    const key = el.name as keyof Settings;
    if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(s[key]);
    else el.value = String(s[key]);
  }
}

$("#theme").addEventListener("click", async () => {
  const { theme } = await getSettings();
  render(await saveSettings({ theme: THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]! }));
});

$("#home").addEventListener("submit", async (e) => {
  e.preventDefault();
  render(await saveSettings({ homePin: Number(new FormData(e.target as HTMLFormElement).get("pin")) }));
});

$("#locate").addEventListener("click", () => {
  const info = $("#home-info");
  info.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => render(await saveSettings({ homeLat: coords.latitude, homeLng: coords.longitude })),
    () => (info.textContent = "Location unavailable. Enter your pincode."),
    { timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
});

$("#add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  const s = await getSettings();
  const pin = Number(data.get("pin"));
  if (s.saved.some((a) => a.pin === pin)) return;
  form.reset();
  render(await saveSettings({ saved: [...s.saved, { label: String(data.get("label")).trim(), pin }] }));
});

$("#fav").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const input = form.elements.namedItem("city") as HTMLInputElement;
  const city = cityByName.get(input.value.trim().toLowerCase());
  if (!city) {
    input.setCustomValidity("Pick a city from the list");
    input.reportValidity();
    return;
  }
  const s = await getSettings();
  form.reset();
  if (!s.favCities.includes(city.pin)) render(await saveSettings({ favCities: [...s.favCities, city.pin] }));
});
$<HTMLInputElement>("#fav input").addEventListener("input", (e) => (e.target as HTMLInputElement).setCustomValidity(""));

for (const el of document.querySelectorAll<HTMLSelectElement | HTMLInputElement>("details [name]")) {
  el.addEventListener("change", () => {
    const value = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : Number(el.value);
    void saveSettings({ [el.name]: value } as Partial<Settings>);
  });
}

$("#stores").textContent = `Works on ${SUPPORTED.join(" · ")}`;
void getSettings().then(render);
