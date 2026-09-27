import {
  formatScheduleDate,
  MAX_SESSIONS_PER_DAY,
  type AssignmentScheduleSummary,
  type ScheduleDaySummary,
} from "@/lib/assignment-schedule";
import { fixMojibake } from "@/lib/sheet";
import { formatTimeSlot, normalizeTimeSlot, normalizeTimeSlots } from "@/lib/time-slots";

export type SessionImportStatus = "Valid" | "Warning" | "Error";

export type SessionImportIssue = {
  level: "warning" | "error";
  message: string;
};

export type SessionImportPayloadRow = {
  assignment_id: string;
  batch_id: string;
  lab_id: string;
  session_date: string;
  session_time: string;
  session_group_id: string | null;
};

export type SessionImportPreviewRow = {
  rowNumber: number;
  labCode: string;
  normalizedLabCode: string;
  matchedLabName: string;
  assignmentId: string | null;
  labId: string | null;
  scheduledDays: number;
  sessionsByDate: ScheduleDaySummary[];
  totalSessions: number;
  currentCalculatedPrice: number;
  newCalculatedPrice: number;
  status: SessionImportStatus;
  issues: SessionImportIssue[];
  sessions: SessionImportPayloadRow[];
};

export type SessionImportContext = {
  batchId: string;
  batchDates: string[];
  batchTimeSlots: string[];
  importMode: "merge" | "replace";
  expectedSessionsPerGroup?: number | null;
  assignmentsByLabCode: Map<
    string,
    {
      assignmentId: string;
      existingSessionKeys: Set<string>;
      labId: string;
      labName: string;
      unitPrice: number;
      currentSummary: AssignmentScheduleSummary;
    }
  >;
  labsByLabCode: Map<
    string,
    {
      labId: string;
      labName: string;
      unitPrice: number;
    }
  >;
};

export type SessionImportResult = {
  headers: string[];
  previewRows: SessionImportPreviewRow[];
  validRows: SessionImportPreviewRow[];
  validSessions: SessionImportPayloadRow[];
  targetAssignmentIds: string[];
};

type ParsedHeader = {
  rawHeader: string;
  columnIndex: number;
  sessionDate: string | null;
  sessionTime: string | null;
  isScheduleHeader: boolean;
  error?: string;
};

type OccurrenceRef = {
  rowNumber: number;
  labId: string;
  groupId: string;
};

const LAB_ID_ALIASES = ["lab id", "lab code", "lab_code", "id"];
const GROUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _./()-]{0,119}$/;
const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalizeCell(value: unknown): string {
  return fixMojibake(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLabCode(value: unknown): string {
  return normalizeCell(value).replace(/\s+/g, "").toLowerCase();
}

function buildBatchDateLookup(batchDates: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  batchDates.forEach((isoDate) => {
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getMonth() + 1}-${date.getDate()}`;
    lookup.set(key, isoDate);
  });
  return lookup;
}

function looksLikeScheduleHeader(header: string): boolean {
  return (
    /\d{1,2}/.test(header) &&
    /\b(am|pm|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(header)
  );
}

function parseScheduleHeader(
  rawHeader: string,
  columnIndex: number,
  batchDateLookup: Map<string, string>,
): ParsedHeader {
  const header = normalizeCell(rawHeader);
  const result: ParsedHeader = {
    rawHeader: header,
    columnIndex,
    sessionDate: null,
    sessionTime: null,
    isScheduleHeader: false,
  };

  if (!header) return result;

  const match = header.match(/^(?:[A-Za-z]{3,9}\s+)?(.+?)\s+(\d{1,2})\s+([A-Za-z]{3,9})$/i);
  if (!match) {
    result.isScheduleHeader = looksLikeScheduleHeader(header);
    if (result.isScheduleHeader) {
      result.error = `Unrecognized schedule header "${header}"`;
    }
    return result;
  }

  const [, time, dayRaw, monthRaw] = match;
  const month = MONTH_INDEX[monthRaw.toLowerCase()];
  const day = Number(dayRaw);

  result.isScheduleHeader = true;

  if (!month || Number.isNaN(day)) {
    result.error = `Invalid schedule header "${header}"`;
    return result;
  }

  const sessionDate = batchDateLookup.get(`${month}-${day}`);
  if (!sessionDate) {
    result.error = `Header "${header}" does not match a date in the selected batch`;
    return result;
  }

  const sessionTime = normalizeTimeSlot(normalizeCell(time));
  if (!sessionTime) {
    result.error = `Header "${header}" has an invalid time`;
    return result;
  }

  result.sessionDate = sessionDate;
  result.sessionTime = sessionTime;
  return result;
}

function summarizeSessionsByDate(sessions: SessionImportPayloadRow[]): ScheduleDaySummary[] {
  const counts = new Map<string, number>();
  sessions.forEach((session) => {
    counts.set(session.session_date, (counts.get(session.session_date) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([date, total]) => ({ date, sessions: total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function addIssue(
  row: SessionImportPreviewRow,
  level: SessionImportIssue["level"],
  message: string,
) {
  if (!row.issues.some((issue) => issue.level === level && issue.message === message)) {
    row.issues.push({ level, message });
  }
}

export function buildSessionImportPreview(
  matrix: unknown[][],
  context: SessionImportContext,
): SessionImportResult {
  const [headerRow = [], ...dataRows] = matrix;
  const headers = headerRow.map((value) => normalizeCell(value));
  const batchDateLookup = buildBatchDateLookup(context.batchDates);
  const configuredTimeSlots = new Set(
    normalizeTimeSlots(context.batchTimeSlots, { preserveInvalid: true }),
  );
  const labIdColumnIndex = headers.findIndex((header) =>
    LAB_ID_ALIASES.includes(header.toLowerCase()),
  );

  if (labIdColumnIndex === -1) {
    throw new Error('The file must include a "Lab ID" column.');
  }

  const parsedHeaders = headers.map((header, index) =>
    parseScheduleHeader(header, index, batchDateLookup),
  );
  const previewRows: SessionImportPreviewRow[] = [];
  const rowsByNumber = new Map<number, SessionImportPreviewRow>();

  const occurrenceMap = new Map<string, OccurrenceRef[]>();
  const groupSlotMap = new Map<string, OccurrenceRef[]>();
  const groupCountMap = new Map<string, number>();
  const resultingDailySlots = new Map<string, Set<string>>();
  const dailyRows = new Map<string, Set<number>>();

  dataRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const cells = Array.isArray(rawRow) ? rawRow : [];
    const hasAnyValue = cells.some((cell) => normalizeCell(cell) !== "");
    const labCode = normalizeCell(cells[labIdColumnIndex]);
    const normalizedLabCode = normalizeLabCode(labCode);
    const batchAssignment = context.assignmentsByLabCode.get(normalizedLabCode);
    const knownLab = context.labsByLabCode.get(normalizedLabCode);
    const unitPrice = batchAssignment?.unitPrice ?? knownLab?.unitPrice ?? 0;

    const row: SessionImportPreviewRow = {
      rowNumber,
      labCode,
      normalizedLabCode,
      matchedLabName: batchAssignment?.labName ?? knownLab?.labName ?? "",
      assignmentId: batchAssignment?.assignmentId ?? null,
      labId: batchAssignment?.labId ?? knownLab?.labId ?? null,
      scheduledDays: 0,
      sessionsByDate: [],
      totalSessions: 0,
      currentCalculatedPrice: unitPrice * (batchAssignment?.currentSummary.totalSessions ?? 0),
      newCalculatedPrice: 0,
      status: "Valid",
      issues: [],
      sessions: [],
    };

    if (!hasAnyValue) {
      addIssue(row, "error", "Empty row");
    }

    if (!labCode && hasAnyValue) {
      addIssue(row, "error", "Missing Lab ID");
    } else if (labCode && !knownLab) {
      addIssue(row, "error", `Lab ID "${labCode}" was not found`);
    } else if (knownLab && !batchAssignment) {
      addIssue(row, "error", "Lab is not assigned to the selected batch");
    }

    parsedHeaders.forEach((parsedHeader) => {
      if (!parsedHeader.isScheduleHeader) return;
      const rawValue = normalizeCell(cells[parsedHeader.columnIndex]);
      if (!rawValue) return;

      if (parsedHeader.error || !parsedHeader.sessionDate || !parsedHeader.sessionTime) {
        addIssue(
          row,
          "error",
          parsedHeader.error ?? `Invalid schedule header "${parsedHeader.rawHeader}"`,
        );
        return;
      }

      if (!GROUP_ID_PATTERN.test(rawValue)) {
        addIssue(row, "error", `Invalid Session Group ID "${rawValue}"`);
        return;
      }

      if (!configuredTimeSlots.has(parsedHeader.sessionTime)) {
        addIssue(
          row,
          "warning",
          `${formatTimeSlot(parsedHeader.sessionTime)} is not a configured time slot for this batch`,
        );
      }

      if (!batchAssignment) {
        return;
      }

      const session: SessionImportPayloadRow = {
        assignment_id: batchAssignment.assignmentId,
        batch_id: context.batchId,
        lab_id: batchAssignment.labId,
        session_date: parsedHeader.sessionDate,
        session_time: parsedHeader.sessionTime,
        session_group_id: rawValue,
      };

      row.sessions.push(session);

      const assignmentDateKey = `${batchAssignment.assignmentId}|${session.session_date}`;
      if (!resultingDailySlots.has(assignmentDateKey)) {
        const existingSlots =
          context.importMode === "merge"
            ? [...batchAssignment.existingSessionKeys]
                .filter((key) => key.startsWith(`${session.session_date}|`))
                .map((key) => {
                  const time = key.slice(session.session_date.length + 1);
                  return normalizeTimeSlot(time) ?? time;
                })
            : [];
        resultingDailySlots.set(assignmentDateKey, new Set(existingSlots));
      }
      resultingDailySlots.get(assignmentDateKey)!.add(session.session_time);
      const affectedRows = dailyRows.get(assignmentDateKey) ?? new Set<number>();
      affectedRows.add(rowNumber);
      dailyRows.set(assignmentDateKey, affectedRows);

      const occurrenceKey = `${batchAssignment.labId}|${session.session_date}|${session.session_time}`;
      const occurrenceRef: OccurrenceRef = {
        rowNumber,
        labId: batchAssignment.labId,
        groupId: rawValue,
      };
      occurrenceMap.set(occurrenceKey, [
        ...(occurrenceMap.get(occurrenceKey) ?? []),
        occurrenceRef,
      ]);

      const groupSlotKey = `${session.session_date}|${session.session_time}|${rawValue.toLowerCase()}`;
      groupSlotMap.set(groupSlotKey, [...(groupSlotMap.get(groupSlotKey) ?? []), occurrenceRef]);

      groupCountMap.set(rawValue, (groupCountMap.get(rawValue) ?? 0) + 1);
    });

    row.sessionsByDate = summarizeSessionsByDate(row.sessions);
    row.scheduledDays = row.sessionsByDate.length;
    row.totalSessions = row.sessions.length;
    const importedSessionKeys = new Set(
      row.sessions.map((session) => `${session.session_date}|${session.session_time}`),
    );
    const mergeAdditionalSessions = [...importedSessionKeys].filter(
      (key) => !batchAssignment?.existingSessionKeys.has(key),
    ).length;
    const resultingSessions =
      context.importMode === "merge"
        ? (batchAssignment?.currentSummary.totalSessions ?? 0) + mergeAdditionalSessions
        : row.totalSessions;
    row.newCalculatedPrice = unitPrice * resultingSessions;
    previewRows.push(row);
    rowsByNumber.set(row.rowNumber, row);
  });

  occurrenceMap.forEach((refs) => {
    if (refs.length <= 1) return;
    refs.forEach((ref) => {
      const row = rowsByNumber.get(ref.rowNumber);
      if (!row) return;
      addIssue(row, "error", "Duplicate schedule occurrence for the same lab/date/time slot");

      const sameGroupCount = refs.filter((candidate) => candidate.groupId === ref.groupId).length;
      if (sameGroupCount > 1) {
        addIssue(row, "error", `Duplicate group "${ref.groupId}" in the same lab/date/time slot`);
      }
    });
  });

  groupSlotMap.forEach((refs, key) => {
    const distinctLabs = new Set(refs.map((ref) => ref.labId));
    if (distinctLabs.size <= 1) return;
    const groupId = refs[0]?.groupId ?? key.split("|")[2];
    refs.forEach((ref) => {
      const row = rowsByNumber.get(ref.rowNumber);
      if (!row) return;
      addIssue(
        row,
        "error",
        `Session group "${groupId}" is assigned to different labs in the same slot`,
      );
    });
  });

  resultingDailySlots.forEach((slots, assignmentDateKey) => {
    if (slots.size <= MAX_SESSIONS_PER_DAY) return;
    const sessionDate = assignmentDateKey.split("|")[1] ?? "date";
    (dailyRows.get(assignmentDateKey) ?? new Set<number>()).forEach((rowNumber) => {
      const row = rowsByNumber.get(rowNumber);
      if (!row) return;
      addIssue(
        row,
        "error",
        `${formatScheduleDate(sessionDate)} would have ${slots.size} sessions; the maximum is ${MAX_SESSIONS_PER_DAY}.`,
      );
    });
  });

  if (context.expectedSessionsPerGroup && context.expectedSessionsPerGroup > 0) {
    groupCountMap.forEach((count, groupId) => {
      if (count === context.expectedSessionsPerGroup) return;
      previewRows.forEach((row) => {
        if (!row.sessions.some((session) => session.session_group_id === groupId)) return;
        addIssue(
          row,
          "warning",
          `${groupId} has ${count} of ${context.expectedSessionsPerGroup} expected sessions`,
        );
      });
    });
  }

  previewRows.forEach((row) => {
    if (row.issues.some((issue) => issue.level === "error")) {
      row.status = "Error";
    } else if (row.issues.some((issue) => issue.level === "warning")) {
      row.status = "Warning";
    } else {
      row.status = "Valid";
    }
  });

  const validRows = previewRows.filter((row) => row.status !== "Error" && row.assignmentId);
  const validSessions = validRows.flatMap((row) => row.sessions);
  const targetAssignmentIds = [
    ...new Set(validRows.map((row) => row.assignmentId!).filter(Boolean)),
  ];

  return {
    headers,
    previewRows,
    validRows,
    validSessions,
    targetAssignmentIds,
  };
}
