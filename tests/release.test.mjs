import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
  assert.match(html, /data-action="record-subscription"/);
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

test("OCR uses a real browser engine instead of fixed mock profiles", async () => {
  const [html, service] = await Promise.all([read("index.html"), read("ocr-service.js")]);
  assert.match(html, /\.\/vendor\/tesseract\.min\.js/);
  assert.match(service, /createWorker\("jpn\+eng"/);
  assert.match(service, /provider: "tesseract"/);
  assert.doesNotMatch(service, /mockProfiles/);

  const context = { window: {} };
  vm.runInNewContext(service, context);
  const parsed = context.window.OCRService.parseText(
    "PayPay\n支払い完了\nセブン-イレブン\n2026年7月3日\n支払金額 1,280円",
    { sourceType: "auto", fallbackDate: "2026-07-04" },
  );
  assert.equal(parsed.sourceType, "paypay");
  assert.equal(parsed.date, "2026-07-03");
  assert.equal(parsed.amount, 1280);
  assert.equal(parsed.merchant, "セブン-イレブン");
  assert.equal(parsed.paymentMethod, "PayPay");

  const transactions = context.window.OCRService.extractTransactions(
    "PayPay\nセブン-イレブン\n7月3日 18:42\n-1,280円\nスターバックス\n7月2日 09:10\n-550円",
    { sourceType: "paypay", fallbackDate: "2026-07-04" },
  );
  assert.equal(transactions.length, 2);
  assert.equal(
    JSON.stringify(transactions.map(({ date, amount, merchant }) => ({ date, amount, merchant }))),
    JSON.stringify([
      { date: "2026-07-03", amount: 1280, merchant: "セブン-イレブン" },
      { date: "2026-07-02", amount: 550, merchant: "スターバックス" },
    ]),
  );
});
