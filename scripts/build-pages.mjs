import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
const files = [
  "index.html", "styles.css", "app.js", "core.js", "words-data.js",
  "reading-data.js", "ambient-audio.js", "docs/WordLink-MIT-LICENSE.txt",
  "assets/ambient/NOTICE.md", "assets/ambient/scene-overlay.webp",
  ...["spring", "summer", "autumn", "winter"].flatMap(season => [
    `assets/ambient/${season}.mp4`, `assets/ambient/${season}.jpg`,
  ]),
];

// Only these application files are published. Original tables and local records stay out.
await fs.rm(output, { recursive: true, force: true });
for (const file of files) {
  assert(!/\.(?:xlsx?|xlsm|xlsb|csv|tsv|ods)$/i.test(file));
  const input = path.join(root, file);
  assert((await fs.lstat(input)).isFile(), `${file}: expected a regular file`);
  const target = path.join(output, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(input, target);
}
await fs.writeFile(path.join(output, ".nojekyll"), "");

let entry = await fs.readFile(path.join(output, "index.html"), "utf8");
for (const [, reference] of [...entry.matchAll(/(?:src|href)="([^"#]+)"/g)]) {
  if (/^(?:data:|https?:)/.test(reference)) continue;
  assert(files.includes(reference), `Missing published asset: ${reference}`);
  const bytes = await fs.readFile(path.join(output, reference));
  const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  entry = entry.replaceAll(`"${reference}"`, `"${reference}?v=${version}"`);
}
await fs.writeFile(path.join(output, "index.html"), entry);
console.log(`Pages ready: ${files.length + 1} application files; no original tables or local records.`);
