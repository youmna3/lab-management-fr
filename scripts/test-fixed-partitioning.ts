import fs from "fs";
import * as XLSX from "xlsx";
import type { MegaGroupDefinition } from "../src/lib/allocation-client";
import type { StudentRow } from "../src/lib/lab-allocation-runner/parse";

export function fixedPartitionGroupsEvenlyAcrossMegaGroups(
  students: StudentRow[],
  megaGroups: MegaGroupDefinition[],
  options?: {
    avgGroupSize?: number;
    prefix?: string;
  }
) {
  if (!megaGroups || megaGroups.length === 0 || !students || students.length === 0) {
    return {
      megaGroups: megaGroups || [],
      groupMembershipsByMg: new Map(),
    };
  }

  const avgGroupSize = options?.avgGroupSize && options.avgGroupSize > 0 ? options.avgGroupSize : 20;
  const prefix = options?.prefix || "Group";

  // Group mega groups into clusters that share the exact same grade and area criteria
  const clusters: Array<{
    mgs: MegaGroupDefinition[];
    grades: number[];
    areas: string[];
  }> = [];

  for (const mg of megaGroups) {
    const mgGrades = Array.isArray(mg.grades)
      ? mg.grades.map((g) => Number(String(g).replace(/\D/g, ""))).filter((n) => !isNaN(n)).sort((a, b) => a - b)
      : [];
    const mgAreas = Array.isArray(mg.areas)
      ? mg.areas.map((a) => a.trim().toLowerCase()).filter(Boolean).sort()
      : [];

    const clusterKey = `${mgGrades.join(",")}__${mgAreas.join(",")}`;
    let cluster = clusters.find((c) => `${c.grades.join(",")}__${c.areas.join(",")}` === clusterKey);
    if (!cluster) {
      cluster = { mgs: [], grades: mgGrades, areas: mgAreas };
      clusters.push(cluster);
    }
    cluster.mgs.push(mg);
  }

  const updatedMegaGroups: MegaGroupDefinition[] = [];
  const groupMembershipsByMg = new Map<string, Array<{
    groupId: string;
    shortGroupId: string;
    grade: number;
    physicalArea: string;
    studentCount: number;
    studentIds: string[];
    isExcluded: boolean;
  }>>();

  for (const mg of megaGroups) {
    groupMembershipsByMg.set(mg.name, []);
  }

  const assignedStudentIdSet = new Set<string>();

  for (const cluster of clusters) {
    const { mgs, grades, areas } = cluster;
    const N = mgs.length;

    // Filter students eligible for this cluster
    const eligibleStudents = students.filter((s) => {
      if (assignedStudentIdSet.has(s.S_ID)) return false;
      const sGrade = Number(s.Grade);
      const sArea = String(s["Physical Area"] || "").trim().toLowerCase();

      if (grades.length > 0 && !grades.includes(sGrade)) return false;
      if (areas.length > 0 && !areas.some((a) => sArea.includes(a) || a.includes(sArea))) return false;
      return true;
    });

    if (eligibleStudents.length === 0) {
      for (const mg of mgs) {
        updatedMegaGroups.push({
          ...mg,
          group_ids: mg.group_ids || [],
          student_ids: mg.student_ids || [],
        });
      }
      continue;
    }

    // Bucket eligible students by Area and Grade to form cohesive cohort groups
    const areaGradeBuckets = new Map<string, StudentRow[]>();
    for (const s of eligibleStudents) {
      const key = `${s["Physical Area"]}__${s.Grade}`;
      if (!areaGradeBuckets.has(key)) areaGradeBuckets.set(key, []);
      areaGradeBuckets.get(key)!.push(s);
    }

    const mgGroupsMap = new Map<number, Array<{
      groupId: string;
      shortGroupId: string;
      grade: number;
      physicalArea: string;
      studentCount: number;
      studentIds: string[];
      isExcluded: boolean;
    }>>();

    for (let i = 0; i < N; i++) {
      mgGroupsMap.set(i, []);
    }

    let groupCounter = 1;

    // Distribute groups within each area-grade bucket evenly across the N mega groups
    for (const [key, bucketStudents] of areaGradeBuckets.entries()) {
      const [area, gradeStr] = key.split("__");
      const grade = Number(gradeStr);

      const numGroups = Math.max(1, Math.ceil(bucketStudents.length / avgGroupSize));
      const baseGroupCap = Math.floor(bucketStudents.length / numGroups);
      const remStudents = bucketStudents.length % numGroups;

      let studentIdx = 0;
      for (let g = 0; g < numGroups; g++) {
        const size = g < remStudents ? baseGroupCap + 1 : baseGroupCap;
        const groupStudents = bucketStudents.slice(studentIdx, studentIdx + size);
        studentIdx += size;

        const groupId = `${prefix}-G${groupCounter}`;
        const groupObj = {
          groupId,
          shortGroupId: `G${groupCounter}`,
          grade,
          physicalArea: area,
          studentCount: groupStudents.length,
          studentIds: groupStudents.map((s) => s.S_ID),
          isExcluded: false,
        };

        // Assign to mega group in round-robin within this area bucket
        const targetMgIdx = g % N;
        mgGroupsMap.get(targetMgIdx)!.push(groupObj);

        groupCounter += 1;
      }
    }

    // Populate updated mega groups
    for (let i = 0; i < N; i++) {
      const mg = mgs[i];
      const assignedGroups = mgGroupsMap.get(i) || [];

      const mgStudentIds: string[] = [];
      const mgGroupIds: string[] = [];

      for (const g of assignedGroups) {
        mgGroupIds.push(g.groupId);
        for (const sId of g.studentIds) {
          mgStudentIds.push(sId);
          assignedStudentIdSet.add(sId);
        }
      }

      const updatedMg: MegaGroupDefinition = {
        ...mg,
        group_ids: mgGroupIds,
        student_ids: mgStudentIds,
      };

      updatedMegaGroups.push(updatedMg);
      groupMembershipsByMg.get(mg.name)!.push(...assignedGroups);
    }
  }

  return {
    megaGroups: updatedMegaGroups,
    groupMembershipsByMg,
  };
}

async function main() {
  const labPath = "public/sample-files/egypt_labs_benchmark.xlsx";
  const studentPath = fs.existsSync("scratch/user_egypt_students.xlsx")
    ? "scratch/user_egypt_students.xlsx"
    : "public/sample-files/egypt_students_benchmark.xlsx";

  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  const sBuf = fs.readFileSync(studentPath);
  const sWb = XLSX.read(sBuf, { type: "buffer" });
  let rawStudents: any[] = XLSX.utils.sheet_to_json(sWb.Sheets[sWb.SheetNames[0]]);

  let students = rawStudents.map((s: any, idx: number) => ({
    S_ID: String(s.S_ID || s["Student ID"] || `STU-${idx}`),
    Grade: Number(String(s.Grade || s.grade || "").replace(/\D/g, "")) || 4,
    "Physical Area": String(s["Physical Area"] || s.Area || s.area || "Unknown").trim(),
  }));

  const megaGroups: MegaGroupDefinition[] = [
    {
      id: "mg-1",
      name: "Mega Group A",
      grades: [4, 5, 6],
      areas: [],
      start_day: "13 Sept",
      end_day: "17 Sept",
    },
    {
      id: "mg-2",
      name: "Mega Group B",
      grades: [4, 5, 6],
      areas: [],
      start_day: "20 Sept",
      end_day: "24 Sept",
    },
  ];

  const partitioned = fixedPartitionGroupsEvenlyAcrossMegaGroups(students as any, megaGroups, {
    avgGroupSize: 20,
    prefix: "Group",
  });

  const mgA = partitioned.groupMembershipsByMg.get("Mega Group A") || [];
  const mgB = partitioned.groupMembershipsByMg.get("Mega Group B") || [];

  console.log(`FIXED PARTITIONING RESULTS:`);
  console.log(`Mega Group A total groups: ${mgA.length}, students: ${mgA.reduce((sum, g) => sum + g.studentCount, 0)}`);
  console.log(`Mega Group B total groups: ${mgB.length}, students: ${mgB.reduce((sum, g) => sum + g.studentCount, 0)}`);

  const areasMgA: Record<string, number> = {};
  const areasMgB: Record<string, number> = {};

  for (const g of mgA) {
    areasMgA[g.physicalArea] = (areasMgA[g.physicalArea] || 0) + g.studentCount;
  }
  for (const g of mgB) {
    areasMgB[g.physicalArea] = (areasMgB[g.physicalArea] || 0) + g.studentCount;
  }

  const allAreas = [...new Set([...Object.keys(areasMgA), ...Object.keys(areasMgB)])].sort();
  console.log(`\nSample Area Breakdown with Fix:`);
  for (const area of allAreas) {
    const aCount = areasMgA[area] || 0;
    const bCount = areasMgB[area] || 0;
    console.log(`  Area: "${area}" -> MG A: ${aCount} students, MG B: ${bCount} students (Total: ${aCount + bCount})`);
  }
}

main().catch(console.error);
