export const MAX_SLOTS_PER_DAY = 12;
export const MAX_BATCH_TIME_SLOTS = MAX_SLOTS_PER_DAY;
export const BATCH_TIME_START_MINUTES = 8 * 60; // 8:00 AM
export const BATCH_TIME_END_MINUTES = 22 * 60; // 10:00 PM
export const BATCH_TIME_INTERVAL_MINUTES = 30;
export const DEFAULT_BATCH_TIME_SLOTS = ["10:00", "12:30", "16:00", "19:30"];

export type NormalizeTimeSlotsOptions = {
  preserveInvalid?: boolean;
};

export type TimeSlotSelectionResult = {
  values: string[];
  limitReached: boolean;
};

function canonicalTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Normalizes any time slot representation to canonical "HH:mm".
 * Handles inputs with date prefixes (e.g. "2026-08-25@10:00" -> "10:00", "2026-08-25 14:30" -> "14:30").
 */
export function normalizeTimeSlot(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  let input = String(value).trim().replace(/\./g, "").replace(/\s+/g, " ");
  if (!input) return null;

  // Extract time portion if prefixed with date (e.g. "2026-08-25@10:00" or "2026-08-25 10:00")
  const datePrefixMatch = input.match(/^(\d{4}-\d{2}-\d{2})[@\s](.+)$/);
  if (datePrefixMatch) {
    input = datePrefixMatch[2].trim();
  }

  // Also handle day-of-week prefixes like "Thu 10:00" or "Thursday 10:00"
  const dayPrefixMatch = input.match(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(.+)$/i);
  if (dayPrefixMatch) {
    input = dayPrefixMatch[1].trim();
  }

  // Handle display labels produced by formatTimeSlot, such as "13 Sep 10:00 AM".
  const displayDatePrefixMatch = input.match(/^\d{1,2}\s+[a-z]{3,9}\s+(.+)$/i);
  if (displayDatePrefixMatch) {
    input = displayDatePrefixMatch[1].trim();
  }

  // Handle time ranges like "10:00 - 12:00" or "10:00 to 12:00" -> extract start time
  const rangeMatch = input.match(/^([^\s-]+(?:\s*[ap]m)?)\s*(?:-|–|to)\s*.+$/i);
  if (rangeMatch) {
    input = rangeMatch[1].trim();
  }

  const twelveHourMatch = input.match(/^(\d{1,2})(?::([0-5]\d))?\s*([ap])m?$/i);
  if (twelveHourMatch) {
    const hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2] ?? 0);
    if (hours < 1 || hours > 12) return null;

    const period = twelveHourMatch[3].toLowerCase();
    const normalizedHours = (hours % 12) + (period === "p" ? 12 : 0);
    return canonicalTime(normalizedHours, minutes);
  }

  const twentyFourHourMatch = input.match(/^(\d{1,2})(?::([0-5]\d))?$/);
  if (!twentyFourHourMatch) return null;

  const hours = Number(twentyFourHourMatch[1]);
  const minutes = Number(twentyFourHourMatch[2] ?? 0);
  if (hours < 0 || hours > 23) return null;
  return canonicalTime(hours, minutes);
}

export function timeSlotToMinutes(value: unknown): number | null {
  const normalized = normalizeTimeSlot(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatTimeSlot(value: unknown): string {
  const rawStr = String(value ?? "").trim();
  if (!rawStr) return "";

  // Check if raw value has a date tag
  const dateMatch = rawStr.match(/^(\d{4}-\d{2}-\d{2})[@\s](.+)$/);
  const timeToFormat = dateMatch ? dateMatch[2] : rawStr;

  const normalized = normalizeTimeSlot(timeToFormat);
  if (!normalized) return timeToFormat;

  const [hours, minutes] = normalized.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const formattedTime = `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;

  if (dateMatch) {
    const dateObj = new Date(`${dateMatch[1]}T00:00:00`);
    const dateLabel = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : dateMatch[1];
    return `${dateLabel} ${formattedTime}`;
  }

  return formattedTime;
}

export function isSupportedBatchTimeSlot(value: unknown): boolean {
  const minutes = timeSlotToMinutes(value);
  return (
    minutes !== null &&
    minutes >= BATCH_TIME_START_MINUTES &&
    minutes <= BATCH_TIME_END_MINUTES &&
    minutes % BATCH_TIME_INTERVAL_MINUTES === 0
  );
}

export function sortTimeSlots(values: string[]): string[] {
  return [...values].sort((a, b) => {
    // If date tagged, compare dates first
    const dateA = a.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    const dateB = b.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);

    const aMinutes = timeSlotToMinutes(a);
    const bMinutes = timeSlotToMinutes(b);
    if (aMinutes !== null && bMinutes !== null) return aMinutes - bMinutes;
    if (aMinutes !== null) return -1;
    if (bMinutes !== null) return 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function normalizeTimeSlots(
  values: unknown,
  options: NormalizeTimeSlotsOptions = {},
): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  values.forEach((value) => {
    const normalized = normalizeTimeSlot(value);
    const fallback =
      options.preserveInvalid && typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    const nextValue = normalized ?? fallback;
    if (!nextValue) return;

    const dedupeKey = normalized ? `time:${normalized}` : `legacy:${nextValue.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalizedValues.push(nextValue);
  });

  return sortTimeSlots(normalizedValues);
}

export function toggleBatchTimeSlotSelection(
  values: unknown,
  slot: string,
  maxAllowed: number = MAX_SLOTS_PER_DAY,
): TimeSlotSelectionResult {
  const selectedSlots = normalizeTimeSlots(values, { preserveInvalid: true });
  const normalizedSlot = normalizeTimeSlot(slot) ?? slot.trim().replace(/\s+/g, " ");
  if (!normalizedSlot) return { values: selectedSlots, limitReached: false };

  if (selectedSlots.includes(normalizedSlot)) {
    return {
      values: normalizeTimeSlots(
        selectedSlots.filter((selectedSlot) => selectedSlot !== normalizedSlot),
        { preserveInvalid: true },
      ),
      limitReached: false,
    };
  }

  if (selectedSlots.length >= maxAllowed) {
    return { values: selectedSlots, limitReached: true };
  }

  return {
    values: normalizeTimeSlots([...selectedSlots, normalizedSlot], { preserveInvalid: true }),
    limitReached: false,
  };
}

/**
 * Extracts per-day time slots map from batch dates and time_slots array.
 */
export function getDayTimeSlots(
  dates: string[],
  timeSlots: string[] | undefined | null,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const safeDates = Array.isArray(dates) ? [...dates].sort() : [];
  const safeSlots = Array.isArray(timeSlots) ? timeSlots : [];

  const dateTaggedSlots = new Map<string, string[]>();
  const untaggedSlots: string[] = [];

  safeSlots.forEach((slotStr) => {
    const str = String(slotStr).trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2})[@\s](.+)$/);
    if (m) {
      const date = m[1];
      const time = normalizeTimeSlot(m[2]) ?? m[2].trim();
      if (!dateTaggedSlots.has(date)) dateTaggedSlots.set(date, []);
      if (time && !dateTaggedSlots.get(date)!.includes(time)) {
        dateTaggedSlots.get(date)!.push(time);
      }
    } else {
      const time = normalizeTimeSlot(str) ?? str;
      if (time && !untaggedSlots.includes(time)) {
        untaggedSlots.push(time);
      }
    }
  });

  safeDates.forEach((date) => {
    if (dateTaggedSlots.has(date) && dateTaggedSlots.get(date)!.length > 0) {
      result[date] = sortTimeSlots(dateTaggedSlots.get(date)!);
    } else if (untaggedSlots.length > 0) {
      result[date] = sortTimeSlots([...untaggedSlots]);
    } else {
      result[date] = [];
    }
  });

  return result;
}

/**
 * Flattens a per-day time slots map into a database-storable string array.
 */
export function flattenDayTimeSlots(daySlots: Record<string, string[]>): string[] {
  const dates = Object.keys(daySlots).sort();
  if (dates.length === 0) return [];

  const output: string[] = [];
  dates.forEach((date) => {
    const slots = sortTimeSlots(daySlots[date] || []);
    slots.forEach((slot) => {
      const cleanSlot = normalizeTimeSlot(slot) ?? slot;
      output.push(`${date}@${cleanSlot}`);
    });
  });
  return output;
}

export const BATCH_TIME_SLOT_OPTIONS = Array.from(
  {
    length: (BATCH_TIME_END_MINUTES - BATCH_TIME_START_MINUTES) / BATCH_TIME_INTERVAL_MINUTES + 1,
  },
  (_, index) => {
    const totalMinutes = BATCH_TIME_START_MINUTES + index * BATCH_TIME_INTERVAL_MINUTES;
    return canonicalTime(Math.floor(totalMinutes / 60), totalMinutes % 60);
  },
);

export const BATCH_TIME_SLOT_PRESETS = [
  { label: "4 Slots (Standard): 10:00, 12:30, 16:00, 19:30", values: ["10:00", "12:30", "16:00", "19:30"] },
  { label: "3 Slots: 10:00, 13:00, 16:00", values: ["10:00", "13:00", "16:00"] },
  { label: "2 Slots: 10:00, 14:00", values: ["10:00", "14:00"] },
  { label: "1 Slot: 10:00", values: ["10:00"] },
] as const;


