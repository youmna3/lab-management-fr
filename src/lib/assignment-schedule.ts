import type { Tables } from "@/integrations/supabase/types";
import {
  normalizeTimeSlot,
  normalizeTimeSlots,
  sortTimeSlots as sortCanonicalTimeSlots,
} from "@/lib/time-slots";

export type AssignmentLike = Pick<
  Tables<"assignments">,
  "id" | "batch_id" | "lab_id" | "days" | "sessions_per_day" | "time_slots"
>;

export type BatchLike = Pick<Tables<"batches">, "dates" | "time_slots">;
export type AssignmentSession = Tables<"assignment_sessions">;

export type ManualScheduleDay = {
  date: string;
  selectedSlots: string[];
};

export type ManualScheduleValidation = {
  errors: string[];
  rowErrors: Record<number, string[]>;
  totalDays: number;
  totalSessions: number;
};

export type SchedulePayloadRow = {
  session_date: string;
  session_time: string;
  session_group_id?: string | null;
};

export type ScheduleDaySummary = {
  date: string;
  sessions: number;
};

export type AssignmentScheduleSummary = {
  totalDays: number;
  totalSessions: number;
  sessionsByDate: ScheduleDaySummary[];
  sessionTimes: string[];
};

function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function toNonNegativeNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export const MAX_SESSIONS_PER_DAY = 4;

export function formatScheduleDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function sortSessionTimes(
  sessionTimes: string[] | null | undefined,
  preferredOrder: string[] | null | undefined = [],
): string[] {
  const safeSessionTimes = normalizeTimeSlots(sessionTimes, { preserveInvalid: true });
  const safePreferredOrder = normalizeTimeSlots(preferredOrder, { preserveInvalid: true });
  const order = new Map(safePreferredOrder.map((slot, index) => [slot, index]));
  return [...safeSessionTimes].sort((a, b) => {
    const aIndex = order.get(a);
    const bIndex = order.get(b);

    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

export function summarizeAssignmentSessions(
  sessions: AssignmentSession[] | null | undefined,
  preferredOrder: string[] | null | undefined = [],
): AssignmentScheduleSummary {
  const counts = new Map<string, number>();
  const times = new Set<string>();
  const safeSessions = Array.isArray(sessions) ? sessions : [];

  safeSessions.forEach((session) => {
    const sessionDate = typeof session?.session_date === "string" ? session.session_date : "";
    if (!sessionDate) return;
    counts.set(sessionDate, (counts.get(sessionDate) ?? 0) + 1);
    if (typeof session.session_time === "string" && session.session_time) {
      times.add(normalizeTimeSlot(session.session_time) ?? session.session_time.trim());
    }
  });

  const sessionsByDate = [...counts.entries()]
    .map(([date, total]) => ({ date, sessions: total }))
    .sort((a, b) => compareIsoDates(a.date, b.date));

  return {
    totalDays: sessionsByDate.length,
    totalSessions: sessionsByDate.reduce((total, day) => total + day.sessions, 0),
    sessionsByDate,
    sessionTimes: sortSessionTimes([...times], preferredOrder),
  };
}

export function getLegacyScheduleSummary(
  assignment: AssignmentLike | null | undefined,
  batch: BatchLike | null | undefined,
): AssignmentScheduleSummary {
  const fallbackDates = safeStringArray(batch?.dates);
  const batchTimeSlots = normalizeTimeSlots(batch?.time_slots, { preserveInvalid: true });
  const assignmentTimeSlots = normalizeTimeSlots(assignment?.time_slots, { preserveInvalid: true });
  const totalDays = toNonNegativeNumber(assignment?.days ?? fallbackDates.length);
  const sessionsPerDay = toNonNegativeNumber(assignment?.sessions_per_day);
  const preferredSlots = assignmentTimeSlots.length ? assignmentTimeSlots : batchTimeSlots;

  const sessionsByDate: ScheduleDaySummary[] = [];
  for (let index = 0; index < totalDays; index += 1) {
    const fallbackDate =
      fallbackDates[index] ?? fallbackDates[fallbackDates.length - 1] ?? `Day ${index + 1}`;
    sessionsByDate.push({ date: fallbackDate, sessions: sessionsPerDay });
  }

  return {
    totalDays,
    totalSessions: totalDays * sessionsPerDay,
    sessionsByDate,
    sessionTimes: sortSessionTimes(
      preferredSlots.length
        ? preferredSlots.slice(0, Math.max(sessionsPerDay, preferredSlots.length))
        : [],
      batchTimeSlots,
    ),
  };
}

export function getAssignmentScheduleSummary(
  assignment: AssignmentLike | null | undefined,
  batch: BatchLike | null | undefined,
  sessions: AssignmentSession[] | null | undefined = [],
): AssignmentScheduleSummary {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  if (safeSessions.length > 0) {
    return summarizeAssignmentSessions(
      safeSessions,
      normalizeTimeSlots(batch?.time_slots, { preserveInvalid: true }),
    );
  }
  return getLegacyScheduleSummary(assignment, batch);
}

export function buildManualSchedulePayload(
  days: ManualScheduleDay[] | null | undefined,
  batchTimeSlots: string[] | null | undefined,
  batchDates?: string[] | null,
): SchedulePayloadRow[] {
  const safeDays = Array.isArray(days) ? days : [];
  const validation = validateManualSchedule(safeDays, batchTimeSlots, batchDates);

  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0]);
  }

  return [...safeDays]
    .sort((a, b) => compareIsoDates(a.date, b.date))
    .flatMap((day) =>
      normalizeTimeSlots(day.selectedSlots, { preserveInvalid: true }).map((sessionTime) => ({
        session_date: day.date,
        session_time: sessionTime,
        session_group_id: null,
      })),
    );
}

export function validateManualSchedule(
  days: ManualScheduleDay[] | null | undefined,
  batchTimeSlots: string[] | null | undefined,
  batchDates?: string[] | null,
): ManualScheduleValidation {
  const safeDays = Array.isArray(days) ? days : [];
  const allowedSlots = normalizeTimeSlots(batchTimeSlots, { preserveInvalid: true });
  const allowedDates = new Set(safeStringArray(batchDates));
  const seenDates = new Set<string>();
  const errors: string[] = [];
  const rowErrors: Record<number, string[]> = {};
  let totalSessions = 0;

  const addRowError = (index: number, message: string) => {
    rowErrors[index] = [...(rowErrors[index] ?? []), message];
    if (!errors.includes(message)) errors.push(message);
  };

  safeDays.forEach((day, index) => {
    const date = typeof day?.date === "string" ? day.date : "";
    const slots = sortCanonicalTimeSlots(
      safeStringArray(day?.selectedSlots).map((slot) => normalizeTimeSlot(slot) ?? slot.trim()),
    );
    totalSessions += slots.length;

    if (!date) {
      addRowError(index, `Schedule row ${index + 1} needs a date.`);
    } else {
      if (seenDates.has(date)) {
        addRowError(index, `${formatScheduleDate(date)} is already in this schedule.`);
      }
      seenDates.add(date);

      if (allowedDates.size > 0 && !allowedDates.has(date)) {
        addRowError(index, `${formatScheduleDate(date)} is not configured for this batch.`);
      }
    }

    if (slots.length === 0) {
      addRowError(
        index,
        `${date ? formatScheduleDate(date) : `Row ${index + 1}`} needs at least one selected slot.`,
      );
    }

    if (slots.length > MAX_SESSIONS_PER_DAY) {
      addRowError(
        index,
        `${date ? formatScheduleDate(date) : `Row ${index + 1}`} has ${slots.length} sessions; the maximum is ${MAX_SESSIONS_PER_DAY}.`,
      );
    }

    const seenSlots = new Set<string>();
    slots.forEach((slot) => {
      if (seenSlots.has(slot)) {
        addRowError(index, `${formatScheduleDate(date)} contains the ${slot} slot more than once.`);
      }
      seenSlots.add(slot);

      if (!allowedSlots.includes(slot)) {
        addRowError(index, `${slot} is not one of this batch's available slots.`);
      }
    });
  });

  return {
    errors,
    rowErrors,
    totalDays: safeDays.filter((day) => day.date && safeStringArray(day.selectedSlots).length > 0)
      .length,
    totalSessions,
  };
}

export function calculateAssignmentPrice(
  unitPrice: number | null | undefined,
  summary: AssignmentScheduleSummary | null | undefined,
): number {
  return toNonNegativeNumber(unitPrice) * toNonNegativeNumber(summary?.totalSessions);
}

export function formatSessionsByDate(
  summary: AssignmentScheduleSummary | null | undefined,
): string {
  const sessionsByDate = Array.isArray(summary?.sessionsByDate) ? summary.sessionsByDate : [];
  return sessionsByDate
    .map(
      (item) =>
        `${formatScheduleDate(item.date)}: ${item.sessions} ${item.sessions === 1 ? "session" : "sessions"}`,
    )
    .join(" | ");
}
