import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/inspect-workbook.mjs <xlsx>");

const input = await FileBlob.load(source);
const workbook = await SpreadsheetFile.importXlsx(input);
const overview = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 12000,
  tableMaxRows: 12,
  tableMaxCols: 12,
  tableMaxCellChars: 160,
});
console.log(overview.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  if (!used) continue;
  const values = used.values;
  console.log(JSON.stringify({
    sheet: sheet.name,
    rows: values.length,
    cols: Math.max(0, ...values.map((row) => row.length)),
    sample: values.slice(0, 15).map((row) => row.slice(0, 12)),
  }));
}
