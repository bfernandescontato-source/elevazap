import ExcelJS from "exceljs";
import Papa from "papaparse";

const MAX_ROWS = 20000;

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const withText = value as { text?: string; richText?: { text: string }[]; result?: unknown };
    if (typeof withText.text === "string") return withText.text;
    if (Array.isArray(withText.richText)) return withText.richText.map((part) => part.text).join("");
    if (withText.result !== undefined) return String(withText.result);
    return "";
  }
  return String(value);
}

async function parseXlsx(buffer: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Planilha sem nenhuma aba.");
  const all: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    all.push(values.map(cellToString));
  });
  const [headers, ...rows] = all;
  return { headers: headers || [], rows };
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const [headers, ...rows] = result.data;
  return { headers: headers || [], rows };
}

// Nunca persiste o arquivo — parseia em memória e descarta. Sem storage, sem limpeza necessária.
export async function parseSpreadsheetFile(buffer: Buffer, fileName: string): Promise<{ headers: string[]; rows: string[][] }> {
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const result = isCsv ? parseCsv(buffer.toString("utf8")) : await parseXlsx(buffer);
  if (!result.headers.length) throw new Error("Planilha vazia ou sem cabeçalho.");
  if (result.rows.length > MAX_ROWS) throw new Error(`Máximo de ${MAX_ROWS} linhas por lista.`);
  return result;
}
