import * as XLSX from "xlsx";
import { createZip } from "./zip-writer";

// `rows` accepts any array of plain-object rows (readonly so a `readonly T[]`,
// like the return type of Array.sort(), can be passed directly). SheetJS's
// json_to_sheet only cares that each row is an object; it doesn't require an
// index signature, so this is intentionally looser than Record<string, unknown>.
export type SheetSpec = { name: string; rows: readonly object[] };

function workbookFromSheets(sheets: SheetSpec[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    // json_to_sheet on an empty array still produces a valid (headerless) sheet,
    // matching the original pandas `.to_excel()` calls, which never skip writing
    // a file just because a DataFrame happens to be empty.
    const ws = XLSX.utils.json_to_sheet(sheet.rows as Record<string, unknown>[]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  return wb;
}

export function workbookToBlob(sheets: SheetSpec[]): Blob {
  const wb = workbookFromSheets(sheets);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function textToBlob(text: string): Blob {
  return new Blob([text], { type: "text/plain;charset=utf-8" });
}

export interface GeneratedFile {
  filename: string;
  blob: Blob;
}

export function zipFromFiles(files: Array<{ path: string; blob: Blob }>): Promise<Blob> {
  return Promise.all(files.map(async (f) => ({ name: f.path, data: new Uint8Array(await f.blob.arrayBuffer()) }))).then((entries) =>
    createZip(entries),
  );
}
