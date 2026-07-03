import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PWA metadata and app entry points are present", async () => {
  const [html, manifestText] = await Promise.all([read("index.html"), read("manifest.webmanifest")]);
  const manifest = JSON.parse(manifestText);

  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /id="transaction-form"/);
  assert.match(html, /id="ocr-form"/);
  assert.match(html, /id="savings-goal-form"/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
});

test("service worker caches only declared static assets", async () => {
  const worker = await read("sw.js");
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /APP_ASSETS\.includes\(assetPath\)/);
  assert.doesNotMatch(worker, /caches\.match\(event\.request\)[\s\S]*if \(cached\) return cached/);
});

test("all PWA assets referenced by the manifest exist", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  await Promise.all(manifest.icons.map((icon) => readFile(new URL(`..\/${icon.src.replace("./", "")}`, import.meta.url))));
});
