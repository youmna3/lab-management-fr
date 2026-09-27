import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";
import type { MegaGroupDefinition } from "@/lib/allocation-client";
import { formatTimeSlot, normalizeTimeSlots } from "@/lib/time-slots";

export interface TimelineRow {
  id: string;
  projectName?: string;
  date: string; // ISO YYYY-MM-DD
  dayName: string; // Sunday, Monday, etc.
  batchName: string;
  sessionType: "SG" | "Multi";
  subGroup: string; // "Group A", "Group B", etc. or ""
  isBlocked: boolean; // Renamed from isOffline: indicates whether this day has no teaching sessions
  isOffline?: boolean; // Backward compatibility alias
  timeSlots?: string[]; // optional custom slots for that day
}

export interface ParsedProjectTimeline {
  projectName: string;
  program: Database["public"]["Enums"]["program"];
  code?: string;
  startDate: string;
  endDate: string;
  blockedDays: string[];
  offlineDays?: string[]; // Backward compatibility alias
  batches: Array<{
    name: string;
    groupDistributionMode: "single_session" | "multi_session";
    expectedSessionsPerGroup: number;
    dates: string[];
    timeSlots: string[];
    blockedDays: string[];
    megaGroups: MegaGroupDefinition[];
  }>;
  rows: TimelineRow[];
  validationErrors: string[];
  validationWarnings: string[];
}

/**
 * Normalizes user-entered date strings (ISO, DD/MM/YYYY, MM/DD/YYYY, or standard formats) to YYYY-MM-DD.
 */
export function normalizeDateToIso(rawDate: unknown): string | null {
  if (!rawDate) return null;

  // Handle Excel Serial date numbers (e.g. 46278)
  if (typeof rawDate === "number" && !isNaN(rawDate)) {
    const parsedFromExcel = XLSX.SSF.parse_date_code(rawDate);
    if (parsedFromExcel && parsedFromExcel.y && parsedFromExcel.m && parsedFromExcel.d) {
      const y = parsedFromExcel.y;
      const m = String(parsedFromExcel.m).padStart(2, "0");
      const d = String(parsedFromExcel.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  const str = String(rawDate).trim();
  if (!str) return null;

  // Match ISO YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, "0");
    const d = isoMatch[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY
  const ukMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (ukMatch) {
    const d = ukMatch[1].padStart(2, "0");
    const m = ukMatch[2].padStart(2, "0");
    const y = ukMatch[3];
    // Check if month > 12 -> then it was MM/DD/YYYY
    if (Number(m) > 12 && Number(d) <= 12) {
      return `${y}-${d}-${m}`;
    }
    return `${y}-${m}-${d}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (y >= 2020 && y <= 2035) {
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  return null;
}

/**
 * Robust date-to-ISO formatter that uses local year, month, and day to prevent timezone shifts.
 */
export function formatLocalDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Single canonical source of truth for visit counts across the entire application.
 * - Single Group (SG / single_session) is always strictly 1.
 * - Multi-Session requires an explicit batch-level visit count (minimum 2).
 */
export function getCanonicalVisitCount(params?: {
  mode?: "single_session" | "multi_session" | string | null;
  expectedSessionsPerGroup?: number | null;
  repeatCount?: number | null;
  defaultRepeatCount?: number | null;
}): number {
  if (!params) return 1;
  const mode = params.mode || (params.expectedSessionsPerGroup && Number(params.expectedSessionsPerGroup) > 1 ? "multi_session" : "single_session");
  const isSingle = mode === "single_session" || mode === "SG" || mode === "single";
  if (isSingle) return 1;

  if (params.expectedSessionsPerGroup !== undefined && params.expectedSessionsPerGroup !== null && Number(params.expectedSessionsPerGroup) > 1) {
    return Math.max(2, Math.round(Number(params.expectedSessionsPerGroup)));
  }
  if (params.repeatCount !== undefined && params.repeatCount !== null && Number(params.repeatCount) > 1) {
    return Math.max(2, Math.round(Number(params.repeatCount)));
  }
  if (params.defaultRepeatCount !== undefined && params.defaultRepeatCount !== null && Number(params.defaultRepeatCount) > 1) {
    return Math.max(2, Math.round(Number(params.defaultRepeatCount)));
  }
  throw new Error("Multi-Session batches require an explicit Sessions / Group value in Batch Settings.");
}

/**
 * Returns English Day-of-week for an ISO date string.
 */
export function getDayNameFromDate(isoDate: string): string {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

/**
 * Normalizes session type to SG or Multi.
 */
export function normalizeSessionType(raw: unknown): "SG" | "Multi" {
  const str = String(raw ?? "").trim().toLowerCase();
  if (str.includes("sg") || str.includes("single") || str.includes("واحد") || str.includes("فردي")) {
    return "SG";
  }
  return "Multi";
}

/**
 * Normalizes blocked status (Y/N, Yes/No, True/False, نعم/لا, Offline, Blocked).
 */
export function normalizeBlockedStatus(raw: unknown): boolean {
  const str = String(raw ?? "").trim().toLowerCase();
  if (!str) return false;
  return (
    str === "y" ||
    str === "yes" ||
    str === "true" ||
    str === "1" ||
    str === "blocked" ||
    str === "offline" ||
    str.includes("نعم") ||
    str.includes("مغلق") ||
    str.includes("عطلة") ||
    str.includes("اجازة") ||
    str.includes("إجازة")
  );
}

// Backward compatibility alias
export const normalizeOfflineStatus = normalizeBlockedStatus;

/**
 * Normalizes sub-group string (e.g. "A" -> "Group A", "Group B" -> "Group B").
 */
export function normalizeSubGroupName(raw: unknown): string {
  const str = String(raw ?? "").trim();
  if (!str) return "";
  if (/^group\s+/i.test(str)) return str;
  if (/^[a-z0-9]+$/i.test(str)) return `Group ${str.toUpperCase()}`;
  return str;
}

/**
 * Parses raw tabular rows (from XLSX / CSV) into structured timeline model.
 */
export function parseTimelineSpreadsheetRows(
  rawRows: Array<Record<string, unknown>>,
  defaultProjectName: string = "New Project"
): ParsedProjectTimeline {
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];
  const timelineRows: TimelineRow[] = [];

  if (!rawRows || rawRows.length === 0) {
    validationErrors.push("The uploaded file does not contain any data rows.");
    return {
      projectName: defaultProjectName,
      program: inferProgramFromProjectName(defaultProjectName),
      startDate: "",
      endDate: "",
      blockedDays: [],
      offlineDays: [],
      batches: [],
      rows: [],
      validationErrors,
      validationWarnings,
    };
  }

  // Find header keys with aliases and robust unicode normalization
  const sampleRow = rawRows[0] || {};
  const findKey = (candidates: string[]): string | null => {
    const keys = Object.keys(sampleRow);
    const clean = (s: string) => s.trim().toLowerCase().replace(/[\s_\-\/\\]+/g, "");
    for (const c of candidates) {
      const cleanC = clean(c);
      if (!cleanC) continue;
      const match = keys.find((k) => {
        const cleanK = clean(k);
        if (!cleanK) return false;
        return (
          cleanK === cleanC ||
          (cleanC.length >= 4 && cleanK.includes(cleanC)) ||
          (cleanK.length >= 4 && cleanC.includes(cleanK))
        );
      });
      if (match) return match;
    }
    return null;
  };

  const projectKey = findKey(["projectname", "project", "program", "اسم_المشروع", "المشروع"]);
  const dateKey = findKey(["date", "daydate", "sessiondate", "التاريخ", "تاريخ"]);
  const dayKey = findKey(["dayname", "dayofweek", "day", "اليوم"]);
  const batchKey = findKey(["batchname", "batch", "intake", "الدفعة", "المجموعة", "اسم_الدفعة"]);
  const sessionTypeKey = findKey(["sessiontype", "type", "session", "نوع_الجلسة", "نوع"]);
  const subGroupKey = findKey(["subgroup", "megagroup", "groupa", "المجموعة_الفرعية"]);
  const blockedKey = findKey([
    "blockedday",
    "blocked",
    "isblocked",
    "offlineblocked",
    "offline",
    "offlineday",
    "مغلق",
    "عطلة",
    "اجازة",
    "إجازة",
  ]);

  let globalProjectName = defaultProjectName;

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2; // 1-indexed row number in spreadsheet (accounting for header)
    const rawProject = projectKey ? row[projectKey] : undefined;
    const rawDate = dateKey ? row[dateKey] : undefined;
    const rawDay = dayKey ? row[dayKey] : undefined;
    const rawBatch = batchKey ? row[batchKey] : undefined;
    const rawSessionType = sessionTypeKey ? row[sessionTypeKey] : undefined;
    const rawSubGroup = subGroupKey ? row[subGroupKey] : undefined;
    const rawBlocked = blockedKey ? row[blockedKey] : undefined;

    // Skip empty rows
    if (!rawDate && !rawBatch && !rawProject) return;

    const isoDate = normalizeDateToIso(rawDate);
    if (!isoDate) {
      validationErrors.push(`Row ${rowNum}: Invalid or missing date "${rawDate}".`);
      return;
    }

    const pName = String(rawProject || globalProjectName || defaultProjectName).trim();
    if (globalProjectName === "New Project" && pName) globalProjectName = pName;

    const bName = String(rawBatch || "Batch 1").trim();
    const sessionType = normalizeSessionType(rawSessionType);
    const subGroup = sessionType === "Multi" ? normalizeSubGroupName(rawSubGroup) || "Group A" : "";
    const isBlocked = normalizeBlockedStatus(rawBlocked);
    const dayName = String(rawDay || "").trim() || getDayNameFromDate(isoDate);

    timelineRows.push({
      id: `row-${idx + 1}-${Date.now()}`,
      projectName: pName,
      date: isoDate,
      dayName,
      batchName: bName,
      sessionType,
      subGroup,
      isBlocked,
      isOffline: isBlocked,
    });
  });

  if (timelineRows.length === 0 && validationErrors.length === 0) {
    validationErrors.push("No valid schedule rows found in the uploaded file.");
  }

  // Deduplicate and group by Project & Batch
  return buildProjectTimelineFromRows(timelineRows, validationErrors, validationWarnings, globalProjectName);
}

/**
 * Builds the canonical ParsedProjectTimeline data model from a list of TimelineRow items.
 */
export function buildProjectTimelineFromRows(
  rows: TimelineRow[],
  existingErrors: string[] = [],
  existingWarnings: string[] = [],
  fallbackProjectName: string = "New Project"
): ParsedProjectTimeline {
  const validationErrors = [...existingErrors];
  const validationWarnings = [...existingWarnings];

  if (rows.length === 0) {
    return {
      projectName: fallbackProjectName,
      program: inferProgramFromProjectName(fallbackProjectName),
      startDate: "",
      endDate: "",
      blockedDays: [],
      offlineDays: [],
      batches: [],
      rows,
      validationErrors,
      validationWarnings,
    };
  }

  const pName = rows.find((r) => r.projectName)?.projectName || fallbackProjectName;
  const allDates = [...new Set(rows.map((r) => r.date))].sort();
  const startDate = allDates[0] || "";
  const endDate = allDates[allDates.length - 1] || "";

  // Project-level blocked days: dates where all batch sessions on that day are marked blocked
  const blockedDays = [...new Set(rows.filter((r) => r.isBlocked || r.isOffline).map((r) => r.date))].sort();

  // Group rows by batch
  const batchMap = new Map<string, TimelineRow[]>();
  rows.forEach((r) => {
    const bName = r.batchName || "Batch 1";
    if (!batchMap.has(bName)) batchMap.set(bName, []);
    batchMap.get(bName)!.push(r);
  });

  const parsedBatches: ParsedProjectTimeline["batches"] = [];

  for (const [batchName, bRows] of batchMap.entries()) {
    const bDates = [...new Set(bRows.map((r) => r.date))].sort();
    const bBlockedDates = [...new Set(bRows.filter((r) => r.isBlocked || r.isOffline).map((r) => r.date))].sort();
    const activeSessionRows = bRows.filter((r) => !r.isBlocked && !r.isOffline);

    const hasMulti = bRows.some((r) => r.sessionType === "Multi");
    const groupDistributionMode: "single_session" | "multi_session" = hasMulti ? "multi_session" : "single_session";

    const megaGroups: MegaGroupDefinition[] = [];

    if (groupDistributionMode === "multi_session") {
      // Group active rows by subGroup
      const subGroupMap = new Map<string, string[]>();
      activeSessionRows.forEach((r) => {
        const sg = r.subGroup || "Group A";
        if (!subGroupMap.has(sg)) subGroupMap.set(sg, []);
        if (!subGroupMap.get(sg)!.includes(r.date)) {
          subGroupMap.get(sg)!.push(r.date);
        }
      });

      // If no subGroups explicitly defined, default to Group A & Group B split across available dates
      if (subGroupMap.size === 0) {
        const activeDates = bDates.filter((d) => !bBlockedDates.includes(d));
        const mid = Math.ceil(activeDates.length / 2);
        subGroupMap.set("Group A", activeDates.slice(0, mid));
        subGroupMap.set("Group B", activeDates.slice(mid));
      }

      for (const [sgName, sgDates] of subGroupMap.entries()) {
        const sortedSgDates = [...sgDates].sort();
        const mgStart = sortedSgDates[0] || startDate;
        const mgEnd = sortedSgDates[sortedSgDates.length - 1] || endDate;

        megaGroups.push({
          id: `mg_${sgName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          name: sgName,
          start_date: mgStart,
          end_date: mgEnd,
          dates: sortedSgDates,
          grades: [],
          areas: [],
          time_slots: [],
        });
      }

      // Sort mega groups by start date
      megaGroups.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
    }

    // Expected sessions per student: canonical single source of truth (1 for SG, >=2 for Multi)
    const importedSessionsPerGroup = groupDistributionMode === "multi_session"
      ? Math.max(
          2,
          ...Array.from(
            activeSessionRows.reduce((counts, row) => {
              const key = row.subGroup || "Group A";
              const dates = counts.get(key) || new Set<string>();
              dates.add(row.date);
              counts.set(key, dates);
              return counts;
            }, new Map<string, Set<string>>()).values(),
          ).map((dates) => dates.size),
        )
      : 1;
    const expectedSessionsPerGroup = getCanonicalVisitCount({
      mode: groupDistributionMode,
      expectedSessionsPerGroup: importedSessionsPerGroup,
    });

    // Sanity validations
    if (activeSessionRows.length === 0) {
      validationWarnings.push(`Batch "${batchName}": All ${bRows.length} scheduled day(s) are marked as Blocked.`);
    }

    if (groupDistributionMode === "multi_session" && megaGroups.some((mg) => !mg.dates || mg.dates.length === 0)) {
      validationWarnings.push(`Batch "${batchName}": One or more Mega Groups have 0 active visit dates.`);
    }

    parsedBatches.push({
      name: batchName,
      groupDistributionMode,
      expectedSessionsPerGroup,
      dates: bDates,
      timeSlots: ["10:00", "12:30", "16:00", "19:30"], // Standard 4 default daily slots
      blockedDays: bBlockedDates,
      megaGroups,
    });
  }

  const program = inferProgramFromProjectName(pName);

  return {
    projectName: pName,
    program,
    startDate,
    endDate,
    blockedDays,
    offlineDays: blockedDays,
    batches: parsedBatches,
    rows,
    validationErrors,
    validationWarnings,
  };
}

/**
 * Infers program type enum from project name (DECI or DEMI).
 */
export function inferProgramFromProjectName(projectName: string): Database["public"]["Enums"]["program"] {
  const pLower = projectName.toLowerCase();
  if (pLower.includes("deci")) return "DECI";
  return "DEMI";
}

/**
 * Generates downloadable Excel (.xlsx) and CSV template buffers with the clean 6-column format.
 */
export function generateTimelineTemplateFiles(): { xlsxBuffer: Uint8Array; csvContent: string } {
  const sampleData = [
    {
      Date: "2026-09-13",
      Day: "Sunday",
      "Batch Name": "Cohort 1",
      "Session Type": "SG",
      "Sub-Group": "",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-14",
      Day: "Monday",
      "Batch Name": "Cohort 1",
      "Session Type": "SG",
      "Sub-Group": "",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-15",
      Day: "Tuesday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group A",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-16",
      Day: "Wednesday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group A",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-17",
      Day: "Thursday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group A",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-18",
      Day: "Friday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group A",
      "Blocked Day": "Yes",
    },
    {
      Date: "2026-09-20",
      Day: "Sunday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group B",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-21",
      Day: "Monday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group B",
      "Blocked Day": "No",
    },
    {
      Date: "2026-09-22",
      Day: "Tuesday",
      "Batch Name": "Cohort 2",
      "Session Type": "Multi",
      "Sub-Group": "Group B",
      "Blocked Day": "No",
    },
  ];

  // Build XLSX
  const ws = XLSX.utils.json_to_sheet(sampleData);
  // Column widths for 6 clean columns
  ws["!cols"] = [
    { wch: 14 }, // Date
    { wch: 12 }, // Day
    { wch: 16 }, // Batch Name
    { wch: 14 }, // Session Type
    { wch: 14 }, // Sub-Group
    { wch: 16 }, // Blocked Day
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timeline_Template");
  const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  // Build CSV
  const csvContent = XLSX.utils.sheet_to_csv(ws);

  return {
    xlsxBuffer: new Uint8Array(xlsxBuffer),
    csvContent,
  };
}
