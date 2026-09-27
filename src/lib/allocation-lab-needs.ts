import type { AllocationResultPayload } from "@/lib/allocation-client";
import { isVpStudent } from "@/lib/allocation-client";
import { resolveSlotSchedule } from "@/lib/lab-allocation-runner/schedule";
import { normalizeTimeSlot } from "@/lib/time-slots";

export type AllocationLabSession = {
  date: string;
  time: string;
  groupIds: string[];
  studentCount: number;
};

export type AllocationLabUsage = {
  labCode: string;
  governorate: string;
  physicalArea: string;
  capacity: number;
  uniqueStudents: number;
  seatVisits: number;
  firstDate: string | null;
  lastDate: string | null;
  occupiedDays: number;
  totalSessions: number;
  timeSlots: string[];
  groupIds: string[];
  requiredSessionCapacity: number;
  sessions: AllocationLabSession[];
};

function extractIsoDate(...values: unknown[]): string | null {
  for (const value of values) {
    const match = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return null;
}

export function deriveAllocationLabUsage(
  allocation: AllocationResultPayload,
): AllocationLabUsage[] {
  const rows = (allocation.master_allocation ?? []).filter(
    (row) => !isVpStudent(row) && row.Lab_ID !== "ONLINE" && String(row.Lab_ID ?? "").trim(),
  );
  const slots = resolveSlotSchedule(
    allocation.preferences_applied?.customSlots,
    allocation.preferences_applied?.blocked_days,
  );
  const slotsByNumber = new Map(slots.map((slot) => [slot.num, slot]));
  type SessionAccumulator = { date: string; time: string; groups: Set<string>; students: Set<string> };
  type LabAccumulator = {
    usage: Omit<AllocationLabUsage, "uniqueStudents" | "firstDate" | "lastDate" | "occupiedDays" | "totalSessions" | "timeSlots" | "groupIds" | "requiredSessionCapacity" | "sessions">;
    students: Set<string>;
    groups: Set<string>;
    sessions: Map<string, SessionAccumulator>;
  };
  const labs = new Map<string, LabAccumulator>();

  for (const row of rows) {
    const labCode = String(row.Lab_ID).trim();
    const slot = slotsByNumber.get(Number(row.Slot_Num));
    const date = extractIsoDate(row.Day, row.Slot_Key, row.Session, row.Time_Slot, slot?.date);
    const time = normalizeTimeSlot(slot?.time ?? row.Time_Slot) ?? String(slot?.time ?? row.Time_Slot ?? "").trim();
    const governorate = String(row.Governorate ?? "").trim() || "Unassigned Governorate";
    const physicalArea = String(row["Physical Area"] ?? "").trim() || "Unassigned Area";
    if (!labs.has(labCode)) {
      labs.set(labCode, {
        usage: {
          labCode,
          governorate,
          physicalArea,
          capacity: Number(row.Lab_Capacity) || 0,
          seatVisits: 0,
        },
        students: new Set(),
        groups: new Set(),
        sessions: new Map(),
      });
    }
    const lab = labs.get(labCode)!;
    lab.usage.capacity = Math.max(lab.usage.capacity, Number(row.Lab_Capacity) || 0);
    lab.usage.seatVisits += 1;
    lab.students.add(String(row.S_ID));
    if (row.Group_ID) lab.groups.add(String(row.Group_ID));
    if (date && time) {
      const key = `${date}__${time}`;
      if (!lab.sessions.has(key)) {
        lab.sessions.set(key, { date, time, groups: new Set(), students: new Set() });
      }
      const session = lab.sessions.get(key)!;
      session.students.add(String(row.S_ID));
      if (row.Group_ID) session.groups.add(String(row.Group_ID));
    }
  }

  return [...labs.values()].map((lab) => {
    const sessions = [...lab.sessions.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .map((session) => ({
        date: session.date,
        time: session.time,
        groupIds: [...session.groups].sort(),
        studentCount: session.students.size,
      }));
    const dates = [...new Set(sessions.map((session) => session.date))].sort();
    return {
      ...lab.usage,
      uniqueStudents: lab.students.size,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      occupiedDays: dates.length,
      totalSessions: sessions.length,
      timeSlots: [...new Set(sessions.map((session) => session.time))],
      groupIds: [...lab.groups].sort(),
      requiredSessionCapacity: Math.max(0, ...sessions.map((session) => session.studentCount)),
      sessions,
    };
  }).sort((a, b) => a.governorate.localeCompare(b.governorate)
    || a.physicalArea.localeCompare(b.physicalArea)
    || a.labCode.localeCompare(b.labCode, undefined, { numeric: true }));
}

export type ReplacementAvailability = "available" | "partially_conflicted" | "unavailable";

export function calculateReplacementAvailability(
  required: Array<{ date: string; time: string }>,
  occupied: Array<{ date: string; time: string }>,
) {
  const occupiedKeys = new Set(occupied.map((session) => `${session.date}__${normalizeTimeSlot(session.time) ?? session.time}`));
  const conflicts = required.filter((session) => occupiedKeys.has(`${session.date}__${normalizeTimeSlot(session.time) ?? session.time}`));
  const availableSessions = Math.max(0, required.length - conflicts.length);
  const status: ReplacementAvailability = conflicts.length === 0
    ? "available"
    : availableSessions === 0
      ? "unavailable"
      : "partially_conflicted";
  return { status, availableSessions, requiredSessions: required.length, conflicts };
}

