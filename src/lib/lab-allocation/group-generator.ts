import { cleanArabicString } from "@/lib/arabic";
import type { Student, StudentGroup } from "./types";

const AREA_SHORT_CODES: Record<string, string> = {
  "15 مايو": "15M",
  "6 أكتوبر": "OCT",
  "أكتوبر": "OCT",
  "أسوان": "ASW",
  "أسيوط": "ASY",
  "أشمون": "ASH",
  "أول المنتزة": "MN1",
  "إدفو": "EDF",
  "إمبابة": "EMB",
  "ابنوب": "ABN",
  "أبنوب": "ABN",
  "ابوتيج": "ABT",
  "أبو تيج": "ABT",
  "الخارجة": "KHA",
  "الداخلة": "DAK",
  "الدقي": "DOK",
  "الزقازيق": "ZAG",
  "السادات": "SAD",
  "السلام": "SLM",
  "الشروق": "SHR",
  "الشهداء": "SHD",
  "الشيخ زايد": "ZAY",
  "الطور": "TOR",
  "العاشر من رمضان": "10R",
  "العامرية": "AMR",
  "العباسية": "ABS",
  "العبور": "OBR",
  "العريش": "ARI",
  "العمرانية": "OMR",
  "الغردقة": "HRG",
  "المحلة الكبرى": "MAH",
  "المعادي": "MAA",
  "المنتزة ثان": "MN2",
  "المنصورة": "MAN",
  "المنيب": "MNB",
  "المنيا": "MIN",
  "الهرم": "HRM",
  "برج العرب": "BOR",
  "بركة السبع": "BRK",
  "بلبيس": "BLB",
  "بنها": "BNH",
  "بنى سويف": "BNS",
  "بني سويف": "BNS",
  "بورفؤاد": "BFD",
  "بورسعيد": "PSD",
  "بوش": "BSH",
  "حدائق الأهرام": "HRA",
  "حدائق القبة": "HQB",
  "حلوان": "HLW",
  "حي شرق": "SHQ",
  "حي وسط": "WST",
  "دسوق": "DSQ",
  "دمنهور": "DMH",
  "دمياط": "DAM",
  "ديروط": "DRT",
  "سمنود": "SAM",
  "سنورس": "SNR",
  "شبرا": "SHB",
  "شبرا الخيمة": "SHK",
  "شبراخيت": "SBX",
  "شبين الكوم": "SBK",
  "شبين القناطر": "SBP",
  "شرم الشيخ": "SSH",
  "سوهاج": "SHG",
  "طنطا": "TNT",
  "طهطا": "THT",
  "عجمي": "AJM",
  "فارسكور": "FAR",
  "فاقوس": "FAQ",
  "فايد": "FYD",
  "فيصل": "FSL",
  "قنا": "QNA",
  "قوص": "QOS",
  "قويسنا": "QWS",
  "كفر الشيخ": "KFS",
  "مدينة نصر": "NAS",
  "مرسى مطروح": "MAT",
  "مصر الجديدة": "HEL",
  "ملوي": "MLW",
  "منفلوط": "MNF",
  "ميت غمر": "MIT",
  "نجع حمادي": "NAG",
  "وسط البلد": "WBD",
  "الإسماعيلية": "ISM",
  "السويس": "SUZ",
  "الفيوم": "FAY",
  "الأقصر": "LUX",
  "القاهرة": "CA",
  "Cairo": "CA",
  "الجيزة": "GZ",
  "Giza": "GZ",
  "الإسكندرية": "ALX",
  "Alexandria": "ALX",
};

export function getAreaShortCode(area: string): string {
  const norm = cleanArabicString(area);
  for (const [a, code] of Object.entries(AREA_SHORT_CODES)) {
    if (cleanArabicString(a) === norm) return code;
  }

  const clean = area.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length >= 2) return clean.slice(0, 3);

  // Hash-based 3-letter code for unknown Arabic names
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash << 5) - hash + norm.charCodeAt(i);
    hash |= 0;
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const absHash = Math.abs(hash);
  return (
    letters[absHash % 26] +
    letters[Math.floor(absHash / 26) % 26] +
    letters[Math.floor(absHash / (26 * 26)) % 26]
  );
}

function generateGroupsByAreaAndGrade(
  students: Student[],
  safeCapacity: number,
): StudentGroup[] {
  // Group students by Area + Grade
  const pools = new Map<string, { area: string; grade: string; students: Student[] }>();

  students.forEach((student) => {
    const key = `${student.physicalArea}__${student.grade}`;
    if (!pools.has(key)) {
      pools.set(key, {
        area: student.physicalArea,
        grade: student.grade,
        students: [],
      });
    }
    pools.get(key)!.students.push(student);
  });

  const groups: StudentGroup[] = [];

  // Sort pools by area and grade for deterministic order
  const sortedPoolKeys = Array.from(pools.keys()).sort((a, b) => a.localeCompare(b));

  sortedPoolKeys.forEach((poolKey) => {
    const pool = pools.get(poolKey)!;
    const poolStudents = pool.students;
    const totalCount = poolStudents.length;
    const areaCode = getAreaShortCode(pool.area);
    const gradeCode = pool.grade;

    const numGroups = Math.ceil(totalCount / safeCapacity);

    for (let gIndex = 0; gIndex < numGroups; gIndex++) {
      const startIndex = gIndex * safeCapacity;
      const endIndex = Math.min(startIndex + safeCapacity, totalCount);
      const groupStudents = poolStudents.slice(startIndex, endIndex);
      const groupNumberStr = String(gIndex + 1).padStart(2, "0");
      const groupCode = `${areaCode}-${gradeCode}-${groupNumberStr}`;
      const groupId = `group-${pool.area}-${pool.grade}-${groupNumberStr}`;

      groups.push({
        id: groupId,
        groupCode,
        area: pool.area,
        grade: pool.grade,
        studentCount: groupStudents.length,
        studentIds: groupStudents.map((s) => s.sId),
        students: groupStudents,
      });
    }
  });

  return groups;
}

export function generateGroups(
  students: Student[],
  groupCapacity = 20,
): StudentGroup[] {
  const safeCapacity = Math.max(1, groupCapacity);

  // Check if any students have pre-assigned group IDs (e.g. from ops sheet Physical-DS-G31)
  const hasPreAssignedGroups = students.some((s) => Boolean(s.groupId));

  if (hasPreAssignedGroups) {
    const groupMap = new Map<string, { area: string; grade: string; students: Student[] }>();
    const unassignedStudents: Student[] = [];

    students.forEach((student) => {
      if (student.groupId) {
        if (!groupMap.has(student.groupId)) {
          groupMap.set(student.groupId, {
            area: student.physicalArea,
            grade: student.grade,
            students: [],
          });
        }
        groupMap.get(student.groupId)!.students.push(student);
      } else {
        unassignedStudents.push(student);
      }
    });

    const groups: StudentGroup[] = [];

    // Preserve pre-assigned groups, chunking if they exceed safeCapacity
    Array.from(groupMap.entries()).forEach(([groupId, info]) => {
      if (info.students.length <= safeCapacity) {
        groups.push({
          id: `group-${groupId}`,
          groupCode: groupId,
          area: info.area,
          grade: info.grade,
          studentCount: info.students.length,
          studentIds: info.students.map((s) => s.sId),
          students: info.students,
        });
      } else {
        const numSub = Math.ceil(info.students.length / safeCapacity);
        for (let i = 0; i < numSub; i++) {
          const chunk = info.students.slice(i * safeCapacity, (i + 1) * safeCapacity);
          const suffix = numSub > 1 ? `-${String(i + 1).padStart(2, "0")}` : "";
          groups.push({
            id: `group-${groupId}${suffix}`,
            groupCode: `${groupId}${suffix}`,
            area: info.area,
            grade: info.grade,
            studentCount: chunk.length,
            studentIds: chunk.map((s) => s.sId),
            students: chunk,
          });
        }
      }
    });

    // Partition remaining unassigned students by Area + Grade
    if (unassignedStudents.length > 0) {
      const generated = generateGroupsByAreaAndGrade(unassignedStudents, safeCapacity);
      groups.push(...generated);
    }

    return groups;
  }

  return generateGroupsByAreaAndGrade(students, safeCapacity);
}
