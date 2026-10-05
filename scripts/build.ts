// Bundles the extension into dist/. Load dist/ in chrome://extensions → "Load unpacked".
// Run: bun run build   (or: bun run watch)
import { cp, mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

async function build() {
  const started = performance.now();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const builds = await Promise.all([
    // The popup is an ES module.
    Bun.build({
      entrypoints: [`${src}/popup/popup.ts`],
      outdir: dist,
      naming: "[name].js",
      target: "browser",
      format: "esm",
      minify: true,
    }),
    // Content scripts can't be modules, so ship a self-contained IIFE.
    Bun.build({
      entrypoints: [`${src}/content/main.ts`],
      outdir: dist,
      naming: "content.js",
      target: "browser",
      format: "iife",
      minify: true,
    }),
  ]);
  for (const b of builds) {
    if (!b.success) {
      for (const log of b.logs) console.error(log);
      throw new Error("Build failed");
    }
  }

  await Promise.all([
    cp(`${src}/manifest.json`, `${dist}/manifest.json`),
    cp(`${src}/popup/popup.html`, `${dist}/popup.html`),
    cp(`${src}/popup/popup.css`, `${dist}/popup.css`),
    cp(`${src}/icons`, `${dist}/icons`, { recursive: true }),
  ]);
  console.log(`Built dist/ in ${Math.round(performance.now() - started)} ms`);
}

await build();

if (process.argv.includes("--watch")) {
  let timer: Timer | undefined;
  watch(src, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 150);
  });
  console.log("Watching src/ for changes…");
}
