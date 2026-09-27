import type { SessionRow } from "./grid";
import type { StudentRow } from "./parse";
import type { AllocationPreferences } from "@/lib/allocation-client";
import { compareSlotsChronologically } from "./master";

export type AugmentedSession = SessionRow & { Grade: number };

/**
 * Fair / Balanced Water-Filling Distribution
 * Distributes totalStudents across a set of slots/tracks with given capacities
 * minimizing the difference between the maximum and minimum student count across the slots,
 * while strictly respecting each slot's capacity limit.
 */
export function fairBalancedDistribute(
  totalStudents: number,
  capacities: number[],
): number[] {
  const k = capacities.length;
  if (k === 0 || totalStudents <= 0) return new Array(k).fill(0);
  const assigned = new Array(k).fill(0);
  let remaining = totalStudents;

  while (remaining > 0) {
    let minVal = Infinity;
    let eligibleIndices: number[] = [];

    for (let i = 0; i < k; i++) {
      if (assigned[i] < capacities[i]) {
        if (assigned[i] < minVal) {
          minVal = assigned[i];
          eligibleIndices = [i];
        } else if (assigned[i] === minVal) {
          eligibleIndices.push(i);
        }
      }
    }

    if (eligibleIndices.length === 0) break;

    let nextThreshold = Infinity;
    for (let i = 0; i < k; i++) {
      if (assigned[i] < capacities[i] && assigned[i] > minVal) {
        nextThreshold = Math.min(nextThreshold, assigned[i]);
      } else if (assigned[i] < capacities[i] && assigned[i] === minVal) {
        nextThreshold = Math.min(nextThreshold, capacities[i]);
      }
    }

    const stepPerSlot = Math.max(1, Math.min(
      nextThreshold - minVal,
      Math.floor(remaining / eligibleIndices.length)
    ));

    if (stepPerSlot * eligibleIndices.length <= remaining && stepPerSlot > 0) {
      for (const idx of eligibleIndices) {
        assigned[idx] += stepPerSlot;
        remaining -= stepPerSlot;
      }
    } else {
      for (const idx of eligibleIndices) {
        if (remaining <= 0) break;
        assigned[idx] += 1;
        remaining -= 1;
      }
    }
  }

  return assigned;
}

export const MIN_LAB_STUDENT_THRESHOLD = 8;

/** Packs demand into capacities in priority order without balancing opened slots. */
export function capacityFirstPack(
  totalStudents: number,
  capacities: number[],
  minimumNewSlotSize = MIN_LAB_STUDENT_THRESHOLD,
): { counts: number[]; leftover: number } {
  const counts = new Array(capacities.length).fill(0);
  let remaining = Math.max(0, Math.trunc(totalStudents));

  for (let i = 0; i < capacities.length && remaining > 0; i++) {
    const capacity = Math.max(0, Math.trunc(capacities[i] ?? 0));
    if (capacity === 0) continue;
    if (i > 0 && remaining < minimumNewSlotSize) break;
    const assigned = Math.min(remaining, capacity);
    counts[i] = assigned;
    remaining -= assigned;
  }

  return { counts, leftover: remaining };
}

/** Single-session lab-first packing: fill all selected sessions in one lab before opening the next. */
export function capacityFirstDistribute(
  totalStudents: number,
  slotsGroup: AugmentedSession[],
  slotOverfillCaps: Record<string, number> = {},
): { assigned: Map<string, number>; leftover: number } {
  const uniqueByKey = new Map<string, AugmentedSession>();
  for (const slot of slotsGroup) {
    if (!uniqueByKey.has(slot.Slot_Key)) uniqueByKey.set(slot.Slot_Key, slot);
  }
  const labOrder = new Map<string, number>();
  for (const slot of uniqueByKey.values()) {
    if (!labOrder.has(slot["Lab ID"])) labOrder.set(slot["Lab ID"], labOrder.size);
  }
  const slots = [...uniqueByKey.values()].sort((a, b) => {
    const labPriority = (labOrder.get(a["Lab ID"]) ?? 0) - (labOrder.get(b["Lab ID"]) ?? 0);
    return labPriority || compareSlotsChronologically(a, b);
  });
  const capacities = slots.map((slot) => slot.True_Capacity + (slotOverfillCaps[slot.Slot_Key] ?? 0));
  const packed = capacityFirstPack(totalStudents, capacities);
  const assigned = new Map<string, number>();
  slots.forEach((slot, index) => {
    if (packed.counts[index] > 0) assigned.set(slot.Slot_Key, packed.counts[index]);
  });
  return { assigned, leftover: packed.leftover };
}

/** Spreads `totalStudents` across chronological sessions, balancing students evenly across the active sessions. */
export function balancedDistribute(
  totalStudents: number,
  slotsGroup: AugmentedSession[],
  slotOverfillCaps: Record<string, number> = {},
): { assigned: Map<string, number>; leftover: number } {
  const uniqueByKey = new Map<string, AugmentedSession>();
  for (const s of slotsGroup) {
    if (!uniqueByKey.has(s.Slot_Key)) uniqueByKey.set(s.Slot_Key, s);
  }
  // Sort slots in strict chronological order (Day 1 Slot 1, Day 1 Slot 2... before Day 2)
  const slots = [...uniqueByKey.values()].sort(compareSlotsChronologically);
  const numSlots = slots.length;
  if (numSlots === 0 || totalStudents <= 0) return { assigned: new Map(), leftover: totalStudents };

  const effectiveCap = new Map<string, number>();
  for (const slot of slots) {
    const overfill = slotOverfillCaps[slot.Slot_Key] ?? 0;
    effectiveCap.set(slot.Slot_Key, slot.True_Capacity + overfill);
  }

  // Pick minimal set of active slots from the front in chronological order (fill Day 1 first)
  let capSum = 0;
  const activeSlots: AugmentedSession[] = [];
  for (const slot of slots) {
    activeSlots.push(slot);
    capSum += effectiveCap.get(slot.Slot_Key)!;
    if (capSum >= totalStudents) break;
  }

  const numActive = activeSlots.length;
  const assigned = new Map<string, number>();

  // Fair balanced distribution across active slots up to their effective capacities
  const activeCaps = activeSlots.map((s) => effectiveCap.get(s.Slot_Key)!);
  const distributedCounts = fairBalancedDistribute(totalStudents, activeCaps);

  let totalAssigned = 0;
  for (let i = 0; i < numActive; i++) {
    const slotKey = activeSlots[i].Slot_Key;
    const count = distributedCounts[i] || 0;
    assigned.set(slotKey, count);
    totalAssigned += count;
  }

  let surplus = Math.max(0, totalStudents - totalAssigned);

  if (surplus > 0) {
    // Attempt to absorb surplus into active slots with headroom first
    for (let i = 0; i < numActive && surplus > 0; i++) {
      const slotKey = activeSlots[i].Slot_Key;
      const current = assigned.get(slotKey) || 0;
      const cap = effectiveCap.get(slotKey) || 0;
      const headroom = Math.max(0, cap - current);
      if (headroom > 0) {
        const take = Math.min(surplus, headroom);
        assigned.set(slotKey, current + take);
        surplus -= take;
      }
    }

    // If surplus remains and is at least the minimum lab threshold (8), distribute into remaining slots
    if (surplus >= MIN_LAB_STUDENT_THRESHOLD) {
      const remainingSlots = slots.slice(numActive);
      if (remainingSlots.length > 0) {
        const remCaps = remainingSlots.map((s) => effectiveCap.get(s.Slot_Key)!);
        const remDistributed = fairBalancedDistribute(surplus, remCaps);
        for (let i = 0; i < remainingSlots.length; i++) {
          const slotKey = remainingSlots[i].Slot_Key;
          const count = remDistributed[i] || 0;
          if (count >= MIN_LAB_STUDENT_THRESHOLD || count === surplus) {
            assigned.set(slotKey, (assigned.get(slotKey) || 0) + count);
            surplus -= count;
          }
        }
      }
    }
    // If surplus < MIN_LAB_STUDENT_THRESHOLD, do not open a new near-empty lab session;
    // leave as leftover to be surfaced for ops review and special overfill resolution.
  }

  return { assigned, leftover: Math.max(0, surplus) };
}

function overfillCapForSlot(
  labId: string,
  area: string,
  grade: number,
  overfillRules: AllocationPreferences["overfillRules"],
): number {
  let allowance = 0;
  const targetArea = String(area ?? "").trim().toLowerCase();
  const targetLab = String(labId ?? "").trim().toLowerCase();
  const targetGrade = Number(grade);

  for (const rule of overfillRules ?? []) {
    const rArea = String(rule.area ?? "").trim().toLowerCase();
    if (rArea === "all" || rArea === targetArea) {
      const rawGrades = Array.isArray(rule.grades)
        ? rule.grades
        : typeof rule.grades === "string"
        ? (rule.grades as string).replace(/[{}[\]]/g, "").split(",").map((s) => s.trim())
        : typeof rule.grades === "number"
        ? [rule.grades]
        : [];
      const rGrades = rawGrades.map(Number).filter((n) => !isNaN(n));
      const matchesGrade = rGrades.length === 0 || rGrades.includes(targetGrade);
      if (matchesGrade) {
        const rawLabs = Array.isArray(rule.labIds)
          ? rule.labIds
          : typeof rule.labIds === "string"
          ? [rule.labIds]
          : [];
        const rLabs = rawLabs.map((x) => String(x).trim().toLowerCase());
        if (rLabs.length === 0 || rLabs.includes("all") || rLabs.includes(targetLab)) {
          allowance = Math.max(allowance, Math.min(2, Number(rule.maxOverfillPerLab ?? 2)));
        }
      }
    }
  }
  return allowance;
}

/** Port of run_group_optimization. */
export function runGroupOptimization(
  students: StudentRow[],
  sessionsAugmented: AugmentedSession[],
  preferences?: Partial<AllocationPreferences> | null,
  batchGroupType: "single_session" | "multi_session" = "single_session",
): {
  assignmentPlan: Map<string, Map<string, number>>; // key `${area}__${grade}` -> Slot_Key -> count
  unassignedLog: Array<{ Area: string; Grade: number; Total_Students: number; Total_Capacity: number; Unassigned_Count: number }>;
} {
  const overfillRules = preferences?.overfillRules ?? [];

  const groupsKey = (area: string, grade: number) => `${area}__${grade}`;
  const studentsByGroup = new Map<string, StudentRow[]>();
  for (const s of students) {
    const key = groupsKey(s["Physical Area"], s.Grade);
    if (!studentsByGroup.has(key)) studentsByGroup.set(key, []);
    studentsByGroup.get(key)!.push(s);
  }

  const sessionsByGroup = new Map<string, AugmentedSession[]>();
  for (const s of sessionsAugmented) {
    const key = groupsKey(s.Area, s.Grade);
    if (!sessionsByGroup.has(key)) sessionsByGroup.set(key, []);
    sessionsByGroup.get(key)!.push(s);
  }

  const assignmentPlan = new Map<string, Map<string, number>>();
  const unassignedLog: Array<{ Area: string; Grade: number; Total_Students: number; Total_Capacity: number; Unassigned_Count: number }> = [];

  for (const [key, studentsSub] of studentsByGroup) {
    const [area, gradeStr] = key.split("__");
    const grade = Number(gradeStr);
    const totalStudents = studentsSub.length;
    const slotsGroup = sessionsByGroup.get(key) ?? [];

    const slotOverfillCaps: Record<string, number> = {};
    if (overfillRules.length > 0) {
      for (const r of slotsGroup) {
        slotOverfillCaps[r.Slot_Key] = overfillCapForSlot(r["Lab ID"], area, grade, overfillRules);
      }
    }

    const { assigned, leftover } = batchGroupType === "single_session"
      ? capacityFirstDistribute(totalStudents, slotsGroup, slotOverfillCaps)
      : balancedDistribute(totalStudents, slotsGroup, slotOverfillCaps);
    assignmentPlan.set(key, assigned);
    if (leftover > 0) {
      const totalCapacity = slotsGroup.reduce((acc, s) => acc + s.True_Capacity, 0);
      unassignedLog.push({ Area: area, Grade: grade, Total_Students: totalStudents, Total_Capacity: totalCapacity, Unassigned_Count: leftover });
    }
  }

  return { assignmentPlan, unassignedLog };
}
