import { fixMojibake } from "@/lib/sheet";
import { normalizeGrade, normalizePhysicalArea } from "./student-importer";
import {
  type AllocationConfig,
  type AllocationLab,
  type AllocationResult,
  type GroupAllocation,
  type LabSlotState,
  type Student,
  type StudentGroup,
  DEFAULT_ALLOCATION_CONFIG,
  STANDARD_TIME_SLOTS,
} from "./types";

export function isMasterLabScheduleSheet(rows: Record<string, unknown>[]): boolean {
  if (!rows || rows.length === 0) return false;
  const keys = Object.keys(rows[0] || {}).map((k) => k.trim().toLowerCase());
  const hasLabId = keys.some((k) => k.includes("lab id") || k.includes("lab_id") || k.includes("lab code") || k.includes("كود المعمل"));
  const hasGovOrArea = keys.some((k) => k.includes("gov") || k.includes("area") || k.includes("المحافظة") || k.includes("المنطقة"));
  const hasCapacityOrSlots = keys.some((k) => k.includes("capacity") || k.includes("thu 9 am") || k.includes("fri 9 am") || k.includes("المشرف"));

  return (hasLabId && hasGovOrArea) || (hasCapacityOrSlots && hasLabId);
}

export type MasterSheetParseResult = {
  labs: AllocationLab[];
  groups: StudentGroup[];
  allocations: GroupAllocation[];
  students: Student[];
  result: AllocationResult;
  totalLabs: number;
  totalGroups: number;
  totalSlotsOccupied: number;
};

export function parseMasterLabScheduleSheet(
  rows: Record<string, unknown>[],
  config: AllocationConfig = DEFAULT_ALLOCATION_CONFIG,
): MasterSheetParseResult {
  const labs: AllocationLab[] = [];
  let scheduledSlotsCount = 0;

  rows.forEach((row, rowIndex) => {
    const keys = Object.keys(row);
    if (!keys.length) return;

    const findVal = (candidateAliases: string[]): string => {
      for (const k of keys) {
        const cleanedKey = k.trim().toLowerCase();
        if (candidateAliases.some((alias) => alias.toLowerCase() === cleanedKey)) {
          const val = row[k];
          if (val !== null && val !== undefined && String(val).trim() !== "") {
            return fixMojibake(val).toString().trim();
          }
        }
      }
      return "";
    };

    const labCode = findVal(["Lab ID", "Lab Code", "lab_code", "ID", "كود المعمل", "كود"]);
    const labName = findVal(["Lab Name", "lab_name", "Name", "اسم المعمل", "المعمل"]) || labCode;
    const rawGov = findVal(["Gov", "Governorate", "gov", "المحافظة"]);
    const rawArea = findVal(["Area", "area", "المنطقة", "المدينة", "City"]) || rawGov;
    const gov = normalizePhysicalArea(rawGov);
    const area = normalizePhysicalArea(rawArea);
    const rawCapacity = findVal(["Lab Capacity", "Capacity", "capacity", "السعة"]);
    const capacityNum = Number(rawCapacity);
    const capacity = !Number.isNaN(capacityNum) && capacityNum > 0 ? capacityNum : 20;

    if (!labCode && !labName) return; // Skip empty rows

    const slots = new Map<string, LabSlotState>();

    // Build standard slots
    STANDARD_TIME_SLOTS.forEach((slotDef) => {
      // Slot Grade Restriction, e.g. "Thu 9 AM Grade"
      const rawSlotGrade = findVal([
        slotDef.gradeKey,
        `${slotDef.key} Grade`,
        `${slotDef.key}_Grade`,
        `${slotDef.day} ${slotDef.time} Grade`,
      ]);
      let targetGrade = rawSlotGrade ? normalizeGrade(rawSlotGrade) : null;

      // Slot Group Assignment, e.g. "Thu 9 AM" -> "Physical-DS-G6"
      const rawGroupCode = findVal([slotDef.key, `${slotDef.day} ${slotDef.time}`]);
      const hasGroupCode = Boolean(rawGroupCode && rawGroupCode !== "-" && rawGroupCode !== "0");

      if (hasGroupCode && !targetGrade) {
        const gradeMatch = rawGroupCode.match(/\b(G[4-6])\b/i);
        if (gradeMatch) {
          targetGrade = gradeMatch[1].toUpperCase();
        }
      }

      if (hasGroupCode || targetGrade) {
        scheduledSlotsCount += 1;
      }

      slots.set(slotDef.key, {
        slotKey: slotDef.key,
        day: slotDef.day,
        time: slotDef.time,
        targetGrade,
        isOccupied: false,
        assignedGroupId: null,
        assignedGroupCode: hasGroupCode ? rawGroupCode.trim() : null,
        assignedStudentCount: 0,
        assignedGrade: targetGrade || undefined,
      });
    });

    const labObj: AllocationLab = {
      id: `master-lab-${rowIndex + 1}-${labCode || rowIndex}`,
      labCode: labCode || `LAB-${rowIndex + 1}`,
      name: labName || `Lab ${rowIndex + 1}`,
      gov: gov || area,
      area: area || gov,
      capacity,
      vendorName: findVal(["Vendor Name", "Vendor", "vendor_name", "المورد"]),
      centerName: findVal(["Center Name", "center_name", "المركز"]),
      address: findVal(["Address", "address", "العنوان"]),
      locationUrl: findVal(["Location", "Maps", "maps_url", "الموقع"]),
      supervisorName: findVal(["اسم المشرف", "Supervisor", "Supervisor Name"]),
      supervisorPhone: findVal(["رقم المشرف", "Supervisor Phone"]),
      facilitatorName: findVal(["اسم الميسر", "Facilitator", "Facilitator Name"]),
      facilitatorPhone: findVal(["رقم الميسر", "Facilitator Phone"]),
      slots,
    };

    labs.push(labObj);
  });

  const extractedGroups: StudentGroup[] = [];
  const groupsSeen = new Set<string>();

  labs.forEach((lab) => {
    lab.slots.forEach((slot) => {
      if (slot.assignedGroupCode && !groupsSeen.has(slot.assignedGroupCode)) {
        groupsSeen.add(slot.assignedGroupCode);
        extractedGroups.push({
          id: `group-${slot.assignedGroupCode}`,
          groupCode: slot.assignedGroupCode,
          area: lab.area,
          grade: slot.targetGrade || slot.assignedGrade || "G4",
          studentCount: lab.capacity || 20,
          studentIds: [],
          students: [],
        });
      }
    });
  });

  const result: AllocationResult = {
    allocations: [],
    unallocatedGroups: [],
    allocatedStudents: [],
    unallocatedStudents: [],
    summary: [],
    issues: [],
    labs,
    stats: {
      totalStudents: 0,
      validStudents: 0,
      invalidStudents: 0,
      allocatedStudents: 0,
      unallocatedStudents: 0,
      totalGroups: extractedGroups.length,
      allocatedGroups: 0,
      unallocatedGroups: 0,
      totalLabsUsed: labs.length,
      totalSlotsUsed: scheduledSlotsCount,
      totalLabCapacity: labs.reduce(
        (acc, l) => acc + l.capacity * STANDARD_TIME_SLOTS.length,
        0,
      ),
      usedLabCapacity: 0,
      successRate: 0,
    },
    config,
    createdAt: new Date().toISOString(),
  };

  return {
    labs,
    groups: extractedGroups,
    allocations: [],
    students: [],
    result,
    totalLabs: labs.length,
    totalGroups: extractedGroups.length,
    totalSlotsOccupied: scheduledSlotsCount,
  };
}
