import { copyFile, mkdir, rm } from "node:fs/promises";

const assets = [
  "index.html",
  "styles.css",
  "app.js",
  "ocr-service.js",
  "insights-service.js",
  "ledger-service.js",
  "prompt-templates.js",
  "app-version.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "vendor/tesseract.min.js",
  "vendor/tesseract.min.js.LICENSE.txt",
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await mkdir("dist/vendor", { recursive: true });
await Promise.all(assets.map((asset) => copyFile(asset, `dist/${asset}`)));

console.log(`Built ${assets.length} static assets into dist/`);
