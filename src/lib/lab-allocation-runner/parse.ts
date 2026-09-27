// Port of the file-loading logic from scripts/lab_allocation.py
// (normalize_header / find_sheet_with_columns / load_students / load_lab_capacity).
// Runs entirely client-side using the `xlsx` (SheetJS) package that is already
// a project dependency, so no server round-trip or Python runtime is required.

import * as XLSX from "xlsx";
import { EGYPT_AREA_TO_GOV, normalizeArabic } from "../arabic";
import { parseAcademicClassification, parseGradeLevel, formatGradeLevel, DECI_GRADE_LEVEL_OPTIONS, DEMI_GRADE_OPTIONS } from "../project-grade-levels";

export type Row = Record<string, unknown>;

interface SheetTable {
  sheetName: string;
  headers: string[];
  rows: Row[];
}

export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/** Reads every sheet of a workbook (or the single implicit sheet of a CSV) into
 * row-object form, deduplicating repeated header names by keeping the first
 * occurrence — mirroring `df.loc[:, ~df.columns.duplicated(keep="first")]`. */
async function readAllSheets(file: File): Promise<SheetTable[]> {
  const isCsv = /\.csv$/i.test(file.name);
  let workbook: XLSX.WorkBook;
  if (isCsv) {
    const text = await file.text();
    workbook = XLSX.read(text, { type: "string", raw: true });
  } else {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: "array" });
  }

  const tables: SheetTable[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    if (raw.length === 0) continue;
    const headerRow = raw[0] as unknown[];

    const seen = new Set<string>();
    const colIndexByHeader = new Map<string, number>();
    headerRow.forEach((h, idx) => {
      const name = isBlank(h) ? `Unnamed: ${idx}` : String(h).trim();
      if (!seen.has(name)) {
        seen.add(name);
        colIndexByHeader.set(name, idx);
      }
    });

    const headers = [...colIndexByHeader.keys()];
    const rows: Row[] = [];
    for (let r = 1; r < raw.length; r++) {
      const dataRow = raw[r] as unknown[];
      if (!dataRow) continue;
      const rowObj: Row = {};
      for (const [name, idx] of colIndexByHeader.entries()) {
        rowObj[name] = dataRow[idx] ?? null;
      }
      rowObj.__rowNumber = r + 1; // 1-based, matches a spreadsheet row number
      rows.push(rowObj);
    }
    tables.push({ sheetName, headers, rows });
  }
  return tables;
}

function applyAliases(table: SheetTable, aliases: Record<string, string>): SheetTable {
  if (Object.keys(aliases).length === 0) return table;
  const headers = table.headers.map((h) => aliases[h] ?? h);
  // If aliasing creates a new duplicate, keep the first occurrence (same rule as pandas rename+dedup).
  const seen = new Set<string>();
  const keepIdx: number[] = [];
  headers.forEach((h, i) => {
    if (!seen.has(h)) {
      seen.add(h);
      keepIdx.push(i);
    }
  });
  const finalHeaders = keepIdx.map((i) => headers[i]);
  const origHeaders = keepIdx.map((i) => table.headers[i]);
  const rows = table.rows.map((row) => {
    const out: Row = { ...row, __rowNumber: row.__rowNumber };
    finalHeaders.forEach((h, i) => {
      out[h] = row[origHeaders[i]];
    });
    return out;
  });
  const allHeaders = Array.from(new Set([...finalHeaders, ...table.headers]));
  return { sheetName: table.sheetName, headers: allHeaders, rows };
}

function fuzzyRename(table: SheetTable, requiredCols: string[]): SheetTable {
  const fuzzyMap: Record<string, string> = {};
  const claimed = new Set<string>();
  for (const c of table.headers) {
    const cStr = c.trim();
    const cNorm = normalizeHeader(cStr);
    const cLower = cStr.toLowerCase();

    if (requiredCols.includes("S_ID") && !claimed.has("S_ID")) {
      if (
        ["sid", "studentid", "stuid", "studentno", "studentcode", "stdid", "id"].includes(cNorm) ||
        cLower.includes("s_id") ||
        cLower.includes("student_id") ||
        cLower.includes("student id")
      ) {
        fuzzyMap[c] = "S_ID";
        claimed.add("S_ID");
      }
    }
    if (requiredCols.includes("Grade") && !claimed.has("Grade")) {
      if (
        cNorm.includes("grade") ||
        cNorm.includes("class") ||
        cNorm.includes("cohort") ||
        cNorm.includes("level") ||
        cNorm.includes("academic")
      ) {
        fuzzyMap[c] = "Grade";
        claimed.add("Grade");
      }
    }
    if (requiredCols.includes("Physical Area") && !claimed.has("Physical Area")) {
      if (cLower.includes("physical") && cLower.includes("area")) {
        fuzzyMap[c] = "Physical Area";
        claimed.add("Physical Area");
      } else if (cNorm === "area" || ["area", "location", "governorate", "gov"].includes(cLower)) {
        fuzzyMap[c] = "Physical Area";
        claimed.add("Physical Area");
      }
    }
    if (requiredCols.includes("Lab ID") && !claimed.has("Lab ID")) {
      if (
        (cNorm.includes("lab") && (cNorm.includes("id") || cNorm.includes("code") || cNorm.includes("name") || cNorm === "lab")) ||
        ["labid", "lab", "labcode", "id"].includes(cNorm)
      ) {
        fuzzyMap[c] = "Lab ID";
        claimed.add("Lab ID");
      }
    }
    if (requiredCols.includes("Area") && !claimed.has("Area")) {
      if (cLower.includes("physical") && cLower.includes("area")) {
        fuzzyMap[c] = "Area";
        claimed.add("Area");
      } else if (cNorm === "area" || ["area", "location", "governorate", "gov"].includes(cLower)) {
        fuzzyMap[c] = "Area";
        claimed.add("Area");
      }
    }
    if (requiredCols.includes("Lab Capacity") && !claimed.has("Lab Capacity")) {
      if (cNorm.includes("cap") || cNorm.includes("seat") || cNorm.includes("size") || cNorm.includes("max") || cNorm.includes("limit")) {
        fuzzyMap[c] = "Lab Capacity";
        claimed.add("Lab Capacity");
      }
    }
  }
  return applyAliases(table, fuzzyMap);
}

function hasAllColumns(table: SheetTable, requiredCols: string[]): boolean {
  return requiredCols.every((c) => table.headers.includes(c));
}

export async function findSheetWithColumns(
  file: File,
  requiredCols: string[],
  aliases: Record<string, string> = {},
): Promise<SheetTable> {
  const isCsv = /\.csv$/i.test(file.name);
  const tables = await readAllSheets(file);

  if (isCsv) {
    const table = applyAliases(tables[0], aliases);
    const missing = requiredCols.filter((c) => !table.headers.includes(c));
    if (missing.length > 0) {
      throw new Error(`${file.name}: missing required column(s) ${missing.join(", ")}. Found: ${table.headers.join(", ")}`);
    }
    return table;
  }

  const tried: Array<{ sheet: string; columns: string[] }> = [];
  for (const raw of tables) {
    const table = applyAliases(raw, aliases);
    if (hasAllColumns(table, requiredCols)) return table;
    tried.push({ sheet: raw.sheetName, columns: table.headers });
  }

  for (const raw of tables) {
    const fuzzy = fuzzyRename(raw, requiredCols);
    if (hasAllColumns(fuzzy, requiredCols)) return fuzzy;
  }

  const detail = tried.map((t) => `  - sheet '${t.sheet}': columns ${JSON.stringify(t.columns)}`).join("\n");
  throw new Error(`No sheet in ${file.name} contains all required columns ${JSON.stringify(requiredCols)}.\nSheets checked:\n${detail}`);
}

export interface StudentRow {
  S_ID: string;
  Grade: number;
  GradeLabel?: string;
  Grade_Label?: string;
  "Physical Area": string;
  Gov?: string;
  Governorate?: string;
  Track?: string;
  Course?: string;
  Group_ID?: string;
  Mega_Group?: string;
  Original_Physical_Area?: string;
  Allocation_Area?: string;
}

export const CANONICAL_GRADE_LABELS: Record<number, string> = {
  4: "Grade 4",
  5: "Grade 5",
  6: "Grade 6",
  101: "Computer Fundamentals Level 1",
  102: "Computer Advanced Level 2",
  103: "Cyber Security L3",
  104: "Cyber Security L4",
  105: "Cyber Security L5",
  106: "Digital Arts L3",
  107: "Digital Arts L4",
  108: "Digital Arts L5",
  109: "Web Development L3",
  110: "Web Development L4",
  111: "Web Development L5",
  112: "Data Science L3",
  113: "Data Science L4",
  114: "Data Science L5",
  115: "Embedded Systems L3",
  116: "Embedded Systems L4",
  117: "Embedded Systems L5",
  203: "Cyber Security - Level 3",
  204: "Cyber Security - Level 4",
  205: "Cyber Security - Level 5",
  303: "Digital Arts - Level 3",
  304: "Digital Arts - Level 4",
  305: "Digital Arts - Level 5",
  403: "Web Development - Level 3",
  404: "Web Development - Level 4",
  405: "Web Development - Level 5",
  503: "Data Science - Level 3",
  504: "Data Science - Level 4",
  505: "Data Science - Level 5",
  603: "Embedded Systems - Level 3",
  604: "Embedded Systems - Level 4",
  605: "Embedded Systems - Level 5",
};

export function formatGradeLabel(grade: unknown, program?: unknown): string {
  if (grade === null || grade === undefined) return "Grade —";
  const raw = String(grade).trim();
  if (!raw || raw === "undefined" || raw === "null" || raw === "NaN") return "Grade —";
  if (program) {
    return formatGradeLevel(grade, program);
  }
  const gNum = Number(raw);
  if (!isNaN(gNum) && CANONICAL_GRADE_LABELS[gNum]) {
    return CANONICAL_GRADE_LABELS[gNum];
  }
  return formatGradeLevel(grade, undefined);
}

export function cleanGrade(g: unknown, program?: unknown, trackHint?: unknown): { gradeNum: number; label: string } | null {
  if (g === null || g === undefined) return null;
  const gradeNum = parseAcademicClassification(g, program, trackHint);
  if (gradeNum == null) return null;
  const label = formatGradeLabel(gradeNum, program);
  return { gradeNum, label };
}

/** Column names that carry the "track" (subject area) in DECI uploads */
const TRACK_COLUMN_NAMES = ["Track", "Track_Name", "track", "track_name", "المسار", "اسم المسار"];
/** Column names that carry the "level" number in DECI uploads */
const LEVEL_COLUMN_NAMES = ["Level", "Level_Name", "level", "level_name", "المستوى", "رقم المستوى"];

export async function loadStudents(file: File, program?: unknown): Promise<StudentRow[]> {
  const aliases: Record<string, string> = {
    "{{S_ID}}": "S_ID",
    "Grade(25-26)": "Grade",
    "Student ID": "S_ID",
    Student_ID: "S_ID",
    SID: "S_ID",
    Physical_Area: "Physical Area",
    Gov: "Gov",
    Governorate: "Gov",
    governorate: "Gov",
    gov: "Gov",
    "المحافظة": "Gov",
    Gov_Name: "Gov",
    Governorate_Name: "Gov",
    Cohort: "Grade",
    "Track Name": "Track",
    Track_Name: "Track",
    track: "Track",
    Track: "Track",
    Course_Name: "Course",
    course: "Course",
    Course: "Course",
    "Group ID": "Group_ID",
    GroupId: "Group_ID",
    group_id: "Group_ID",
    "Mega Group": "Mega_Group",
    Sub_Batch: "Mega_Group",
  };

  let table: SheetTable;
  try {
    table = await findSheetWithColumns(file, ["S_ID", "Grade", "Physical Area"], aliases);
  } catch {
    try {
      table = await findSheetWithColumns(file, ["S_ID", "Physical Area"], aliases);
    } catch {
      const fallbackAliases = { ...aliases, Track: "Grade", Level: "Grade" };
      table = await findSheetWithColumns(file, ["S_ID", "Grade", "Physical Area"], fallbackAliases);
    }
  }

  // Detect which Track/Level column names are present in headers or row keys
  const headerSet = new Set(table.headers);
  const trackCol = TRACK_COLUMN_NAMES.find((c) => headerSet.has(c)) ?? null;
  const levelCol = LEVEL_COLUMN_NAMES.find((c) => headerSet.has(c)) ?? null;

  const out: StudentRow[] = [];
  for (const row of table.rows) {
    const sId = row["S_ID"];
    const track = row["Track"] ?? row["Track Name"] ?? row["track"] ?? (trackCol && !isBlank(row[trackCol]) ? row[trackCol] : undefined);
    const course = row["Course"] ?? row["Course_Name"] ?? row["course"];
    const trackVal = !isBlank(track) ? String(track).trim() : (!isBlank(course) ? String(course).trim() : undefined);

    const levelRaw =
      (levelCol && !isBlank(row[levelCol]) ? row[levelCol] : null) ??
      (!isBlank(row["Level"]) ? row["Level"] : null) ??
      (!isBlank(row["level"]) ? row["level"] : null) ??
      (!isBlank(row["Level_Name"]) ? row["Level_Name"] : null) ??
      (!isBlank(row["المستوى"]) ? row["المستوى"] : null) ??
      row["Grade"];

    const area = row["Physical Area"];
    const statusVal = String(row["Status"] || row["status"] || row["Student_Status"] || "").trim().toLowerCase();
    if (
      statusVal &&
      (statusVal.includes("drop") ||
        statusVal.includes("fail") ||
        statusVal.includes("inactive") ||
        statusVal.includes("withdrawn") ||
        statusVal.includes("cancel"))
    ) {
      continue;
    }

    const gradeResult = cleanGrade(levelRaw ?? row["Grade"], program, trackVal);
    if (isBlank(sId) || gradeResult === null || isBlank(area)) continue;

    const govRaw = row["Gov"] || row["Governorate"] || row["gov"] || row["governorate"] || row["المحافظة"];
    const areaStr = String(area).trim();
    let gov = govRaw && !isBlank(govRaw) ? String(govRaw).trim() : undefined;
    if (!gov) {
      gov = EGYPT_AREA_TO_GOV[areaStr] || EGYPT_AREA_TO_GOV[normalizeArabic(areaStr)] || areaStr;
    }
    const groupId = row["Group_ID"] ?? row["Group ID"] ?? row["GroupId"] ?? row["group_id"];
    const megaGroup = row["Mega_Group"] ?? row["Mega Group"] ?? row["Sub_Batch"];
    out.push({
      S_ID: String(sId).trim(),
      Grade: gradeResult.gradeNum,
      GradeLabel: gradeResult.label,
      Grade_Label: gradeResult.label,
      "Physical Area": areaStr,
      Gov: gov,
      Governorate: gov,
      ...(!isBlank(trackVal) ? { Track: trackVal } : {}),
      ...(!isBlank(course) ? { Course: String(course).trim() } : {}),
      ...(!isBlank(groupId) ? { Group_ID: String(groupId).trim() } : {}),
      ...(!isBlank(megaGroup) ? { Mega_Group: String(megaGroup).trim() } : {}),
    });
  }
  return out;
}

export interface NearbyLabDistance {
  rank: number;
  nearbyLabId: string;
  nearbyLabName?: string;
  nearbyArea?: string;
  nearbyLocationUrl?: string;
  distanceKm: number;
  distanceMethod?: string;
}

export interface LabRow {
  "Lab ID": string;
  Area: string;
  "Lab Capacity": number;
  "Lab Name"?: string;
  name?: string;
  Gov?: string;
  Governorate?: string;
  nearby_labs?: NearbyLabDistance[];
  nearbyLabs?: NearbyLabDistance[];
  [key: string]: unknown;
}

export async function loadLabCapacity(file: File, log: (msg: string) => void = () => {}): Promise<LabRow[]> {
  const aliases: Record<string, string> = {
    Lab_ID: "Lab ID",
    "LAB ID": "Lab ID",
    lab_id: "Lab ID",
    "Physical Area": "Area",
    Physical_Area: "Area",
    "physical area": "Area",
    Gov: "Governorate",
    gov: "Governorate",
    Governorate: "Governorate",
    "المحافظة": "Governorate",
    Lab_Capacity: "Lab Capacity",
    Capacity: "Lab Capacity",
    capacity: "Lab Capacity",
    Seats: "Lab Capacity",
    Lab_Name: "Lab Name",
    "Lab Name": "Lab Name",
    Name: "Lab Name",
    name: "Lab Name",
    "اسم المعمل": "Lab Name",
    // Nearby Distance Columns & Aliases
    "Nearby Rank": "Nearby Rank",
    Nearby_Rank: "Nearby Rank",
    "Nearby Lab Rank": "Nearby Rank",
    Nearby_Lab_Rank: "Nearby Rank",
    Rank: "Nearby Rank",
    rank: "Nearby Rank",
    nearby_rank: "Nearby Rank",
    "ترتيب القرب": "Nearby Rank",

    "Nearby Lab ID": "Nearby Lab ID",
    Nearby_Lab_ID: "Nearby Lab ID",
    "Nearby Lab Code": "Nearby Lab ID",
    Nearby_Lab_Code: "Nearby Lab ID",
    "Nearby Lab": "Nearby Lab ID",
    Nearby_Lab: "Nearby Lab ID",
    nearby_lab_id: "Nearby Lab ID",
    "كود المعمل المجاور": "Nearby Lab ID",

    "Nearby Lab Name": "Nearby Lab Name",
    Nearby_Lab_Name: "Nearby Lab Name",
    "Nearby Name": "Nearby Lab Name",
    Nearby_Name: "Nearby Lab Name",
    nearby_lab_name: "Nearby Lab Name",
    "اسم المعمل المجاور": "Nearby Lab Name",

    "Nearby Area": "Nearby Area",
    Nearby_Area: "Nearby Area",
    "Nearby Physical Area": "Nearby Area",
    Nearby_Physical_Area: "Nearby Area",
    nearby_area: "Nearby Area",
    "المنطقة المجاورة": "Nearby Area",

    "Nearby Location (Google Maps)": "Nearby Location (Google Maps)",
    "Nearby Location": "Nearby Location (Google Maps)",
    "Nearby Maps URL": "Nearby Location (Google Maps)",
    "Nearby Maps": "Nearby Location (Google Maps)",
    Nearby_Location: "Nearby Location (Google Maps)",
    Nearby_Maps_URL: "Nearby Location (Google Maps)",
    nearby_location_url: "Nearby Location (Google Maps)",
    nearby_maps_url: "Nearby Location (Google Maps)",
    "موقع المعمل المجاور": "Nearby Location (Google Maps)",

    "Distance (km)": "Distance (km)",
    "Distance (KM)": "Distance (km)",
    "Distance (Km)": "Distance (km)",
    "Distance(km)": "Distance (km)",
    Distance_km: "Distance (km)",
    Distance: "Distance (km)",
    distance_km: "Distance (km)",
    distance: "Distance (km)",
    "المسافة (كم)": "Distance (km)",
    "المسافة": "Distance (km)",

    "Distance Method": "Distance Method",
    Distance_Method: "Distance Method",
    Method: "Distance Method",
    distance_method: "Distance Method",
    "طريقة حساب المسافة": "Distance Method",
  };
  const table = await findSheetWithColumns(file, ["Lab ID", "Area", "Lab Capacity"], aliases);


  const labMap = new Map<string, LabRow>();
  const out: LabRow[] = [];
  let duplicateCount = 0;

  for (const row of table.rows) {
    const labId = row["Lab ID"];
    const area = row["Area"];
    const capRaw = row["Lab Capacity"];
    const cap = typeof capRaw === "number" ? capRaw : parseFloat(String(capRaw ?? "").replace(/,/g, ""));
    const labName = row["Lab Name"] ? String(row["Lab Name"]).trim() : undefined;
    const gov = row["Governorate"] || row["Gov"] ? String(row["Governorate"] || row["Gov"]).trim() : undefined;

    if (isBlank(labId) || isBlank(area) || !Number.isFinite(cap)) continue;
    const labIdStr = String(labId).trim();

    let labRow = labMap.get(labIdStr);
    if (!labRow) {
      labRow = {
        "Lab ID": labIdStr,
        Area: String(area).trim(),
        "Lab Capacity": Math.trunc(cap),
        ...(labName ? { "Lab Name": labName, name: labName } : {}),
        ...(gov ? { Gov: gov, Governorate: gov } : {}),
        nearby_labs: [],
        nearbyLabs: [],
      };
      labMap.set(labIdStr, labRow);
      out.push(labRow);
    } else {
      duplicateCount += 1;
    }

    // Check for nearby lab data in this row
    const nearbyLabIdRaw = row["Nearby Lab ID"];
    const nearbyRankRaw = row["Nearby Rank"];
    const nearbyLabNameRaw = row["Nearby Lab Name"];
    const nearbyAreaRaw = row["Nearby Area"];
    const nearbyLocationRaw = row["Nearby Location (Google Maps)"];
    const distanceRaw = row["Distance (km)"];
    const distanceMethodRaw = row["Distance Method"];

    const hasNearbyId = !isBlank(nearbyLabIdRaw);
    const hasDist = !isBlank(distanceRaw);
    const hasNearbyArea = !isBlank(nearbyAreaRaw);

    if (hasNearbyId || hasDist || hasNearbyArea) {
      const parsedRank = typeof nearbyRankRaw === "number"
        ? nearbyRankRaw
        : parseInt(String(nearbyRankRaw ?? "").trim(), 10);
      const parsedDist = typeof distanceRaw === "number"
        ? distanceRaw
        : parseFloat(String(distanceRaw ?? "").replace(/,/g, "").trim());

      const nearbyLabId = !isBlank(nearbyLabIdRaw) ? String(nearbyLabIdRaw).trim() : "";
      const nearbyLabName = !isBlank(nearbyLabNameRaw) ? String(nearbyLabNameRaw).trim() : undefined;
      const nearbyArea = !isBlank(nearbyAreaRaw) ? String(nearbyAreaRaw).trim() : undefined;
      const nearbyLocationUrl = !isBlank(nearbyLocationRaw) ? String(nearbyLocationRaw).trim() : undefined;
      const distanceMethod = !isBlank(distanceMethodRaw) ? String(distanceMethodRaw).trim() : undefined;

      const item: NearbyLabDistance = {
        rank: Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : (labRow.nearby_labs?.length ?? 0) + 1,
        nearbyLabId,
        ...(nearbyLabName ? { nearbyLabName } : {}),
        ...(nearbyArea ? { nearbyArea } : {}),
        ...(nearbyLocationUrl ? { nearbyLocationUrl } : {}),
        distanceKm: Number.isFinite(parsedDist) ? parsedDist : 0,
        ...(distanceMethod ? { distanceMethod } : {}),
      };

      // Prevent exact duplicate nearby entries for the same primary lab (do not drop distinct labs with same distance/area)
      const alreadyHas = labRow.nearby_labs?.some((n) => {
        if (nearbyLabId && n.nearbyLabId) {
          return n.nearbyLabId.toLowerCase() === nearbyLabId.toLowerCase();
        }
        if (!nearbyLabId && !n.nearbyLabId && nearbyLabName && n.nearbyLabName) {
          return n.nearbyLabName === nearbyLabName;
        }
        return false;
      });

      if (!alreadyHas) {
        labRow.nearby_labs!.push(item);
      }
    }
  }

  // Sort nearby_labs per lab by rank & distance ascending
  for (const lab of out) {
    if (lab.nearby_labs && lab.nearby_labs.length > 0) {
      lab.nearby_labs.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.distanceKm - b.distanceKm;
      });
      lab.nearbyLabs = lab.nearby_labs;
    }
  }

  if (duplicateCount > 0 && out.every((l) => (!l.nearby_labs || l.nearby_labs.length === 0))) {
    log(`WARNING: ${duplicateCount} duplicate Lab ID row(s) in the lab file -- kept the first occurrence of each.`);
  }
  return out;
}

/** Loads a dashboard template's rows (only "Lab ID" is required) without the
 * cleaning/typing applied to students/labs, since build_dashboard_output only
 * reads and rewrites specific cells on top of whatever the template already has. */
export async function loadDashboardTemplate(file: File): Promise<{ headers: string[]; rows: Row[] }> {
  const table = await findSheetWithColumns(file, ["Lab ID"]);
  const rows = table.rows.map((r) => ({ ...r, "Lab ID": isBlank(r["Lab ID"]) ? r["Lab ID"] : String(r["Lab ID"]).trim() }));
  return { headers: table.headers, rows };
}
