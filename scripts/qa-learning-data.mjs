import fs from "node:fs/promises";

function parseWindowData(text) {
  return JSON.parse(text.replace(/^window\.[A-Z_]+\s*=\s*/, "").replace(/;\s*$/, ""));
}

const words = parseWindowData(await fs.readFile("words-data.js", "utf8"));
const learning = parseWindowData(await fs.readFile("learning-data.js", "utf8"));
const app = await fs.readFile("app.js", "utf8");
const index = await fs.readFile("index.html", "utf8");

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(words.wordCount === words.words.length, "word count metadata mismatch");
check(words.dayCount === Math.ceil(words.words.length / 15), "day count is not based on 15 words");
check(words.dayCount === 101, "expected 101 days");
check(Object.keys(learning).length === words.words.length, "learning data does not cover every word");
check(new Set(Object.values(learning).map((item) => item.mnemonic)).size === words.words.length, "mnemonics are not unique per word");
check(Object.values(learning).every((item) => item.mnemonic.trim()), "empty mnemonic found");
check(Object.values(learning).every((item) => item.prompt.includes("____")), "quiz prompt without a blank found");
check(Object.values(learning).every((item) => !/[\u3400-\u9fff]/.test(item.prompt)), "Chinese text found in an English quiz prompt");
check(Object.values(learning).every((item) => !item.prompt.includes("Choose the word that best expresses")), "forbidden old prompt found");
check(app.includes('const DAY_SIZE = 15;'), "app day size is not 15");
check(app.includes('version: 2'), "app state schema was not reset to v2");
check(index.includes('learning-data.js'), "learning data script is not loaded");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    words: words.words.length,
    days: words.dayCount,
    dailyWords: 15,
    uniqueMnemonics: new Set(Object.values(learning).map((item) => item.mnemonic)).size,
    englishOnlyPrompts: Object.values(learning).filter((item) => !/[\u3400-\u9fff]/.test(item.prompt)).length,
    stateVersion: 2,
  }, null, 2));
}
