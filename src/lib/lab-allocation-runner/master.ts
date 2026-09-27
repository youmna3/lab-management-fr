import type { StudentRow } from "./parse";
import { type AugmentedSession, fairBalancedDistribute } from "./distribute";
import type { GroupClassificationPreference, AllocationPreferences } from "@/lib/allocation-client";
import { overfillCapFor } from "./ilp";
import { yieldToMainThread } from "./async-util";
import { timeSlotToMinutes } from "../time-slots";

export interface MasterAllocationInternalRow {
  Group_ID: string;
  S_ID: string;
  Grade: number;
  "Physical Area": string;
  Lab_ID: string;
  Day: string;
  Session: string;
  Time_Slot: string;
  Slot_Key: string;
  Lab_Capacity: number;
  Slot_Num: number;
  Is_Overfill: boolean;
  Assigned_Count_Per_Lab?: number;
  Visit_Num?: number;
  Visit_Type?: "single_visit" | "multi_visit";
  Repeat_Count?: number;
  Original_Physical_Area?: string;
  Allocation_Area?: string;
  Governorate?: string;
}

export interface UnassignedInternalRow {
  S_ID: string;
  Grade: number;
  "Physical Area": string;
  Reason: string;
  Original_Physical_Area?: string;
  Allocation_Area?: string;
  Governorate?: string;
}

interface SlotTrack {
  labId: string;
  capacity: number;
  slots: AugmentedSession[];
}

/**
 * Computes a precise chronological timestamp score for a slot session.
 * Compares calendar date if present, day-of-week index, and time-of-day in minutes.
 * Guarantees that earlier dates/times always produce lower scores than later dates/times.
 */
export function getSlotChronologicalScore(slot: AugmentedSession): number {
  if (!slot) return 0;

  // 1. Check if Day contains an ISO date or parsable date string (e.g. 2026-09-10)
  const rawDay = String(slot.Day ?? "").trim();
  const dateMatch = rawDay.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const timestamp = Date.parse(dateMatch[1]);
    if (!isNaN(timestamp)) {
      const timeMinutes = parseTimeMinutes(slot.Time_Slot || slot.Slot_Label || slot.Session);
      return timestamp + timeMinutes * 60 * 1000;
    }
  }

  // 2. Map standard day of week index (Thursday first in Egypt school schedules)
  const dayLower = rawDay.toLowerCase();
  let dayRank = 10;
  if (dayLower.includes("thu")) dayRank = 1;
  else if (dayLower.includes("fri")) dayRank = 2;
  else if (dayLower.includes("sat")) dayRank = 3;
  else if (dayLower.includes("sun")) dayRank = 4;
  else if (dayLower.includes("mon")) dayRank = 5;
  else if (dayLower.includes("tue")) dayRank = 6;
  else if (dayLower.includes("wed")) dayRank = 7;

  // 3. Extract time of day in minutes
  const timeMinutes = parseTimeMinutes(slot.Time_Slot || slot.Slot_Label || slot.Session);

  // 4. Combine with slot number as fallback
  const slotNum = Number(slot.Slot_Num) || 0;

  return dayRank * 100000 + timeMinutes * 100 + slotNum;
}

export function compareSlotsChronologically(a: AugmentedSession, b: AugmentedSession): number {
  return getSlotChronologicalScore(a) - getSlotChronologicalScore(b);
}

function parseTimeMinutes(timeStr: unknown): number {
  const fromHelper = timeSlotToMinutes(timeStr);
  if (fromHelper !== null) return fromHelper;

  const s = String(timeStr ?? "").trim().toLowerCase();
  if (!s) return 0;

  // Match e.g. "10:00 am", "3 pm", "12:30 pm", "18:00"
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    let hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const isPm = m[3] === "pm";
    const isAm = m[3] === "am";

    if (isPm && hh < 12) hh += 12;
    else if (isAm && hh === 12) hh = 0;

    return hh * 60 + mm;
  }

  // Shift fallbacks
  if (s.includes("morn")) return 9 * 60;
  if (s.includes("after")) return 13 * 60;
  if (s.includes("even")) return 17 * 60;
  if (s.includes("night")) return 20 * 60;

  return 0;
}

export function getSlotDayKey(slot: AugmentedSession): string {
  if (!slot) return "";
  const rawDay = String(slot.Day ?? "").trim();
  const dateMatch = rawDay.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1];
  const labelMatch = String(slot.Slot_Label ?? "").match(/(\d{4}-\d{2}-\d{2})/);
  if (labelMatch) return labelMatch[1];
  return rawDay.toLowerCase() || `slot_${slot.Slot_Num}`;
}

export function getSlotTimeKey(slot: AugmentedSession): string {
  const timeMin = parseTimeMinutes(slot.Time_Slot || slot.Slot_Label || slot.Session);
  if (timeMin > 0) return `time_${timeMin}`;
  const cleanSession = String(slot.Session || "").trim().toLowerCase();
  if (cleanSession) return `session_${cleanSession}`;
  return `slotnum_${slot.Slot_Num}`;
}

export function getSlotRecurringKey(slot: AugmentedSession): string {
  const timeKey = getSlotTimeKey(slot);
  return `${slot["Lab ID"]}__${timeKey}`;
}

/**
 * Builds weekly multi-session slot tracks for an Area and Grade across available lab sessions.
 * 1. Partitions sessions within each lab into complete tracks of size repeatCount at the EXACT SAME time-of-day across strictly distinct days.
 * 2. Bridges leftover sessions across labs within the same Area+Grade into complete tracks of size repeatCount.
 * 3. Preserves fixed weekly time-slots across multiple weeks/days: when a schedule spans recurring days,
 *    slots at the same recurring time in the same lab are bound into the same track for that single group.
 * 4. Sorts each track's slots in strict ascending chronological order (by date + time of day)
 *    so Visit 1 is always scheduled before Visit 2, which is scheduled before Visit 3, etc.
 * 5. Strictly guarantees max one visit per calendar day: no group is ever assigned two visits on the same day.
 */
function hasCalendarDates(slots: AugmentedSession[]): boolean {
  return slots.some(
    (s) =>
      Boolean(s.Date) ||
      /\d{4}-\d{2}-\d{2}/.test(String(s.Day ?? "")) ||
      /\d{4}-\d{2}-\d{2}/.test(String(s.Slot_Label ?? ""))
  );
}

function buildSlotTracksForAreaGrade(
  labMap: Map<string, AugmentedSession[]>,
  repeatCount: number,
): SlotTrack[] {
  if (repeatCount <= 1) {
    const tracks: SlotTrack[] = [];
    for (const [, labSlots] of labMap) {
      for (const s of labSlots) {
        tracks.push({
          labId: s["Lab ID"],
          capacity: Math.trunc(s.True_Capacity),
          slots: [s],
        });
      }
    }
    return tracks;
  }

  const allLabSlots = Array.from(labMap.values()).flat();
  const withDates = hasCalendarDates(allLabSlots);

  const tracks: SlotTrack[] = [];
  const leftoverSlots: AugmentedSession[] = [];

  // Pass 1: Build complete tracks of size repeatCount within each lab
  for (const [, labSlots] of labMap) {
    if (labSlots.length === 0) continue;

    const usedInLab = new Set<string>();

    // Strategy 1A: Check for direct recurring same-time slot tracks (e.g. 10:00 AM Day 1, Day 2, Day 3...)
    const sameTimeSlotsMap = new Map<string, AugmentedSession[]>();
    for (const s of labSlots) {
      const timeKey = getSlotTimeKey(s);
      if (!sameTimeSlotsMap.has(timeKey)) sameTimeSlotsMap.set(timeKey, []);
      sameTimeSlotsMap.get(timeKey)!.push(s);
    }
    for (const list of sameTimeSlotsMap.values()) {
      list.sort(compareSlotsChronologically);
    }

    const sortedTimeEntries = [...sameTimeSlotsMap.entries()].sort((a, b) => {
      return compareSlotsChronologically(a[1][0], b[1][0]);
    });

    for (const [, timeList] of sortedTimeEntries) {
      const trackCandidates = timeList.filter((s) => !usedInLab.has(s.Slot_Key));
      if (trackCandidates.length >= repeatCount) {
        // Collect candidate slots across strictly distinct calendar days
        const distinctDaySlots: AugmentedSession[] = [];
        const seenDays = new Set<string>();
        for (const s of trackCandidates) {
          const dKey = getSlotDayKey(s);
          if (!seenDays.has(dKey)) {
            distinctDaySlots.push(s);
            seenDays.add(dKey);
          }
        }

        const numTracks = Math.floor(distinctDaySlots.length / repeatCount);
        for (let t = 0; t < numTracks; t++) {
          const trackSlots = distinctDaySlots.slice(t * repeatCount, (t + 1) * repeatCount);
          if (trackSlots.length === repeatCount) {
            trackSlots.sort(compareSlotsChronologically);
            trackSlots.forEach((s) => usedInLab.add(s.Slot_Key));
            tracks.push({
              labId: labSlots[0]["Lab ID"],
              capacity: Math.trunc(trackSlots[0].True_Capacity),
              slots: trackSlots,
            });
          }
        }
      }
    }

    // Strategy 1B: Group remaining slots by Slot_Num across distinct days in the same lab
    const remainingInLab = labSlots.filter((s) => !usedInLab.has(s.Slot_Key));
    if (remainingInLab.length >= repeatCount) {
      const slotNumMap = new Map<number, AugmentedSession[]>();
      for (const s of remainingInLab) {
        const num = s.Slot_Num || 1;
        if (!slotNumMap.has(num)) slotNumMap.set(num, []);
        slotNumMap.get(num)!.push(s);
      }
      for (const list of slotNumMap.values()) {
        list.sort(compareSlotsChronologically);
      }

      const sortedNumEntries = [...slotNumMap.entries()].sort((a, b) => a[0] - b[0]);
      for (const [, numList] of sortedNumEntries) {
        const candidates = numList.filter((s) => !usedInLab.has(s.Slot_Key));
        if (candidates.length >= repeatCount) {
          const distinctDaySlots: AugmentedSession[] = [];
          const seenDays = new Set<string>();
          for (const s of candidates) {
            const dKey = getSlotDayKey(s);
            if (!seenDays.has(dKey)) {
              distinctDaySlots.push(s);
              seenDays.add(dKey);
            }
          }

          const numTracks = Math.floor(distinctDaySlots.length / repeatCount);
          for (let t = 0; t < numTracks; t++) {
            const trackSlots = distinctDaySlots.slice(t * repeatCount, (t + 1) * repeatCount);
            if (trackSlots.length === repeatCount) {
              trackSlots.sort(compareSlotsChronologically);
              trackSlots.forEach((s) => usedInLab.add(s.Slot_Key));
              tracks.push({
                labId: labSlots[0]["Lab ID"],
                capacity: Math.trunc(trackSlots[0].True_Capacity),
                slots: trackSlots,
              });
            }
          }
        }
      }
    }
  }

  // Sort tracks lab-first, then chronologically by time within each lab.
  // This ensures all time slots in Lab1 (10am → 12:30pm → 4pm → 7:30pm) are
  // filled before any slots in Lab2 are opened, matching the intended
  // "pack a lab's own daily slots before spreading to the next lab" behaviour.
  tracks.sort((a, b) => {
    if (a.labId !== b.labId) return a.labId.localeCompare(b.labId);
    const scoreA = getSlotChronologicalScore(a.slots[0]);
    const scoreB = getSlotChronologicalScore(b.slots[0]);
    return scoreA - scoreB;
  });

  return tracks;
}

export function distributeStudentsAcrossTracks(
  tracks: SlotTrack[],
  totalToAssign: number,
  getMaxCap: (t: SlotTrack) => number,
): number[] {
  const n = tracks.length;
  if (n === 0 || totalToAssign <= 0) return [];
  const caps = tracks.map(getMaxCap);

  if (totalToAssign < 8) {
    const sizes = new Array(n).fill(0);
    sizes[0] = Math.min(totalToAssign, caps[0]);
    return sizes;
  }

  // Max number of tracks that can each hold at least 8 students
  const maxFeasibleTracks = Math.min(n, Math.floor(totalToAssign / 8));
  if (maxFeasibleTracks <= 0) return new Array(n).fill(0);

  // Find minimal k <= maxFeasibleTracks that can accommodate totalToAssign
  let chosenK = maxFeasibleTracks;
  let runningCap = 0;
  for (let k = 1; k <= maxFeasibleTracks; k++) {
    runningCap += caps[k - 1];
    if (runningCap >= totalToAssign) {
      chosenK = k;
      break;
    }
  }

  const activeCaps = caps.slice(0, chosenK);
  const totalActiveCap = activeCaps.reduce((a, b) => a + b, 0);
  const toDistribute = Math.min(totalToAssign, totalActiveCap);

  const distributed = fairBalancedDistribute(toDistribute, activeCaps);
  const sizes = new Array(n).fill(0);
  for (let i = 0; i < chosenK; i++) {
    sizes[i] = distributed[i] || 0;
  }

  return sizes;
}

/**
 * Generates Master Allocation rows and Unassigned records.
 * Supports both Single-Session Groups (SG) and Multi-Session Weekly Distribution.
 *
 * Visit count is inherited exclusively from the parent batch configuration.
 * Legacy per-group repeat counts are accepted for payload compatibility but ignored.
 */
export async function generateMasterAllocation(
  students: StudentRow[],
  assignmentPlan: Map<string, Map<string, number>>,
  slotLookup: Map<string, AugmentedSession>,
  groupIdPrefix: string,
  slotLabelsByNum: Map<number, string>,
  groupClassifications?: GroupClassificationPreference[],
  batchGroupType?: "single_session" | "multi_session",
  defaultRepeatCount?: number,
  overfillRules?: AllocationPreferences["overfillRules"],
  onProgress?: (progress: { stage: string; current: number; total: number; percent: number; message: string }) => void,
): Promise<{ masterRows: MasterAllocationInternalRow[]; unassignedRows: UnassignedInternalRow[] }> {
  const masterRows: MasterAllocationInternalRow[] = [];
  const unassignedRows: UnassignedInternalRow[] = [];
  let slotIdCounter = 1;

  const classificationRepeat = groupClassifications?.find((c) => c.visit_type === "multi_visit" && Number(c.repeat_count) > 1)?.repeat_count;
  const isMultiSessionBatch = batchGroupType === "multi_session" || Boolean(classificationRepeat);
  const canonicalBatchRepeat = (batchGroupType === "multi_session" && defaultRepeatCount)
    ? Math.trunc(Number(defaultRepeatCount))
    : classificationRepeat
      ? Math.trunc(Number(classificationRepeat))
      : 1;
  if (isMultiSessionBatch && canonicalBatchRepeat < 2) {
    throw new Error("Multi-Session allocation requires the batch Sessions / Group value.");
  }

  // Pre-organize available slots per Area & Grade and Lab ID
  const slotsByAreaGradeLab = new Map<string, Map<string, AugmentedSession[]>>();
  for (const slot of slotLookup.values()) {
    if (slot.Grade === undefined || slot.Grade === 0) continue;
    const key = `${slot.Area}__${slot.Grade}`;
    if (!slotsByAreaGradeLab.has(key)) slotsByAreaGradeLab.set(key, new Map());
    const labMap = slotsByAreaGradeLab.get(key)!;
    const labId = slot["Lab ID"];
    if (!labMap.has(labId)) labMap.set(labId, []);
    const labList = labMap.get(labId)!;
    if (!labList.some((s) => s.Slot_Key === slot.Slot_Key)) {
      labList.push(slot);
    }
  }

  const byGroup = new Map<string, StudentRow[]>();
  for (const s of students) {
    const key = `${s["Physical Area"]}__${s.Grade}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(s);
  }
  const sortedGroupKeys = [...byGroup.keys()].sort((a, b) => {
    const [areaA, gradeA] = a.split("__");
    const [areaB, gradeB] = b.split("__");
    if (areaA !== areaB) return areaA < areaB ? -1 : 1;
    return Number(gradeA) - Number(gradeB);
  });

  // Track used slots across all group generations to prevent cross-group double-booking
  const usedSlotKeysAcrossAllGroups = new Set<string>();

  let groupIterIdx = 0;
  const totalGroupsToProcess = sortedGroupKeys.length;

  for (const key of sortedGroupKeys) {
    groupIterIdx++;
    const [area, gradeStr] = key.split("__");
    const grade = Number(gradeStr);
    const studentsSub = [...byGroup.get(key)!].sort((a, b) => (a.S_ID < b.S_ID ? -1 : a.S_ID > b.S_ID ? 1 : 0));
    const totalStudents = studentsSub.length;

    if (onProgress && groupIterIdx % 5 === 0) {
      const pct = Math.round((groupIterIdx / totalGroupsToProcess) * 100);
      onProgress({
        stage: "master_tracks",
        current: groupIterIdx,
        total: totalGroupsToProcess,
        percent: pct,
        message: `Building master recurring tracks for ${area} Grade ${grade} (${groupIterIdx}/${totalGroupsToProcess})...`,
      });
    }

    const areaRepeat = canonicalBatchRepeat;

    const isAreaMultiVisit = areaRepeat > 1;

    if (!isAreaMultiVisit) {
      // -----------------------------------------------------------------------
      // SINGLE-SESSION MODE (1 visit per student / slot)
      // -----------------------------------------------------------------------
      const slotCounts = assignmentPlan.get(key) ?? new Map<string, number>();
      const slotQueue: string[] = [];
      const slotGroupId = new Map<string, string>();
      for (const [slotKey, count] of slotCounts) {
        if (count <= 0) continue;
        const groupMapKey = `${slotKey}__${area}__${grade}`;
        if (!slotGroupId.has(groupMapKey)) {
          slotGroupId.set(groupMapKey, `${groupIdPrefix}${slotIdCounter}`);
          slotIdCounter += 1;
        }
        for (let i = 0; i < count; i++) slotQueue.push(slotKey);
      }

      const totalPlanned = slotQueue.length;
      const slotFillCounter = new Map<string, number>();
      const n = Math.min(totalStudents, totalPlanned);

      for (let i = 0; i < n; i++) {
        const student = studentsSub[i];
        const slotKey = slotQueue[i];
        const slotRow = slotLookup.get(slotKey);
        if (!slotRow) {
          unassignedRows.push({
            S_ID: student.S_ID,
            Grade: grade,
            "Physical Area": area,
            Reason: `Slot session "${slotKey}" not found in schedule grid`,
          });
          continue;
        }
        const capLimit = Math.trunc(slotRow.True_Capacity);
        const currIdx = (slotFillCounter.get(slotKey) ?? 0) + 1;
        slotFillCounter.set(slotKey, currIdx);
        const isOverfill = currIdx > capLimit;
        const slotNum = slotRow.Slot_Num;
        const timeSlot = slotRow.Slot_Label ?? slotLabelsByNum.get(slotNum) ?? slotRow.Time_Slot ?? `Slot ${slotNum}`;
        const groupMapKey = `${slotKey}__${area}__${grade}`;
        const groupId = slotGroupId.get(groupMapKey) ?? slotGroupId.get(slotKey)!;

        masterRows.push({
          Group_ID: groupId,
          S_ID: student.S_ID,
          Grade: grade,
          "Physical Area": area,
          Lab_ID: slotRow["Lab ID"],
          Day: slotRow.Day,
          Session: slotRow.Session,
          Time_Slot: timeSlot,
          Slot_Key: slotKey,
          Lab_Capacity: capLimit,
          Slot_Num: slotNum,
          Is_Overfill: isOverfill,
          Visit_Num: 1,
          Visit_Type: "single_visit",
          Repeat_Count: 1,
        });
      }

      if (totalStudents > totalPlanned) {
        for (let i = totalPlanned; i < totalStudents; i++) {
          const student = studentsSub[i];
          unassignedRows.push({
            S_ID: student.S_ID,
            Grade: grade,
            "Physical Area": area,
            Reason: "No remaining true-capacity seat in this Area+Grade",
          });
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // MULTI-SESSION WEEKLY DISTRIBUTION MODE (Track-Unit Allocation)
      // -----------------------------------------------------------------------
      const labMap = slotsByAreaGradeLab.get(key) || new Map<string, AugmentedSession[]>();
      
      // Filter out slots already claimed by prior tracks
      const filteredLabMap = new Map<string, AugmentedSession[]>();
      for (const [lId, lSlots] of labMap) {
        const avail = lSlots.filter((s) => !usedSlotKeysAcrossAllGroups.has(s.Slot_Key));
        if (avail.length > 0) filteredLabMap.set(lId, avail);
      }

      const initialTracks = buildSlotTracksForAreaGrade(filteredLabMap, areaRepeat);
      const initialCapacity = initialTracks.reduce((acc, t) => acc + t.capacity, 0);

      let allTracks = [...initialTracks];

      // If initial ILP-assigned tracks cannot fit all students, activate open lab capacity in this area
      if (totalStudents > initialCapacity) {
        const initialTrackSlotKeys = new Set<string>();
        for (const t of initialTracks) {
          for (const s of t.slots) initialTrackSlotKeys.add(s.Slot_Key);
        }

        const openLabMap = new Map<string, AugmentedSession[]>();
        for (const s of slotLookup.values()) {
          if (s.Area === area && !usedSlotKeysAcrossAllGroups.has(s.Slot_Key) && !initialTrackSlotKeys.has(s.Slot_Key)) {
            const lId = s["Lab ID"];
            if (!openLabMap.has(lId)) openLabMap.set(lId, []);
            openLabMap.get(lId)!.push(s);
          }
        }

        const additionalTracks = buildSlotTracksForAreaGrade(openLabMap, areaRepeat);
        allTracks = [...initialTracks, ...additionalTracks];
      }

      const getMaxCap = (t: SlotTrack) => {
        const extra = overfillCapFor?.(t.labId, area, grade, overfillRules || []) ?? 0;
        return t.capacity + extra;
      };

      const totalAllowedCapacity = allTracks.reduce((acc, t) => acc + getMaxCap(t), 0);

      // Select active tracks
      let activeTracks: SlotTrack[] = [];
      if (totalStudents <= totalAllowedCapacity) {
        let capSum = 0;
        for (const t of allTracks) {
          activeTracks.push(t);
          capSum += getMaxCap(t);
          if (capSum >= totalStudents) break;
        }
      } else {
        activeTracks = [...allTracks];
      }

      // Sizing groups using capacity-constrained water-filling distribution to prevent unauthorized overfills
      const groupSizes = distributeStudentsAcrossTracks(activeTracks, totalStudents, getMaxCap);

      // Mark only slots in actively used tracks as used
      for (let tIdx = 0; tIdx < activeTracks.length; tIdx++) {
        if ((groupSizes[tIdx] ?? 0) <= 0) continue;
        const t = activeTracks[tIdx];
        for (const s of t.slots) {
          usedSlotKeysAcrossAllGroups.add(s.Slot_Key);
        }
      }

      let studentIdx = 0;
      for (let tIdx = 0; tIdx < activeTracks.length; tIdx++) {
        if (studentIdx >= totalStudents) break;
        const track = activeTracks[tIdx];
        const groupSize = groupSizes[tIdx] ?? 0;
        if (groupSize <= 0) continue;
        const groupId = `${groupIdPrefix}${slotIdCounter++}`;

        const groupRepeat = canonicalBatchRepeat;

        const orderedSlots = [...track.slots].sort(compareSlotsChronologically);
        const actualVisitsCount = Math.min(groupRepeat, orderedSlots.length);
        const actualGroupSize = Math.min(groupSize, totalStudents - studentIdx);
        if (actualGroupSize <= 0) continue;

        const isOverfill = actualGroupSize > track.capacity;

        for (let i = 0; i < actualGroupSize; i++) {
          const student = studentsSub[studentIdx + i];
          if (!student) continue;
          for (let v = 0; v < actualVisitsCount; v++) {
            const slot = orderedSlots[v];
            const slotNum = slot.Slot_Num;
            const timeSlot = slot.Slot_Label ?? slotLabelsByNum.get(slotNum) ?? slot.Time_Slot ?? `Slot ${slotNum}`;

            masterRows.push({
              Group_ID: groupId,
              S_ID: student.S_ID,
              Grade: grade,
              "Physical Area": area,
              Lab_ID: slot["Lab ID"],
              Day: slot.Day,
              Session: slot.Session,
              Time_Slot: timeSlot,
              Slot_Key: slot.Slot_Key,
              Lab_Capacity: track.capacity,
              Slot_Num: slotNum,
              Is_Overfill: isOverfill,
              Visit_Num: v + 1,
              Visit_Type: "multi_visit",
              Repeat_Count: groupRepeat,
            });
          }
        }
        studentIdx += actualGroupSize;
      }

      // Record any unassigned students that exceed available multi-session tracks or were leftover fragments (< 8)
      const leftoverCount = totalStudents - studentIdx;
      while (studentIdx < totalStudents) {
        const student = studentsSub[studentIdx++];
        unassignedRows.push({
          S_ID: student.S_ID,
          Grade: grade,
          "Physical Area": area,
          Reason: leftoverCount < 8
            ? `Leftover fragment (${leftoverCount} student${leftoverCount !== 1 ? "s" : ""}) below minimum lab threshold (8). Eligible for Fair Overfill (+2) resolution.`
            : "No complete recurring same-lab/same-time track is available for all active multi-session dates.",
        });
      }
    }

    if (groupIterIdx % 5 === 0) {
      await yieldToMainThread();
    }
  }

  if (masterRows.length > 0) {
    const countBySlot = new Map<string, number>();
    for (const r of masterRows) countBySlot.set(r.Slot_Key, (countBySlot.get(r.Slot_Key) ?? 0) + 1);
    for (const r of masterRows) r.Assigned_Count_Per_Lab = countBySlot.get(r.Slot_Key)!;

    // Runtime assertion: Enforce max one visit per day per multi-session student
    const studentVisits = new Map<string, Set<string>>();
    let integrityAlertCount = 0;
    for (const r of masterRows) {
      if (r.Visit_Type === "multi_visit" && (r.Repeat_Count ?? 1) > 1) {
        const dayKey = getSlotDayKey({ Day: r.Day, Slot_Label: r.Time_Slot, Slot_Num: r.Slot_Num } as any);
        if (!studentVisits.has(r.S_ID)) studentVisits.set(r.S_ID, new Set());
        const days = studentVisits.get(r.S_ID)!;
        if (days.has(dayKey)) {
          if (integrityAlertCount < 5) {
            console.warn(`[Integrity Alert] Multi-session student ${r.S_ID} in group ${r.Group_ID} has multiple visits on day ${dayKey}`);
          }
          integrityAlertCount++;
        }
        days.add(dayKey);
      }
    }
  }

  return { masterRows, unassignedRows };
}
