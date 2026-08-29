import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = process.argv[2];
const target = process.argv[3] ?? "words-data.js";
if (!source) throw new Error("Usage: node scripts/export-words.mjs <xlsx> [target.js]");

const input = await FileBlob.load(source);
const workbook = await SpreadsheetFile.importXlsx(input);
const lists = new Map();

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  if (!used) continue;
  const rows = used.values;
  const headers = rows[0] ?? [];
  for (let col = 0; col < headers.length; col += 2) {
    const header = String(headers[col] ?? "").trim();
    const match = header.match(/list\s*(\d+)/i);
    if (!match) continue;
    const list = Number(match[1]);
    const entries = [];
    for (let row = 1; row < rows.length; row += 1) {
      const english = String(rows[row]?.[col] ?? "").trim();
      const chinese = String(rows[row]?.[col + 1] ?? "").trim();
      if (!english || !chinese) continue;
      entries.push({ english, chinese });
    }
    lists.set(list, entries);
  }
}

const words = [];
for (const list of [...lists.keys()].sort((a, b) => a - b)) {
  for (const [position, entry] of lists.get(list).entries()) {
    words.push({
      id: `l${list}-${position + 1}`,
      list,
      position: position + 1,
      english: entry.english,
      chinese: entry.chinese,
    });
  }
}

const exactDuplicates = [];
const seen = new Map();
for (const word of words) {
  const key = word.english.toLowerCase();
  if (seen.has(key)) exactDuplicates.push([seen.get(key), word.id, word.english]);
  else seen.set(key, word.id);
}

const payload = {
  source: source.split("/").pop(),
  generatedAt: new Date().toISOString(),
  listCount: lists.size,
  wordCount: words.length,
  dayCount: Math.ceil(words.length / 15),
  words,
};

await fs.writeFile(target, `window.GRE_WORDS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(JSON.stringify({
  target,
  lists: [...lists.entries()].map(([list, entries]) => ({ list, count: entries.length })),
  words: words.length,
  days: payload.dayCount,
  duplicates: exactDuplicates,
}, null, 2));
