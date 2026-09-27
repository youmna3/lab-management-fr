import { fixMojibake } from "@/lib/sheet";
import { getGovForArea } from "@/lib/arabic";
import { normalizePhysicalArea, normalizeGrade } from "./student-importer";
import {
  type AllocationLab,
  type LabSlotState,
  STANDARD_TIME_SLOTS,
} from "./types";
import type { Tables } from "@/integrations/supabase/types";

type DbLab = Tables<"labs">;

export function normalizeLabFromDb(
  dbLab: DbLab,
  configuredSlots = STANDARD_TIME_SLOTS.map((s) => s.key),
): AllocationLab {
  const slots = new Map<string, LabSlotState>();

  STANDARD_TIME_SLOTS.forEach((slotDef) => {
    if (!configuredSlots.includes(slotDef.key)) return;
    slots.set(slotDef.key, {
      slotKey: slotDef.key,
      day: slotDef.day,
      time: slotDef.time,
      targetGrade: null,
      isOccupied: false,
      assignedGroupId: null,
      assignedGroupCode: null,
    });
  });

  const area = normalizePhysicalArea(dbLab.area || dbLab.city || dbLab.gov || "");
  const gov = normalizePhysicalArea(dbLab.gov || "") || getGovForArea(area);

  return {
    id: dbLab.id,
    labCode: dbLab.lab_code || dbLab.id,
    name: dbLab.name || dbLab.lab_code || "Unnamed Lab",
    gov: gov || area,
    area: area || gov,
    capacity: Number(dbLab.capacity) > 0 ? Number(dbLab.capacity) : 20,
    vendorName: dbLab.vendor_name,
    centerName: dbLab.center_name,
    address: dbLab.address || dbLab.location_address,
    locationUrl: dbLab.maps_url,
    supervisorName: dbLab.supervisor_name,
    supervisorPhone: dbLab.supervisor_phone,
    facilitatorName: dbLab.facilitator_name,
    facilitatorPhone: dbLab.facilitator_phone,
    slots,
  };
}

export function parseLabsFromSheet(
  rows: Record<string, unknown>[],
  configuredSlots = STANDARD_TIME_SLOTS.map((s) => s.key),
): AllocationLab[] {
  const labs: AllocationLab[] = [];

  rows.forEach((row, index) => {
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
    const area = normalizePhysicalArea(rawArea);
    const gov = normalizePhysicalArea(rawGov) || getGovForArea(area);
    const rawCapacity = findVal(["Lab Capacity", "Capacity", "capacity", "السعة"]);
    const capacityNum = Number(rawCapacity);
    const capacity = !Number.isNaN(capacityNum) && capacityNum > 0 ? capacityNum : 20;

    if (!labCode && !labName) return; // Skip non-lab rows

    const slots = new Map<string, LabSlotState>();

    STANDARD_TIME_SLOTS.forEach((slotDef) => {
      if (!configuredSlots.includes(slotDef.key)) return;

      // Check if slot has a grade restriction column, e.g. "Thu 9 AM Grade"
      const rawSlotGrade = findVal([
        slotDef.gradeKey,
        `${slotDef.key} Grade`,
        `${slotDef.key}_Grade`,
        `${slotDef.day} ${slotDef.time} Grade`,
      ]);
      let targetGrade = rawSlotGrade ? normalizeGrade(rawSlotGrade) : null;

      // Check if slot has a scheduled group code e.g. "Physical-DS-G1"
      const rawSlotValue = findVal([slotDef.key, `${slotDef.day} ${slotDef.time}`]);
      const hasGroupCode = Boolean(rawSlotValue && rawSlotValue !== "-" && rawSlotValue !== "0");

      if (hasGroupCode && !targetGrade && rawSlotValue) {
        const gradeMatch = rawSlotValue.match(/\b(G[4-6])\b/i);
        if (gradeMatch) {
          targetGrade = gradeMatch[1].toUpperCase();
        }
      }

      slots.set(slotDef.key, {
        slotKey: slotDef.key,
        day: slotDef.day,
        time: slotDef.time,
        targetGrade,
        isOccupied: false,
        assignedGroupId: null,
        assignedGroupCode: hasGroupCode && rawSlotValue ? rawSlotValue.trim() : null,
      });
    });

    labs.push({
      id: `sheet-lab-${index + 1}-${labCode || index}`,
      labCode: labCode || `LAB-${index + 1}`,
      name: labName || `Lab ${index + 1}`,
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
    });
  });

  return labs;
}
