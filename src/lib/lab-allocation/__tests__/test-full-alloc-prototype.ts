import fs from "fs";
import * as XLSX from "xlsx";

// 1. Clean Arabic normalization
export function cleanArabicString(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim().replace(/\s+/g, " ");
  // Strip diacritics / tashkeel
  str = str.replace(/[ً-ْٰـ]/g, "");
  // Normalize alefs
  str = str.replace(/[أإآ]/g, "ا");
  // Normalize yaa
  str = str.replace(/ى/g, "ي");
  // Normalize teh marbuta
  str = str.replace(/ة/g, "ه");
  return str.trim();
}

export function normalizeAreaCanonical(val: unknown): string {
  const cleaned = cleanArabicString(val);
  if (!cleaned) return "";

  const lower = String(val).trim().toLowerCase();
  if (lower === "cairo" || cleaned.includes("قاهر")) return "القاهرة";
  if (lower === "giza" || cleaned.includes("جيز")) return "الجيزة";
  if (lower === "alexandria" || lower === "alex" || cleaned.includes("اسكندر")) return "الإسكندرية";
  if (lower === "dakahlia" || cleaned.includes("دقهلي")) return "الدقهلية";
  if (lower === "qalyubia" || cleaned.includes("قليوب")) return "القليوبية";
  if (lower === "sharqia" || lower === "al sharqia" || cleaned.includes("شرقي")) return "الشرقية";
  if (lower === "gharbia" || lower === "gharbiyya" || cleaned.includes("غربي")) return "الغربية";
  if (lower === "monufia" || cleaned.includes("منوفي")) return "المنوفية";
  if (lower === "beheira" || cleaned.includes("بحير")) return "البحيرة";
  if (lower.includes("kafr") || cleaned.includes("كفر الشيخ")) return "كفر الشيخ";
  if (lower === "damietta" || cleaned.includes("دمياط")) return "دمياط";
  if (lower === "port said" || cleaned.includes("بورسعيد")) return "بورسعيد";
  if (lower === "ismailia" || cleaned.includes("اسماعيلي")) return "الإسماعيلية";
  if (lower === "suez" || cleaned.includes("سويس")) return "السويس";
  if (lower === "fayoum" || lower === "faiyum" || cleaned.includes("فيوم")) return "الفيوم";
  if (lower === "beni suef" || cleaned.includes("بني سويف") || cleaned.includes("بنى سويف")) return "بني سويف";
  if (lower === "minya" || cleaned.includes("منيا")) return "المنيا";
  if (lower === "asyut" || lower === "assiut" || cleaned.includes("اسيوط")) return "أسيوط";
  if (lower === "sohag" || cleaned.includes("سوهاج")) return "سوهاج";
  if (lower === "qena" || cleaned.includes("قنا")) return "قنا";
  if (lower === "luxor" || cleaned.includes("اقصر") || cleaned.includes("الأقصر")) return "الأقصر";
  if (lower === "aswan" || cleaned.includes("اسوان")) return "أسوان";
  if (lower === "red sea" || cleaned.includes("بحر احمر") || cleaned.includes("البحر الاحمر")) return "البحر الأحمر";
  if (lower === "new valley" || cleaned.includes("وادي جديد") || cleaned.includes("الوادي الجديد")) return "الوادي الجديد";
  if (lower === "matrouh" || cleaned.includes("مطروح")) return "مطروح";
  if (lower === "north sinai" || cleaned.includes("شمال سيناء")) return "شمال سيناء";
  if (lower === "south sinai" || cleaned.includes("جنوب سيناء")) return "جنوب سيناء";

  return String(val).trim().replace(/\s+/g, " ");
}

export const AREA_TO_GOV_MAP: Record<string, string> = {
  "15 مايو": "القاهرة", "السلام": "القاهرة", "الشروق": "القاهرة", "العباسية": "القاهرة",
  "القاهرة": "القاهرة", "القاهرة الجديدة": "القاهرة", "المعادي": "القاهرة", "حدائق القبة": "القاهرة",
  "حلوان": "القاهرة", "شبرا": "القاهرة", "مدينة نصر": "القاهرة", "مصر الجديدة": "القاهرة",
  "وسط البلد": "القاهرة", "التجمع الخامس": "القاهرة", "التجمع": "القاهرة",

  "6 أكتوبر": "الجيزة", "أكتوبر": "الجيزة", "إمبابة": "الجيزة", "الجيزة": "الجيزة",
  "الدقي": "الجيزة", "الشيخ زايد": "الجيزة", "العمرانية": "الجيزة", "المنيب": "الجيزة",
  "الهرم": "الجيزة", "حدائق الأهرام": "الجيزة", "فيصل": "الجيزة",

  "أول المنتزة": "الإسكندرية", "المنتزة أول": "الإسكندرية", "المنتزة ثان": "الإسكندرية",
  "الإسكندرية": "الإسكندرية", "العامرية": "الإسكندرية", "برج العرب": "الإسكندرية",
  "حي شرق": "الإسكندرية", "حي وسط": "الإسكندرية", "عجمي": "الإسكندرية", "العجمي": "الإسكندرية",

  "العبور": "القليوبية", "بنها": "القليوبية", "شبرا الخيمة": "القليوبية",
  "شبين القناطر": "القليوبية", "قليوب": "القليوبية", "القليوبية": "القليوبية",

  "الزقازيق": "الشرقية", "العاشر من رمضان": "الشرقية", "بلبيس": "الشرقية",
  "فاقوس": "الشرقية", "الشرقية": "الشرقية",

  "المنصورة": "الدقهلية", "ميت غمر": "الدقهلية", "الدقهلية": "الدقهلية",

  "المحلة الكبرى": "الغربية", "سمنود": "الغربية", "طنطا": "الغربية", "الغربية": "الغربية",

  "أشمون": "المنوفية", "السادات": "المنوفية", "الشهداء": "المنوفية",
  "بركة السبع": "المنوفية", "شبين الكوم": "المنوفية", "قويسنا": "المنوفية", "المنوفية": "المنوفية",

  "دمنهور": "البحيرة", "شبراخيت": "البحيرة", "البحيرة": "البحيرة",

  "دسوق": "كفر الشيخ", "كفر الشيخ": "كفر الشيخ",

  "دمياط": "دمياط", "دمياط الجديدة": "دمياط", "فارسكور": "دمياط",

  "بورسعيد": "بورسعيد", "بورفؤاد": "بورسعيد",

  "الإسماعيلية": "الإسماعيلية", "فايد": "الإسماعيلية",

  "السويس": "السويس",

  "الفيوم": "الفيوم", "سنورس": "الفيوم",

  "بنى سويف": "بني سويف", "بني سويف": "بني سويف", "بوش": "بني سويف",

  "المنيا": "المنيا", "ملوي": "المنيا",

  "أسيوط": "أسيوط", "ابنوب": "أسيوط", "أبنوب": "أسيوط", "ابوتيج": "أسيوط",
  "أبو تيج": "أسيوط", "ديروط": "أسيوط", "منفلوط": "أسيوط",

  "سوهاج": "سوهاج", "طهطا": "سوهاج",

  "قنا": "قنا", "قوص": "قنا", "نجع حمادي": "قنا",

  "الأقصر": "الأقصر", "اقصر": "الأقصر",

  "أسوان": "أسوان", "إدفو": "أسوان", "ادفو": "أسوان",

  "الغردقة": "البحر الأحمر", "البحر الأحمر": "البحر الأحمر",

  "الخارجة": "الوادي الجديد", "الداخلة": "الوادي الجديد", "الوادي الجديد": "الوادي الجديد",

  "مرسى مطروح": "مطروح", "مطروح": "مطروح",

  "العريش": "شمال سيناء", "شمال سيناء": "شمال سيناء",

  "الطور": "جنوب سيناء", "شرم الشيخ": "جنوب سيناء", "جنوب سيناء": "جنوب سيناء"
};

export function getGovForArea(area: string): string {
  const norm = cleanArabicString(area);
  for (const [a, g] of Object.entries(AREA_TO_GOV_MAP)) {
    if (cleanArabicString(a) === norm) return g;
  }
  return area;
}

// Time Slots
const STANDARD_SLOTS = [
  { key: "Thu 9 AM", day: "Thursday", time: "9:00 AM", gradeKey: "Thu 9 AM Grade" },
  { key: "Thu 12 PM", day: "Thursday", time: "12:00 PM", gradeKey: "Thu 12 PM Grade" },
  { key: "Thu 3 PM", day: "Thursday", time: "3:00 PM", gradeKey: "Thu 3 PM Grade" },
  { key: "Thu 6 PM", day: "Thursday", time: "6:00 PM", gradeKey: "Thu 6 PM Grade" },
  { key: "Fri 9 AM", day: "Friday", time: "9:00 AM", gradeKey: "Fri 9 AM Grade" },
  { key: "Fri 3 PM", day: "Friday", time: "3:00 PM", gradeKey: "Fri 3 PM Grade" },
  { key: "Fri 6 PM", day: "Friday", time: "6:00 PM", gradeKey: "Fri 6 PM Grade" },
];

type LabSlot = {
  slotKey: string;
  targetGrade: string | null;
  scheduledGroupCode: string | null;
  assignedStudents: any[];
  isAvailable: boolean;
};

type ParsedLab = {
  id: string;
  labCode: string;
  name: string;
  gov: string;
  area: string;
  capacity: number;
  vendorName: string;
  centerName: string;
  address: string;
  locationUrl: string;
  supervisorName: string;
  supervisorPhone: string;
  facilitatorName: string;
  facilitatorPhone: string;
  slots: Map<string, LabSlot>;
};

// Load Lab CSV
const labCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Operations_Dashboard.csv", "utf-8");
const labWb = XLSX.read(labCsv, { type: "string" });
const labRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(labWb.Sheets[labWb.SheetNames[0]], { defval: "" });

const labs: ParsedLab[] = [];

labRows.forEach((row, idx) => {
  const findVal = (aliases: string[]) => {
    for (const k of Object.keys(row)) {
      const cleanKey = k.trim().toLowerCase();
      if (aliases.some(a => a.toLowerCase() === cleanKey)) {
        return String(row[k] || "").trim();
      }
    }
    return "";
  };

  const labCode = findVal(["Lab ID", "Lab Code", "lab_code", "كود المعمل"]);
  const labName = findVal(["Lab Name", "lab_name", "اسم المعمل"]) || labCode;
  const rawGov = findVal(["Gov", "Governorate", "المحافظة"]);
  const rawArea = findVal(["Area", "area", "المنطقة", "المدينة", "City"]) || rawGov;
  const gov = normalizeAreaCanonical(rawGov);
  const area = normalizeAreaCanonical(rawArea);
  const rawCap = Number(findVal(["Lab Capacity", "Capacity"])) || 20;
  const capacity = rawCap > 0 ? rawCap : 20;

  if (!labCode && !labName) return;

  const slots = new Map<string, LabSlot>();

  STANDARD_SLOTS.forEach(slotDef => {
    const rawGrade = findVal([slotDef.gradeKey, `${slotDef.key} Grade`]);
    let targetGrade: string | null = null;
    if (rawGrade) {
      const m = rawGrade.match(/\b([4-6])\b/) || rawGrade.match(/G([4-6])/i);
      if (m) targetGrade = `G${m[1]}`;
    }

    const rawGrp = findVal([slotDef.key]);
    const scheduledGroupCode = rawGrp && rawGrp !== "-" && rawGrp !== "0" ? rawGrp.trim() : null;

    slots.set(slotDef.key, {
      slotKey: slotDef.key,
      targetGrade,
      scheduledGroupCode,
      assignedStudents: [],
      isAvailable: Boolean(targetGrade || scheduledGroupCode),
    });
  });

  labs.push({
    id: `lab-${idx + 1}-${labCode}`,
    labCode,
    name: labName,
    gov,
    area,
    capacity,
    vendorName: findVal(["Vendor Name", "Vendor"]),
    centerName: findVal(["Center Name", "Center"]),
    address: findVal(["Address"]),
    locationUrl: findVal(["Location", "Maps"]),
    supervisorName: findVal(["اسم المشرف", "Supervisor"]),
    supervisorPhone: findVal(["رقم المشرف"]),
    facilitatorName: findVal(["اسم الميسر", "Facilitator"]),
    facilitatorPhone: findVal(["رقم الميسر"]),
    slots,
  });
});

console.log(`Parsed ${labs.length} labs.`);

// Load Students CSV
const studentCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Full_Students.csv", "utf-8");
const studentWb = XLSX.read(studentCsv, { type: "string" });
const studentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(studentWb.Sheets[studentWb.SheetNames[0]], { defval: "" });

type StudentItem = {
  sId: string;
  grade: string;
  physicalArea: string;
  gov: string;
  preAssignedGroupId?: string;
  rowNumber: number;
};

const students: StudentItem[] = [];

studentRows.forEach((row, idx) => {
  const sId = String(row["{{S_ID}}"] || row["student : {{S_ID}}"] || row["S_ID"] || "").trim();
  const rawGrade = String(row["Grade(25-26)"] || row["Grade"] || "").trim();
  const rawArea = String(row["Physical Area"] || row["Area"] || "").trim();
  const preGrp = String(row["Group ID"] || "").trim();

  let grade = "G4";
  const gm = rawGrade.match(/\b([4-6])\b/) || rawGrade.match(/G([4-6])/i);
  if (gm) grade = `G${gm[1]}`;

  const physicalArea = normalizeAreaCanonical(rawArea);
  const gov = getGovForArea(physicalArea);

  if (sId) {
    students.push({
      sId,
      grade,
      physicalArea,
      gov,
      preAssignedGroupId: preGrp || undefined,
      rowNumber: idx + 2,
    });
  }
});

console.log(`Parsed ${students.length} students.`);

// NOW: Run Allocation Engine
// 1. Group students by Area + Grade
const poolMap = new Map<string, StudentItem[]>();
students.forEach(s => {
  const key = `${cleanArabicString(s.physicalArea)}__${s.grade}`;
  if (!poolMap.has(key)) poolMap.set(key, []);
  poolMap.get(key)!.push(s);
});

console.log(`Unique Area+Grade pools: ${poolMap.size}`);

const allocatedStudents: any[] = [];
const unallocatedStudents: any[] = [];

// For each pool, allocate into matching lab slots
for (const [poolKey, poolStudents] of poolMap.entries()) {
  const areaName = poolStudents[0].physicalArea;
  const gradeName = poolStudents[0].grade;
  const govName = poolStudents[0].gov;

  const areaNorm = cleanArabicString(areaName);
  const govNorm = cleanArabicString(govName);

  // Find candidate slots in area matching grade
  const findSlots = (strictArea: boolean) => {
    const list: { lab: ParsedLab; slot: LabSlot }[] = [];
    for (const lab of labs) {
      const labAreaNorm = cleanArabicString(lab.area);
      const labGovNorm = cleanArabicString(lab.gov);

      const areaMatches = strictArea ? (labAreaNorm === areaNorm) : (labGovNorm === govNorm || labAreaNorm === areaNorm);
      if (!areaMatches) continue;

      for (const slot of lab.slots.values()) {
        if (!slot.isAvailable) continue;
        // Check grade match
        if (slot.targetGrade === gradeName || (!slot.targetGrade && slot.scheduledGroupCode)) {
          list.push({ lab, slot });
        }
      }
    }
    return list;
  };

  let candidateSlots = findSlots(true);
  if (candidateSlots.length === 0) {
    // Try governorate fallback
    candidateSlots = findSlots(false);
  }

  let remaining = [...poolStudents];

  for (const { lab, slot } of candidateSlots) {
    if (remaining.length === 0) break;
    const currentCount = slot.assignedStudents.length;
    const availableSpace = lab.capacity - currentCount;
    if (availableSpace <= 0) continue;

    const toTake = remaining.slice(0, availableSpace);
    remaining = remaining.slice(availableSpace);

    toTake.forEach(st => {
      slot.assignedStudents.push(st);
      allocatedStudents.push({
        sId: st.sId,
        grade: st.grade,
        area: st.physicalArea,
        gov: st.gov,
        labCode: lab.labCode,
        labName: lab.name,
        centerName: lab.centerName,
        slotKey: slot.slotKey,
        groupCode: slot.scheduledGroupCode || `${st.physicalArea}-${st.grade}-G1`,
      });
    });
  }

  if (remaining.length > 0) {
    // If still remaining, try ANY open slot in area/gov
    console.warn(`Unallocated ${remaining.length} students in ${areaName} (${gradeName})`);
    remaining.forEach(st => {
      unallocatedStudents.push({
        sId: st.sId,
        grade: st.grade,
        area: st.physicalArea,
        gov: st.gov,
        reason: `No remaining slots in ${areaName} for ${gradeName}`,
      });
    });
  }
}

console.log("\n=== ALLOCATION TEST RESULTS ===");
console.log(`Total students: ${students.length}`);
console.log(`Allocated: ${allocatedStudents.length} (${((allocatedStudents.length / students.length) * 100).toFixed(2)}%)`);
console.log(`Unallocated: ${unallocatedStudents.length}`);
if (unallocatedStudents.length > 0) {
  console.log("Unallocated sample:", unallocatedStudents.slice(0, 10));
}
