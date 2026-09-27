import type { LabRow } from "./parse";
import type { SlotInfo } from "./schedule";
import { DEFAULT_SLOT_INFO, isBlockedDay } from "./schedule";
import { normalizeTimeSlot } from "../time-slots";

export interface ExtraLabDefinition {
  labId: string;
  area: string;
  capacity: number;
  slots?: number[];
}

export interface SessionRow {
  "Lab ID": string;
  Area: string;
  True_Capacity: number;
  Day: string;
  Date?: string;
  Time_Slot?: string;
  Session: string;
  Slot_Num: number;
  Slot_Label: string;
  Slot_Key: string;
  [key: string]: unknown;
}

/** Port of build_full_session_grid: expands each physical lab into one row per
 * configured time slot. */
export function buildFullSessionGrid(
  labRows: LabRow[],
  extraLabs: ExtraLabDefinition[] = [],
  slotInfo: SlotInfo[] = DEFAULT_SLOT_INFO,
  blockedDays?: string[],
): SessionRow[] {
  const existingIds = new Set(labRows.map((l) => l["Lab ID"]));
  const allLabs = [...labRows];
  for (const extra of extraLabs) {
    const labId = String(extra.labId ?? "").trim();
    const area = String(extra.area ?? "").trim();
    const capacity = Number(extra.capacity ?? 25);
    if (labId && area && !existingIds.has(labId)) {
      allLabs.push({ "Lab ID": labId, Area: area, "Lab Capacity": capacity });
      existingIds.add(labId);
    }
  }

  const rows: SessionRow[] = [];
  for (const lab of allLabs) {
    for (const slot of slotInfo) {
      if (blockedDays && blockedDays.length > 0) {
        if (isBlockedDay(slot.day, slot.label, `${slot.day} ${slot.label}`, blockedDays)) {
          continue;
        }
      }
      rows.push({
        "Lab ID": lab["Lab ID"],
        Area: lab.Area,
        True_Capacity: Math.trunc(lab["Lab Capacity"]),
        Day: slot.day,
        Date: /^\d{4}-\d{2}-\d{2}$/.test(slot.day) ? slot.day : undefined,
        Time_Slot: slot.time ?? normalizeTimeSlot(slot.label) ?? slot.label,
        Session: slot.shift,
        Slot_Num: slot.num,
        Slot_Label: slot.label,
        Slot_Key: `${lab["Lab ID"]}_${slot.num}`,
      });
    }
  }
  return rows;
}
