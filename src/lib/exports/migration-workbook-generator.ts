import * as XLSX from "xlsx";
import { formatGradeLevel, getGradeLevelOption, parseGradeLevel } from "@/lib/project-grade-levels";
import type { Tables } from "@/integrations/supabase/types";
import type { BatchAllocationOutputRecord, StudentRecord } from "@/lib/batch-allocation-storage";
import { type SlotIdTemplate, type OnlineMigrationSuggestion, isVpStudent } from "@/lib/allocation-client";

export interface MigrationExportInput {
  project: {
    id: string;
    name: string;
    code?: string | null;
    program?: string | null;
  };
  batch: {
    id: string;
    name: string;
    dates: string[];
    time_slots: string[];
  };
  allocationData?: {
    master_allocation?: any[];
    unassigned?: any[];
    lab_grid_matrix?: any[];
    summary?: any;
    preferences_applied?: any;
    online_migration_suggestions?: OnlineMigrationSuggestion[];
  } | null;
  labs?: any[];
  students?: StudentRecord[];
  slotIdTemplate?: SlotIdTemplate;
  slotIdStartInteger?: number;
}

/**
 * Converts any date string or Date object into strict "D-Mon-YYYY" format.
 * Example: "2026-09-09" -> "9-Sep-2026", "2026-09-10" -> "10-Sep-2026"
 */
export function formatMigrationDate(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return "";
  const str = String(dateInput).trim();
  if (!str) return "";

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // 1. Check if ISO string: YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    if (m >= 0 && m < 12) {
      return `${d}-${monthNames[m]}-${y}`;
    }
  }

  // 2. Check if D-Mon-YYYY or DD-Mon-YYYY already
  const dMonYMatch = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dMonYMatch) {
    const d = parseInt(dMonYMatch[1], 10);
    const mon = dMonYMatch[2].slice(0, 3);
    const y = dMonYMatch[3];
    return `${d}-${mon[0].toUpperCase() + mon.slice(1).toLowerCase()}-${y}`;
  }

  // 3. Fallback standard Date parsing
  try {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
      const d = dt.getDate();
      const mon = monthNames[dt.getMonth()];
      const y = dt.getFullYear();
      return `${d}-${mon}-${y}`;
    }
  } catch {}

  return str;
}

/**
 * Returns the actual English weekday name (e.g. "Thursday", "Friday", "Monday", "Tuesday").
 */
export function getWeekdayName(dateOrDay: string | Date | undefined | null): string {
  if (!dateOrDay) return "Thursday";
  const str = String(dateOrDay).trim();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const exact = days.find((d) => d.toLowerCase() === str.toLowerCase());
  if (exact) return exact;

  try {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString("en-US", { weekday: "long" });
    }
  } catch {}

  return str || "Thursday";
}

/**
 * Formats a grade string for exports.
 * For DECI program exports specifically, maps to structured Track + Level labels:
 * - Computer Fundamentals Level 1
 * - Computer Advanced Level 2
 * - Cyber Security Level 3 / Level 4 / Level 5
 * - Digital Arts Level 3 / Level 4 / Level 5
 * - Web Development Level 3 / Level 4 / Level 5
 * - Data Science Level 3 / Level 4 / Level 5
 * - Embedded Systems Level 3 / Level 4 / Level 5
 */
export function formatDeciGrade(
  rawGrade: any,
  program?: string | null,
  trackHint?: string | null,
): string {
  const isDeci = String(program || "").toUpperCase().includes("DECI");
  const gradeStr = String(rawGrade ?? "").trim();

  if (!isDeci) {
    return gradeStr ? formatGradeLevel(gradeStr, "DEMI") : "Unknown grade";
  }

  const encodedGrade = parseGradeLevel(rawGrade, "DECI");
  if (encodedGrade != null && getGradeLevelOption(encodedGrade)?.track) {
    return formatGradeLevel(encodedGrade, "DECI");
  }

  const validDeciLabels = [
    "Computer Fundamentals Level 1",
    "Computer Advanced Level 2",
    "Cyber Security Level 3",
    "Cyber Security Level 4",
    "Cyber Security Level 5",
    "Cyber Security L3",
    "Cyber Security L4",
    "Cyber Security L5",
    "Digital Arts Level 3",
    "Digital Arts Level 4",
    "Digital Arts Level 5",
    "Digital Arts L3",
    "Digital Arts L4",
    "Digital Arts L5",
    "Web Development Level 3",
    "Web Development Level 4",
    "Web Development Level 5",
    "Web Development L3",
    "Web Development L4",
    "Web Development L5",
    "Data Science Level 3",
    "Data Science Level 4",
    "Data Science Level 5",
    "Data Science L3",
    "Data Science L4",
    "Data Science L5",
    "Embedded Systems Level 3",
    "Embedded Systems Level 4",
    "Embedded Systems Level 5",
    "Embedded Systems L3",
    "Embedded Systems L4",
    "Embedded Systems L5",
  ];

  const matched = validDeciLabels.find((l) => l.toLowerCase() === gradeStr.toLowerCase());
  if (matched) return matched;

  const numMatch = gradeStr.match(/\d+/);
  const gradeNum = numMatch ? parseInt(numMatch[0], 10) : 1;

  if (gradeNum === 1 || gradeStr.toLowerCase().includes("fundamental")) {
    return "Computer Fundamentals Level 1";
  }
  if (gradeNum === 2 || gradeStr.toLowerCase().includes("advanced")) {
    return "Computer Advanced Level 2";
  }

  const knownTracks = [
    "Cyber Security",
    "Digital Arts",
    "Web Development",
    "Data Science",
    "Embedded Systems",
  ];

  const hint = String(trackHint || "").trim();
  const foundTrack = knownTracks.find(
    (t) =>
      hint.toLowerCase().includes(t.toLowerCase()) ||
      gradeStr.toLowerCase().includes(t.toLowerCase()),
  );

  const level = gradeNum >= 3 && gradeNum <= 5 ? gradeNum : 3;
  if (foundTrack) {
    return `${foundTrack} Level ${level}`;
  }

  // Deterministic track fallback by level when track is unspecified in raw data
  if (gradeNum === 3) return "Cyber Security Level 3";
  if (gradeNum === 4) return "Web Development Level 4";
  if (gradeNum === 5) return "Data Science Level 5";

  return `Web Development Level ${level}`;
}

/**
 * Configurable Slot ID generator with 6-char hard constraint:
 * - Template A — Pure integer, incrementing: e.g. "14000", "14001", "14002" (max 6 chars)
 * - Template B — Mixed (Lab + Grade/Group): alphanumeric e.g. "L556G4", "L123G4" (max 6 chars)
 * - Keep Original — "SLOT-{LAB}-{DAY}-{TIME}-{GRADE}"
 */
export function generateSlotId(
  labCode: string,
  day: string,
  timeSlot: string,
  grade: string | number,
  template: SlotIdTemplate = "original",
  sequentialIndex: number = 0,
  startInt: number = 14000,
): string {
  if (template === "template_a") {
    const intVal = startInt + sequentialIndex;
    const str = String(intVal);
    // Hard constraint: 6 chars maximum
    return str.length > 6 ? str.slice(-6) : str;
  }

  if (template === "template_b") {
    // Alphanumeric combining lab identifier and grade/group. Hard constraint: 6 chars maximum!
    const cleanGrade = String(grade).replace(/[^0-9a-zA-Z]/g, "").slice(0, 2) || "4";
    const gradePart = `G${cleanGrade}`.slice(0, 2); // e.g. "G4"

    let labPart = String(labCode || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (labPart.startsWith("LAB") && labPart.length > 4) {
      labPart = "L" + labPart.slice(3);
    }
    const maxLabLen = Math.max(1, 6 - gradePart.length);
    labPart = labPart.slice(0, maxLabLen);

    const combined = `${labPart}${gradePart}`.slice(0, 6).toUpperCase();
    return combined;
  }

  // Original format
  const cleanLab = String(labCode || "LAB").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const cleanDay = String(day || "DAY").slice(0, 3).toUpperCase();
  const startPart = String(timeSlot || "").split("-")[0] || timeSlot;
  const cleanTime =
    startPart.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "SLOT";
  const cleanGrade = `G${String(grade).replace(/[^0-9]/g, "") || "4"}`;
  return `SLOT-${cleanLab}-${cleanDay}-${cleanTime}-${cleanGrade}`;
}

/**
 * Formats Offline Student single slot-descriptor:
 * Pattern: "2026-09-10 10 Sept 10:00 AM (SLOT_ID)"
 */
export function formatOfflineSlotDescriptor(
  dateInput: string | Date | undefined | null,
  timeSlotInput: string | undefined | null,
  slotId: string,
): string {
  let isoDate = "2026-09-10";
  let dayMon = "10 Sept";

  const monthNamesLong = [
    "Jan", "Feb", "March", "April", "May", "June",
    "July", "Aug", "Sept", "Oct", "Nov", "Dec",
  ];

  if (dateInput) {
    const rawStr = String(dateInput).trim();
    const isoMatch = rawStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      isoDate = isoMatch[0];
      const mIdx = parseInt(isoMatch[2], 10) - 1;
      const d = parseInt(isoMatch[3], 10);
      dayMon = `${d} ${monthNamesLong[mIdx] || "Sept"}`;
    } else {
      try {
        const dt = new Date(rawStr);
        if (!isNaN(dt.getTime())) {
          isoDate = dt.toISOString().split("T")[0];
          dayMon = `${dt.getDate()} ${monthNamesLong[dt.getMonth()] || "Sept"}`;
        }
      } catch {}
    }
  }

  // Extract start time in 12-hour format e.g. "10:00 AM"
  let timeStr = "10:00 AM";
  const rawTime = String(timeSlotInput || "").trim();
  const timeMatch = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hh = parseInt(timeMatch[1], 10);
    const mm = timeMatch[2] || "00";
    let period = (timeMatch[3] || "").toUpperCase();

    if (!period) {
      if (hh < 8) {
        period = "PM";
      } else if (hh >= 8 && hh < 12) {
        period = "AM";
      } else if (hh === 12) {
        period = "PM";
      } else {
        period = "PM";
        if (hh > 12) hh -= 12;
      }
    }
    timeStr = `${String(hh).padStart(2, "0")}:${mm} ${period}`;
  }

  return `${isoDate} ${dayMon} ${timeStr} (${slotId})`;
}

/**
 * Generates the 7-sheet Master Migration Excel Workbook exactly matching the requested format:
 * 1. Sessions
 * 2. Demo Day Sessions
 * 3. Online Groups Migration Sheet
 * 4. Offline Students Migration Sheet
 * 5. Student Online Migration
 * 6. Slot ID
 * 7. Location
 */
export function generateMigrationWorkbook(input: MigrationExportInput): XLSX.WorkBook {
  const {
    project,
    batch,
    allocationData,
    labs = [],
    students = [],
    slotIdTemplate: inputTemplate,
    slotIdStartInteger: inputStartInt,
  } = input;

  const appliedPrefs = allocationData?.preferences_applied || {};
  const activeTemplate: SlotIdTemplate =
    inputTemplate || appliedPrefs.slotIdTemplate || "original";
  const activeStartInt: number =
    inputStartInt || appliedPrefs.slotIdStartInteger || 14000;

  const masterAllocations =
    allocationData?.master_allocation || (allocationData as any)?.allocations || [];

  // Build lab lookup map
  const labMap = new Map<string, any>();
  for (const lab of labs) {
    const code = String(lab.lab_code || lab.Lab_ID || lab["Lab ID"] || "").trim().toUpperCase();
    if (code) labMap.set(code, lab);
    if (lab.id) labMap.set(lab.id, lab);
  }

  // Build student lookup map for contact / PII / metadata enrichment
  const studentMap = new Map<string, StudentRecord>();
  for (const s of students) {
    const sId = String(s.S_ID || s.id || (s as any)["Student ID"] || "").trim();
    if (sId) {
      studentMap.set(sId, s);
    }
  }

  // Build VP Sessions lookup map if provided
  const vpSessionsInput = (allocationData as any)?.vp_sessions || [];
  const vpSessionById = new Map<string, any>();
  for (const session of vpSessionsInput) {
    if (session.id) {
      vpSessionById.set(session.id, session);
    }
  }

  // Sorted batch dates and days
  const batchDates = Array.isArray(batch.dates) ? [...batch.dates].sort() : [];
  const primaryDate = batchDates.length > 0 ? batchDates[0] : "2026-09-09";
  const demoDate = batchDates.length > 0 ? batchDates[batchDates.length - 1] : primaryDate;
  const demoDay = getWeekdayName(demoDate);

  // -------------------------------------------------------------------------
  // Unified Sequential Integer Slot ID Mapping (1, 2, 3...)
  // Every session sharing the same (day, time) pair gets the exact same integer
  // regardless of lab, incrementing per unique (day, time) combination across the batch.
  // -------------------------------------------------------------------------
  const slotKeyMap = new Map<string, number>();
  const slotMetadataList: Array<{ slotId: number; day: string; time: string; duration: string }> = [];
  let nextSlotNumber = 1;

  function getOrAssignSlotNumber(dayInput: string, timeSlotInput: string, durationMinutes: number = 120): number {
    const cleanDay = getWeekdayName(dayInput);
    const cleanTime = String(timeSlotInput || "10:00 - 12:00").trim();
    const key = `${cleanDay.toLowerCase()}__${cleanTime.toLowerCase()}`;
    if (!slotKeyMap.has(key)) {
      const slotNum = nextSlotNumber++;
      slotKeyMap.set(key, slotNum);
      slotMetadataList.push({
        slotId: slotNum,
        day: cleanDay,
        time: cleanTime,
        duration: `${durationMinutes}`,
      });
    }
    return slotKeyMap.get(key)!;
  }

  // Pre-populate batch scheduled dates & time slots to preserve expected chronological ordering
  if (Array.isArray(batch.dates) && Array.isArray(batch.time_slots)) {
    for (const d of batch.dates) {
      const dayName = getWeekdayName(d);
      for (const t of batch.time_slots) {
        if (t) getOrAssignSlotNumber(dayName, t, 120);
      }
    }
  }

  // Identify accepted online migration suggestions or online students
  const onlineSuggestions = allocationData?.online_migration_suggestions || [];

  // Build a fast lookup set of student IDs accepted for online migration
  const acceptedOnlineStudentIds = new Set<string>();
  for (const s of onlineSuggestions) {
    if (s.status === "accepted") {
      const ids = s.acceptedStudentIds && s.acceptedStudentIds.length > 0
        ? s.acceptedStudentIds
        : (s.affectedStudentIds || []);
      for (const id of ids) {
        if (id) acceptedOnlineStudentIds.add(String(id).trim());
      }
    }
  }

  // Check if a master allocation row is migrated to online
  const isRowOnline = (alloc: any): boolean => {
    if (isVpStudent(alloc)) return true;
    if (alloc.Is_Online === true || alloc.is_online === true || alloc.assigned_online === true) return true;
    const lab = String(alloc["Assigned Lab"] || alloc.Lab_ID || "").trim().toUpperCase();
    if (lab.includes("ONLINE")) return true;

    const rowStudentId = String(alloc["Student ID"] || alloc.S_ID || "").trim();
    if (rowStudentId && acceptedOnlineStudentIds.has(rowStudentId)) {
      return true;
    }

    return false;
  };

  // Distinct session slots aggregated from master allocations
  interface DistinctSession {
    labCode: string;
    gov: string;
    area: string;
    capacity: number | string;
    grade: string;
    rawGrade: number | string;
    groupId: string;
    slotId: number | string;
    day: string;
    date: string;
    shift: string;
    isOnline: boolean;
    enrolledStudentIds?: string[];
    governorates?: Set<string>;
    track?: string;
    projectName?: string;
    status?: string;
  }

  const distinctSessionsMap = new Map<string, DistinctSession>();
  const offlineStudentsList: any[] = [];
  const onlineStudentsList: any[] = [];

  for (const alloc of masterAllocations) {
    const isOnline = isRowOnline(alloc);
    const labCode = String(
      alloc["Assigned Lab"] || alloc.Lab_ID || alloc.lab_code || alloc.lab_id || (isOnline ? "ONLINE" : "LAB1"),
    ).trim();

    const labObj = labMap.get(labCode.toUpperCase()) || {};
    const gov = String(labObj.gov || alloc.Gov || alloc.Governorate || "Cairo").trim();
    const area = String(
      alloc["Assigned Area"] || alloc["Physical Area"] || labObj.area || alloc.Area || "",
    ).trim();
    const capacity = isOnline ? 30 : (labObj.capacity ?? alloc["Lab Capacity"] ?? alloc.Lab_Capacity ?? 25);
    const rawGrade = alloc.Grade || alloc.grade || 4;
    const formattedGrade = formatDeciGrade(rawGrade, project.program, alloc.Track || alloc.Course);

    const rawDay = String(alloc.Day || alloc.day || primaryDate).trim();
    const day = getWeekdayName(rawDay);
    const rawDate = String(alloc.Date || alloc.date || primaryDate).trim();
    const formattedDate = formatMigrationDate(rawDate);

    const shift = String(
      alloc.Shift || alloc.Time_Slot || alloc.shift || alloc.time_slot || "10:00 - 12:00",
    ).trim();

    const cleanLab = labCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const cleanGrade = `G${String(rawGrade).replace(/[^0-9]/g, "") || "4"}`;
    const cleanShift = shift.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
    const groupId = isOnline
      ? String(alloc.VP_Session_ID || alloc.online_group || `ONLINE-${cleanLab}-${cleanGrade}-${cleanShift}`)
      : String(alloc.Group_ID || `GRP-${cleanLab}-${cleanGrade}-${cleanShift}`);

    const slotId = getOrAssignSlotNumber(day, shift, 120);

    const sessionKey = isOnline
      ? `VP_${groupId}`
      : `${labCode}_${day}_${shift}_${rawGrade}_OFF`;
    if (!distinctSessionsMap.has(sessionKey)) {
      distinctSessionsMap.set(sessionKey, {
        labCode,
        gov,
        area,
        capacity,
        grade: formattedGrade,
        rawGrade,
        groupId,
        slotId,
        day,
        date: formattedDate,
        shift,
        isOnline,
        enrolledStudentIds: [],
        governorates: new Set([gov]),
        track: String(alloc.Track || alloc.Course || "General"),
        projectName: project.name,
        status: "active",
      });
    }

    const sessionEntry = distinctSessionsMap.get(sessionKey)!;
    if (gov) sessionEntry.governorates?.add(gov);

    // Partition student records
    const sId = String(alloc["Student ID"] || alloc.S_ID || "").trim();
    if (sId) {
      sessionEntry.enrolledStudentIds?.push(sId);

      if (isOnline) {
        // Find matching suggestion for this online student
        let matchedSug: OnlineMigrationSuggestion | undefined;
        for (const sug of onlineSuggestions) {
          const sIds = sug.acceptedStudentIds || sug.affectedStudentIds || [];
          if (sIds.includes(sId)) {
            matchedSug = sug;
            break;
          }
          const sugGov = (sug.governorate || sug.gov || "").trim().toLowerCase();
          const sugArea = (sug.area || "").trim().toLowerCase();
          if (
            (sugGov && (sugGov === gov.toLowerCase() || sugGov === area.toLowerCase())) ||
            (sugArea && (sugArea === area.toLowerCase() || sugArea === gov.toLowerCase())) ||
            (sug.affectedAreas || []).map((a) => a.toLowerCase()).includes(area.toLowerCase())
          ) {
            matchedSug = sug;
            break;
          }
        }

        const sRec = studentMap.get(sId);
        const studentName = String(sRec?.Name || sRec?.name || (sRec as any)?.["Student Name"] || "").trim();
        const phone = String(sRec?.Phone || sRec?.phone || (sRec as any)?.["Phone Number"] || (sRec as any)?.Mobile || "").trim();
        const email = String(sRec?.Email || sRec?.email || (sRec as any)?.["Email Address"] || "").trim();
        const studentGov = String(sRec?.Governorate || sRec?.Gov || sRec?.gov || gov || "Cairo").trim();
        const studentTrack = String(alloc.Track || alloc.Course || (sRec as any)?.Track || matchedSug?.track || "").trim();
        const qualReason = matchedSug?.qualificationReason || "Headcount < 8 threshold";
        const acceptedAt = matchedSug?.acceptedAt ? formatMigrationDate(matchedSug.acceptedAt) : formatMigrationDate(primaryDate);

        onlineStudentsList.push({
          sId,
          studentName,
          phone,
          email,
          governorate: studentGov,
          area,
          track: studentTrack,
          grade: formattedGrade,
          origLab: String(alloc.Original_Lab_ID || alloc.Lab_ID || alloc["Lab ID"] || labCode),
          origArea: area,
          onlineGroup: groupId,
          slotId,
          day,
          shift,
          status: "Migrated to Online",
          qualificationReason: qualReason,
          acceptedAt,
        });
      } else {
        offlineStudentsList.push({
          sId,
          labCode,
          labObj,
          area,
          day,
          rawDate,
          shift,
          rawGrade,
          slotId,
          groupId,
        });
      }
    }
  }

  const distinctSessions = Array.from(distinctSessionsMap.values());

  // -------------------------------------------------------------------------
  // 1. Sheet 1: Sessions
  // Header: Lab ID, Gov, Area, Lab Capacity, Grade, Group ID, Tutor ID, TA ID, Slot ID, Day, Date, Shift
  // -------------------------------------------------------------------------
  const sessionsHeader = [
    "Lab ID",
    "Gov",
    "Area",
    "Lab Capacity",
    "Grade",
    "Group ID",
    "Tutor ID",
    "TA ID",
    "Slot ID",
    "Day",
    "Date",
    "Shift",
  ];

  const sessionsRows = distinctSessions.map((s) => [
    s.labCode || "",
    s.gov || "",
    s.area || "",
    s.capacity ?? "",
    s.grade || "",
    s.groupId || "",
    "", // Tutor ID (EMPTY per Section 7 rule)
    "", // TA ID (EMPTY per Section 7 rule)
    s.slotId || "",
    s.day || "",
    s.date || "",
    s.shift || "",
  ]);

  const sessionsSheet = XLSX.utils.aoa_to_sheet([sessionsHeader, ...sessionsRows]);

  // -------------------------------------------------------------------------
  // 2. Sheet 2: Demo Day Sessions
  // Header: Lab ID, Gov, Area, Lab Capacity, Grade, Group ID, Slot ID, Day, Date, Shift
  // -------------------------------------------------------------------------
  const demoDayHeader = [
    "Lab ID",
    "Gov",
    "Area",
    "Lab Capacity",
    "Grade",
    "Group ID",
    "Slot ID",
    "Day",
    "Date",
    "Shift",
  ];

  const demoDayRows = distinctSessions.map((s) => {
    const demoGroupId = `DEMO-${s.labCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}-G${String(s.rawGrade).replace(/[^0-9]/g, "")}`;
    const demoSlotId = getOrAssignSlotNumber(demoDay, s.shift, 120);

    return [
      s.labCode || "",
      s.gov || "",
      s.area || "",
      s.capacity ?? "",
      s.grade || "",
      demoGroupId,
      demoSlotId,
      demoDay,
      formatMigrationDate(demoDate),
      s.shift || "",
    ];
  });

  const demoDaySheet = XLSX.utils.aoa_to_sheet([demoDayHeader, ...demoDayRows]);

  // -------------------------------------------------------------------------
  // 3. Sheet 3: Online Groups Migration Sheet
  // Full Operations Spec: Lab ID, Lab Capacity, Grade, Group ID, Project Name, Track, Governorates, Enrolled Students, Occupancy (%), Remaining Seats, Status, Slot ID, Day, Date, Shift
  // -------------------------------------------------------------------------
  const onlineGroupsHeader = [
    "Lab ID",
    "Lab Capacity",
    "Grade",
    "Group ID",
    "Project Name",
    "Track",
    "Governorates",
    "Enrolled Students",
    "Occupancy (%)",
    "Remaining Seats",
    "Status",
    "Slot ID",
    "Day",
    "Date",
    "Shift",
  ];

  const onlineSessions = distinctSessions.filter((s) => s.isOnline);
  const onlineGroupsRows = onlineSessions.map((s) => {
    const vpMeta = vpSessionById.get(s.groupId);
    const enrolledCount = vpMeta?.studentCount ?? (s.enrolledStudentIds ? s.enrolledStudentIds.length : (s.capacity ? Number(s.capacity) : 0));
    const cap = Number(vpMeta?.capacity ?? s.capacity ?? 30);
    const occupancyPct = cap > 0 ? `${((enrolledCount / cap) * 100).toFixed(1)}%` : "0.0%";
    const remaining = Math.max(0, cap - enrolledCount);
    const govs = vpMeta?.governorates
      ? (Array.isArray(vpMeta.governorates) ? vpMeta.governorates.join(", ") : String(vpMeta.governorates))
      : (s.governorates ? Array.from(s.governorates).join(", ") : s.gov);
    const projName = vpMeta?.projectName || project.name || "Default Project";
    const trackName = vpMeta?.track || s.track || (String(project.program || "").toUpperCase().includes("DECI") ? "General Track" : "Standard Track");
    const sessStatus = vpMeta?.status || s.status || "active";

    return [
      s.labCode || "ONLINE",
      cap,
      s.grade || "",
      s.groupId || "",
      projName,
      trackName,
      govs,
      enrolledCount,
      occupancyPct,
      remaining,
      sessStatus,
      s.slotId ?? "",
      s.day || "",
      s.date || "",
      s.shift || "",
    ];
  });

  const onlineGroupsSheet = XLSX.utils.aoa_to_sheet([onlineGroupsHeader, ...onlineGroupsRows]);

  // -------------------------------------------------------------------------
  // 4. Sheet 4: Offline Students Migration Sheet
  // Header: Student ID, Offline Group
  // -------------------------------------------------------------------------
  const offlineStudentsHeader = [
    "Student ID",
    "Offline Group",
  ];

  const offlineStudentsRows = offlineStudentsList.map((item) => [
    item.sId || "",
    item.groupId || "",
  ]);

  const offlineStudentsSheet = XLSX.utils.aoa_to_sheet([offlineStudentsHeader, ...offlineStudentsRows]);

  // -------------------------------------------------------------------------
  // 5. Sheet 5: VP Session Students
  // Header: Student ID, Online Group
  // -------------------------------------------------------------------------
  const onlineStudentsHeader = [
    "Student ID",
    "Online Group",
  ];

  const onlineStudentsRows = onlineStudentsList.map((item) => [
    item.sId || "",
    item.onlineGroup || item.groupId || "",
  ]);

  const onlineStudentsSheet = XLSX.utils.aoa_to_sheet([onlineStudentsHeader, ...onlineStudentsRows]);

  // -------------------------------------------------------------------------
  // 6. Sheet 6: Slot ID
  // Header: Slot ID, Day, Time, Duration
  // -------------------------------------------------------------------------
  const slotIdHeader = ["Slot ID", "Day", "Time", "Duration"];

  const slotIdRows = slotMetadataList
    .slice()
    .sort((a, b) => a.slotId - b.slotId)
    .map((slot) => [
      slot.slotId,
      slot.day,
      slot.time,
      slot.duration,
    ]);

  const slotIdSheet = XLSX.utils.aoa_to_sheet([slotIdHeader, ...slotIdRows]);

  // -------------------------------------------------------------------------
  // 7. Sheet 7: Location
  // Header: Lab ID, gov, Area, lab_name, address, Real Location URL, location_id, Facilitator Name, Facilitator Number, location status
  // -------------------------------------------------------------------------
  const locationHeader = [
    "Lab ID",
    "gov",
    "Area",
    "lab_name",
    "address",
    "Real Location URL",
    "location_id",
    "Facilitator Name",
    "Facilitator Number",
    "location status",
  ];

  const activeLabsList = labs.length > 0 ? labs : Array.from(labMap.values());
  const locationRows = activeLabsList.map((lab) => {
    const labCode = String(lab.lab_code || lab["Lab ID"] || "").trim();
    const gov = String(lab.gov || lab.Gov || "").trim();
    const area = String(lab.area || lab.Area || "").trim();
    const labName = String(lab.name || lab.center_name || lab.lab_name || labCode).trim();
    const address = String(lab.address || "").trim();
    const mapsUrl = String(lab.maps_url || lab["Real Location URL"] || "").trim();
    const locationId = String(lab.id || labCode).trim();
    const facilitatorName = String(lab.facilitator_name || lab["Facilitator Name"] || "").trim();
    const facilitatorNumber = String(
      lab.facilitator_phone || lab["Facilitator Number"] || lab.facilitator_number || "",
    ).trim();

    const isOnlineLab =
      lab.is_online === true ||
      labCode.toUpperCase().includes("ONLINE") ||
      lab.type === "online";
    const locationStatus = isOnlineLab ? "TRUE" : "FALSE";

    return [
      labCode,
      gov,
      area,
      labName,
      address,
      mapsUrl,
      locationId,
      facilitatorName,
      facilitatorNumber,
      locationStatus,
    ];
  });

  const locationSheet = XLSX.utils.aoa_to_sheet([locationHeader, ...locationRows]);

  // -------------------------------------------------------------------------
  // 8. Sheet 8: Governorate VP Summary
  // Header: Governorate, Physical Areas, Total Demand, VP Eligible Students, VP Accepted Online, Physical Remaining, Online Migration (%), Status, Qualification Reason
  // -------------------------------------------------------------------------
  const govSummaryHeader = [
    "Governorate",
    "Physical Areas",
    "Total Demand",
    "VP Eligible Students",
    "VP Accepted Online",
    "Physical Remaining",
    "Online Migration (%)",
    "Status",
    "Qualification Reason",
  ];

  const govSummaryMap = new Map<string, {
    governorate: string;
    areas: Set<string>;
    totalDemand: number;
    eligibleCount: number;
    acceptedCount: number;
    status: string;
    reason: string;
  }>();

  for (const s of onlineSuggestions) {
    const gov = String(s.governorate || s.gov || s.area || "Unknown").trim();
    if (!govSummaryMap.has(gov)) {
      govSummaryMap.set(gov, {
        governorate: gov,
        areas: new Set<string>(),
        totalDemand: 0,
        eligibleCount: 0,
        acceptedCount: 0,
        status: s.status === "accepted" ? "Accepted Online" : s.status === "rejected" ? "Rejected (In-Person)" : "Pending Review",
        reason: s.qualificationReason || "Headcount < 8 threshold",
      });
    }
    const entry = govSummaryMap.get(gov)!;
    if (Array.isArray(s.affectedAreas)) {
      s.affectedAreas.forEach((a) => entry.areas.add(a));
    } else if (s.area) {
      entry.areas.add(s.area);
    }
    const sIds = s.affectedStudentIds || [];
    const accIds = s.acceptedStudentIds || (s.status === "accepted" ? s.affectedStudentIds : []) || [];
    entry.eligibleCount += sIds.length || s.studentCount || 0;
    entry.acceptedCount += accIds.length || (s.status === "accepted" ? s.studentCount : 0) || 0;
  }

  for (const alloc of masterAllocations) {
    const gov = String(alloc.Gov || alloc.Governorate || alloc.gov || "Cairo").trim();
    if (govSummaryMap.has(gov)) {
      govSummaryMap.get(gov)!.totalDemand += 1;
      const area = String(alloc["Assigned Area"] || alloc["Physical Area"] || alloc.Area || "").trim();
      if (area) govSummaryMap.get(gov)!.areas.add(area);
    }
  }

  if (govSummaryMap.size === 0 && onlineStudentsList.length > 0) {
    for (const s of onlineStudentsList) {
      const gov = s.governorate || "Unknown";
      if (!govSummaryMap.has(gov)) {
        govSummaryMap.set(gov, {
          governorate: gov,
          areas: new Set([s.area]),
          totalDemand: 0,
          eligibleCount: 0,
          acceptedCount: 0,
          status: "Accepted Online",
          reason: s.qualificationReason || "Headcount < 8 threshold",
        });
      }
      const entry = govSummaryMap.get(gov)!;
      entry.totalDemand += 1;
      entry.eligibleCount += 1;
      entry.acceptedCount += 1;
      if (s.area) entry.areas.add(s.area);
    }
  }

  const govSummaryRows = Array.from(govSummaryMap.values()).map((g) => {
    const demand = Math.max(g.totalDemand, g.eligibleCount);
    const physicalRemaining = Math.max(0, demand - g.acceptedCount);
    const pctOnline = demand > 0 ? `${((g.acceptedCount / demand) * 100).toFixed(1)}%` : "0.0%";
    return [
      g.governorate,
      Array.from(g.areas).join(", "),
      demand,
      g.eligibleCount,
      g.acceptedCount,
      physicalRemaining,
      pctOnline,
      g.status,
      g.reason,
    ];
  });

  const govSummarySheet = XLSX.utils.aoa_to_sheet([govSummaryHeader, ...govSummaryRows]);

  // -------------------------------------------------------------------------
  // Assemble Workbook with exact 8 sheets (respecting Excel's 31-char tab limit)
  // -------------------------------------------------------------------------
  const wb = XLSX.utils.book_new();

  const safeAppend = (sheet: XLSX.WorkSheet, name: string) => {
    XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31));
  };

  safeAppend(sessionsSheet, "Sessions");
  safeAppend(demoDaySheet, "Demo Day Sessions");
  safeAppend(onlineGroupsSheet, "Online Groups Migration Sheet");
  safeAppend(offlineStudentsSheet, "Offline Students Migration Sheet");
  safeAppend(onlineStudentsSheet, "VP Session Students");
  safeAppend(slotIdSheet, "Slot ID");
  safeAppend(locationSheet, "Location");
  safeAppend(govSummarySheet, "Governorate VP Summary");

  return wb;
}
