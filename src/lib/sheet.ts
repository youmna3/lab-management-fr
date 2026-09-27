// CSV / Excel parsing helpers (SheetJS). Used by Lab Data import and Batch needs import.
import * as XLSX from "xlsx";

/** Detect and repair Arabic Mojibake strings corrupted by single-byte / latin1 decoding. */
export function fixMojibake(str: unknown): string {
  if (str === null || str === undefined) return "";
  const s = String(str).trim();
  if (!s) return "";

  // Check if string exhibits double-encoded UTF-8 bytes (latin1/cp1252 artifact chars like Ø, Ù, Ù„, Ø§)
  if (/[\u00C0-\u00FF]/.test(s) && !/[\u0600-\u06FF]/.test(s)) {
    try {
      const bytes = new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
      const decoded = new TextDecoder("utf-8").decode(bytes);
      if (decoded && /[\u0600-\u06FF]/.test(decoded)) {
        return decoded.trim();
      }
    } catch (e) {
      // Fallthrough
    }
  }
  return s;
}

/** Parse the first sheet of a CSV/XLSX file into row objects keyed by header with Arabic encoding repair. */
export async function parseSheet(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  // Force codepage 65001 (UTF-8) for CSV parsing
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", codepage: 65001, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];

  // Clean keys and values with fixMojibake
  return rawRows.map((row) => {
    const cleanedRow: Record<string, unknown> = {};
    Object.keys(row).forEach((k) => {
      const cleanKey = fixMojibake(k);
      const val = row[k];
      cleanedRow[cleanKey] = typeof val === "string" ? fixMojibake(val) : val;
    });
    return cleanedRow;
  });
}

/** Parse the first sheet into a raw matrix so duplicate headers and column order are preserved. */
export async function parseSheetMatrix(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", codepage: 65001, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
  return rawRows.map((row) =>
    row.map((value) => (typeof value === "string" ? fixMojibake(value) : value)),
  );
}

/** First non-empty value among candidate header names (trimmed and encoding fixed). */
export function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return fixMojibake(v);
    }
  }
  return "";
}

/** Download rows (array of objects) as a CSV file with UTF-8 BOM. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (c: unknown) => `"${String(c ?? "").replace(/"/g, '""')}"`;
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
