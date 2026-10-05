// Theme tokens live on .card so they work inside the shadow root.
// data-theme="light" | "dark" forces a theme; without it the OS preference wins.
const LIGHT = `
  --bg: #ffffff; --surface: #f6f7f9; --fg: #111827; --muted: #6b7280; --line: #e7e9ee;
  --accent: #2563eb; --accent-fg: #ffffff;
  --ok: #15803d; --ok-bg: #effcf3; --ok-line: #b7ebc6;
  --warn: #92400e; --warn-bg: #fff8eb; --warn-line: #fde3b0;
  --shadow: 0 12px 32px rgba(17, 24, 39, .18);`;
const DARK = `
  --bg: #15181d; --surface: #1c2027; --fg: #e8eaed; --muted: #9aa1ac; --line: #2a2f37;
  --accent: #6ea8fe; --accent-fg: #0b1220;
  --ok: #4ade80; --ok-bg: #11271a; --ok-line: #1f5133;
  --warn: #fbbf24; --warn-bg: #2a2212; --warn-line: #4a3a17;
  --shadow: 0 12px 32px rgba(0, 0, 0, .5);`;

export const PANEL_CSS = `
:host { all: initial; }
.card { ${LIGHT} position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); }
.card[data-theme="dark"] { ${DARK} }
@media (prefers-color-scheme: dark) { .card:not([data-theme="light"]) { ${DARK} } }

button { font: inherit; color: inherit; cursor: pointer; }
.fab { display: flex; align-items: center; gap: 6px; background: var(--accent); color: var(--accent-fg); border: 0;
  border-radius: 999px; padding: 10px 16px; touch-action: none; font-weight: 600; box-shadow: var(--shadow); }
.card:not(.collapsed) .fab, .card.collapsed .panel { display: none; }

.panel { width: 340px; max-width: calc(100vw - 32px); max-height: min(72vh, var(--room, 72vh)); display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; }

header { cursor: grab; touch-action: none; display: flex; align-items: center; gap: 8px; padding: 12px 14px 10px; }
header b { font-size: 14px; }
.status { flex: 1; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { background: none; border: 0; color: var(--muted); width: 26px; height: 26px; border-radius: 7px; font-size: 14px; }
.icon-btn:hover { background: var(--surface); color: var(--fg); }

.progress { height: 2px; background: var(--line); }
.progress i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .25s; }

.bar { display: flex; align-items: center; gap: 8px; margin: 10px 14px 0; padding: 8px 10px; border-radius: 10px;
  background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn); font-size: 12px; }
.bar[hidden] { display: none; }
.bar-text { flex: 1; }
.bar-text b { font-variant-numeric: tabular-nums; }
.bar button { border: 0; background: none; font-weight: 600; color: inherit; padding: 2px 4px; }
.bar button[hidden] { display: none; }

.body { overflow: auto; padding: 4px 14px 0; }
.foot { padding: 0 14px 12px; }
h4 { margin: 12px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.found { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.hit { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px;
  background: var(--ok-bg); border: 1px solid var(--ok-line); }
.hit .who { flex: 1; min-width: 0; }
.hit b { display: block; color: var(--ok); }
.hit small, .sub { color: var(--muted); font-size: 11.5px; }
.tag { font-size: 10.5px; font-weight: 600; color: var(--muted); margin-left: 4px; }
.price { font-weight: 700; font-size: 13px; color: var(--ok); white-space: nowrap; text-align: right; }
.price.higher { color: var(--warn); }
.price small { display: block; font-weight: 600; font-size: 10.5px; }
.copy { background: var(--bg); border: 1px solid var(--line); border-radius: 7px; padding: 3px 8px; font-size: 12px; color: var(--muted); }
.copy:hover { color: var(--fg); }

.empty { color: var(--muted); padding: 8px 0; }
/* Skeleton cards: same box as .hit, so results replace them without layout jumps. */
.skel { display: flex; flex-direction: column; justify-content: center; gap: 7px; height: 54px; box-sizing: border-box; padding: 9px 10px;
  border-radius: 10px; border: 1px solid var(--line); background: var(--surface); }
.skel span { display: block; height: 9px; border-radius: 5px;
  background: linear-gradient(90deg, var(--line) 0%, var(--bg) 50%, var(--line) 100%); background-size: 200% 100%; animation: shimmer 1.3s ease-in-out infinite; }
.skel span:first-child { width: 45%; }
.skel span:last-child { width: 70%; height: 7px; opacity: .7; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .skel span { animation: none; } }

details { margin-top: 10px; font-size: 12px; color: var(--muted); }
summary { cursor: pointer; list-style: none; user-select: none; }
summary::-webkit-details-marker { display: none; }
summary::after { content: " ▸"; }
details[open] summary::after { content: " ▾"; }
details p, details ul { margin: 6px 0 0; line-height: 1.6; }
details ul { padding-left: 16px; }

.actions { display: flex; gap: 8px; margin-top: 12px; }
.primary { flex: 1; background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 9px; padding: 8px 10px; font-weight: 600; }
.primary[hidden] { display: none; }
.ghost-btn { background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 9px; padding: 8px 10px; font-weight: 600; }
.ghost-btn:hover { color: var(--fg); background: var(--surface); }
.beta { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--warn); background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 999px; padding: 1px 7px; }
.note { margin: 10px 0 0; font-size: 11.5px; color: var(--muted); }

.setup { display: flex; gap: 8px; padding: 10px 0 4px; }
.setup input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--fg); font: inherit; }
.setup button { background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 9px; padding: 8px 12px; font-weight: 600; }
`;
