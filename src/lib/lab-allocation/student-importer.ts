import { fixMojibake } from "@/lib/sheet";
import { normalizeArabic, normalizeAreaCanonical, getGovForArea } from "@/lib/arabic";
import type { Student, AllocationIssue } from "./types";
import { getGradeLevelOption, parseGradeLevel } from "@/lib/project-grade-levels";

const S_ID_ALIASES = [
  "student : {{s_id}}",
  "student: {{s_id}}",
  "student:{{s_id}}",
  "{{s_id}}",
  "{{s id}}",
  "{{sid}}",
  "s_id",
  "s id",
  "sid",
  "student id",
  "student_id",
  "studentid",
  "student code",
  "student_code",
  "studentcode",
  "student",
  "id",
  "code",
  "كود الطالب",
  "رقم الطالب",
  "كود",
  "الرقم القومي",
  "national id",
  "national_id",
];

const GRADE_ALIASES = [
  "grade (25-26)",
  "grade (24-25)",
  "grade(25-26)",
  "grade(24-25)",
  "grade",
  "grade level",
  "grade_level",
  "class",
  "الصف",
  "المرحلة",
  "السنة الدراسية",
  "المستوى",
  "مرحلة",
  "صف",
];

const AREA_ALIASES = [
  "physical area",
  "physical_area",
  "physicalarea",
  "area",
  "physical location",
  "gov",
  "governorate",
  "المنطقة",
  "المحافظة",
  "المنطقه",
  "الموقع",
  "المكان",
  "المدينة",
  "city",
  "location",
  "center",
  "المركز",
];

const GOV_ALIASES = [
  "gov",
  "governorate",
  "المحافظة",
  "المحافظه",
];

const GROUP_ID_ALIASES = [
  "group id",
  "group_id",
  "groupid",
  "group",
  "group code",
  "رقم المجموعة",
  "كود المجموعة",
  "المجموعة",
];

const LOCATION_ID_ALIASES = [
  "location id",
  "location_id",
  "locationid",
  "location",
  "مكان",
  "مقر",
];

const LAB_SHEET_SIGNATURES = [
  "lab id",
  "lab_id",
  "lab capacity",
  "vendor name",
  "center name",
  "lab name",
  "اسم المشرف",
  "رقم المشرف",
  "اسم الميسر",
  "رقم الميسر",
  "عدد الطلاب بالمعمل",
  "thu 9 am grade",
  "thu 9 am",
];

export function detectSheetType(
  rows: Record<string, unknown>[],
): "students" | "labs" | "unknown" {
  if (!rows || rows.length === 0) return "unknown";
  const allKeys = Object.keys(rows[0] || {}).map((k) =>
    k.trim().toLowerCase(),
  );

  const labSignatureCount = LAB_SHEET_SIGNATURES.filter((sig) =>
    allKeys.some((k) => k.includes(sig) || sig.includes(k)),
  ).length;

  if (labSignatureCount >= 2) {
    return "labs";
  }

  const hasStudentId = S_ID_ALIASES.some((alias) => allKeys.includes(alias));
  const hasGrade = GRADE_ALIASES.some((alias) => allKeys.includes(alias));
  if (hasStudentId || (hasGrade && allKeys.some((k) => AREA_ALIASES.includes(k)))) {
    return "students";
  }

  return "unknown";
}

export function normalizeGrade(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const str = fixMojibake(raw).toString().trim();
  if (!str) return null;

  const parsed = parseGradeLevel(str);
  if (parsed != null) return getGradeLevelOption(parsed)?.track ? String(parsed) : `G${parsed}`;

  // Retain Arabic DEMI grade aliases used by existing files.
  const normAr = normalizeArabic(str);
  if (normAr.includes("رابع") || normAr.includes("الرابع") || normAr.includes("4")) return "G4";
  if (normAr.includes("خامس") || normAr.includes("الخامس") || normAr.includes("5")) return "G5";
  if (normAr.includes("سادس") || normAr.includes("السادس") || normAr.includes("6")) return "G6";

  return null;
}

export function normalizePhysicalArea(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const fixed = fixMojibake(raw).toString().trim();
  return normalizeAreaCanonical(fixed);
}

export type StudentImportResult = {
  validStudents: Student[];
  invalidRows: { rowNumber: number; rawRow: Record<string, unknown>; issues: AllocationIssue[] }[];
  issues: AllocationIssue[];
  detectedAreas: string[];
  detectedGrades: string[];
  totalRowsProcessed: number;
  detectedFileType: "students" | "labs" | "unknown";
  detectedHeaders: string[];
  mappedColumns: {
    sIdCol: string | null;
    gradeCol: string | null;
    areaCol: string | null;
  };
  reasonsSummary: Record<string, number>;
};

export function parseAndValidateStudents(
  rows: Record<string, unknown>[],
): StudentImportResult {
  const validStudents: Student[] = [];
  const invalidRows: StudentImportResult["invalidRows"] = [];
  const issues: AllocationIssue[] = [];
  const seenSIds = new Map<string, number>(); // sId -> first seen row number
  const areasSet = new Set<string>();
  const gradesSet = new Set<string>();
  const reasonsSummary: Record<string, number> = {};

  const detectedFileType = detectSheetType(rows);
  const detectedHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];

  // Identify column keys once from the first row or header keys
  const findColumnKey = (aliases: string[]): string | null => {
    // 1. Exact match
    for (const header of detectedHeaders) {
      const clean = header.trim().toLowerCase();
      if (aliases.some((alias) => alias.toLowerCase() === clean)) {
        return header;
      }
    }
    // 2. Normalized match (stripping braces, colons, underscores, dashes, spaces)
    for (const header of detectedHeaders) {
      const stripped = header
        .trim()
        .toLowerCase()
        .replace(/[{}:_\-\s]/g, "");
      for (const alias of aliases) {
        const aliasStripped = alias.toLowerCase().replace(/[{}:_\-\s]/g, "");
        if (
          stripped === aliasStripped ||
          (aliasStripped.length >= 3 && stripped.includes(aliasStripped)) ||
          (stripped.length >= 3 && aliasStripped.includes(stripped))
        ) {
          return header;
        }
      }
    }
    return null;
  };

  const sIdCol = findColumnKey(S_ID_ALIASES);
  const gradeCol = findColumnKey(GRADE_ALIASES);
  const areaCol = findColumnKey(AREA_ALIASES);
  const govCol = findColumnKey(GOV_ALIASES);
  const groupIdCol = findColumnKey(GROUP_ID_ALIASES);
  const locationIdCol = findColumnKey(LOCATION_ID_ALIASES);

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // Excel 1-based index (Header is row 1)
    const rowKeys = Object.keys(row);

    // Check if entire row is empty
    const hasAnyContent = rowKeys.some((k) => {
      const val = row[k];
      return val !== null && val !== undefined && String(val).trim() !== "";
    });
    if (!hasAnyContent) return; // Skip empty rows

    // Find S_ID
    const rawSId = sIdCol ? String(row[sIdCol] ?? "").trim() : "";

    // Find Grade
    const rawGrade = gradeCol ? String(row[gradeCol] ?? "").trim() : "";
    const normalizedGrade = normalizeGrade(rawGrade);

    // Find Area
    const rawArea = areaCol ? String(row[areaCol] ?? "").trim() : "";
    const normalizedArea = normalizePhysicalArea(rawArea);

    const rawGov = govCol ? String(row[govCol] ?? "").trim() : "";
    const rawGroupId = groupIdCol ? String(row[groupIdCol] ?? "").trim() : "";
    const rawLocationId = locationIdCol ? String(row[locationIdCol] ?? "").trim() : "";

    const rowIssues: AllocationIssue[] = [];

    // 1. Validate S_ID
    if (!rawSId) {
      const reason = sIdCol
        ? `S_ID value is empty in column "${sIdCol}"`
        : `Student ID column (S_ID) was not found in headers [${detectedHeaders.slice(0, 5).join(", ")}...]`;
      reasonsSummary[reason] = (reasonsSummary[reason] || 0) + 1;

      rowIssues.push({
        id: `issue-row-${rowNumber}-missing-sid`,
        type: "MISSING_S_ID",
        level: "error",
        message: `Row ${rowNumber}: ${reason}`,
        rowNumber,
      });
    } else if (seenSIds.has(rawSId)) {
      const firstRow = seenSIds.get(rawSId)!;
      const reason = `Duplicate S_ID "${rawSId}" (previously seen on Row ${firstRow})`;
      reasonsSummary["Duplicate Student ID"] =
        (reasonsSummary["Duplicate Student ID"] || 0) + 1;

      rowIssues.push({
        id: `issue-row-${rowNumber}-dup-sid`,
        type: "DUPLICATE_STUDENT",
        level: "error",
        message: `Row ${rowNumber}: ${reason}`,
        sId: rawSId,
        rowNumber,
      });
    } else {
      seenSIds.set(rawSId, rowNumber);
    }

    // 2. Validate Grade
    if (!rawGrade) {
      const reason = gradeCol
        ? `Grade value is empty in column "${gradeCol}"`
        : `Grade column was not found in sheet headers`;
      reasonsSummary[reason] = (reasonsSummary[reason] || 0) + 1;

      rowIssues.push({
        id: `issue-row-${rowNumber}-missing-grade`,
        type: "MISSING_GRADE",
        level: "error",
        message: `Row ${rowNumber}: ${reason}`,
        sId: rawSId || undefined,
        rowNumber,
      });
    } else if (!normalizedGrade) {
      const reason = `Unrecognized Grade format "${rawGrade}"`;
      reasonsSummary[reason] = (reasonsSummary[reason] || 0) + 1;

      rowIssues.push({
        id: `issue-row-${rowNumber}-invalid-grade`,
        type: "INVALID_STUDENT_DATA",
        level: "error",
        message: `Row ${rowNumber}: ${reason}`,
        sId: rawSId || undefined,
        rowNumber,
      });
    }

    // 3. Validate Area
    if (!rawArea) {
      const reason = areaCol
        ? `Physical Area is empty in column "${areaCol}"`
        : `Physical Area column was not found in sheet headers`;
      reasonsSummary[reason] = (reasonsSummary[reason] || 0) + 1;

      rowIssues.push({
        id: `issue-row-${rowNumber}-missing-area`,
        type: "MISSING_AREA",
        level: "error",
        message: `Row ${rowNumber}: ${reason}`,
        sId: rawSId || undefined,
        rowNumber,
      });
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      invalidRows.push({ rowNumber, rawRow: row, issues: rowIssues });
    } else {
      const student: Student = {
        sId: rawSId,
        grade: normalizedGrade!,
        physicalArea: normalizedArea,
        rowNumber,
        rawGrade,
        rawArea,
        gov: rawGov ? normalizePhysicalArea(rawGov) : getGovForArea(normalizedArea),
        groupId: rawGroupId || undefined,
        locationId: rawLocationId || undefined,
      };
      validStudents.push(student);
      areasSet.add(normalizedArea);
      gradesSet.add(normalizedGrade!);
    }
  });

  return {
    validStudents,
    invalidRows,
    issues,
    detectedAreas: Array.from(areasSet).sort(),
    detectedGrades: Array.from(gradesSet).sort(),
    totalRowsProcessed: rows.length,
    detectedFileType,
    detectedHeaders,
    mappedColumns: {
      sIdCol,
      gradeCol,
      areaCol,
    },
    reasonsSummary,
  };
}
