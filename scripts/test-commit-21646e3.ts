import fs from "fs";
import { loadLabCapacity, type StudentRow } from "../src/lib/lab-allocation-runner/parse";
import { buildFullSessionGrid } from "../src/lib/lab-allocation-runner/grid";
import { resolveSlotSchedule } from "../src/lib/lab-allocation-runner/schedule";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import type { MegaGroupDefinition } from "../src/lib/allocation-client";

// In commit 21646e3 (and bd657de / e1defe5):
// The partitionGroupsEvenlyAcrossMegaGroups function had the global cohort slicing:
function partitionGroupsEvenlyAcrossMegaGroups_21646e3(
  students: StudentRow[],
  megaGroups: MegaGroupDefinition[],
  options?: {
    avgGroupSize?: number;
    prefix?: string;
  }
) {
  if (!megaGroups || megaGroups.length === 0 || !students || students.length === 0) {
    return { megaGroups: megaGroups || [], groupMembershipsByMg: new Map() };
  }

  const avgGroupSize = options?.avgGroupSize && options.avgGroupSize > 0 ? options.avgGroupSize : 20;
  const prefix = options?.prefix || "Group";

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
  const groupMembershipsByMg = new Map<string, any[]>();
  const assignedStudentIdSet = new Set<string>();

  for (const cluster of clusters) {
    const { mgs, grades, areas } = cluster;
    const N = mgs.length;

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
        updatedMegaGroups.push({ ...mg, group_ids: mg.group_ids || [], student_ids: mg.student_ids || [] });
        groupMembershipsByMg.set(mg.name, []);
      }
      continue;
    }

    const areaGradeBuckets = new Map<string, StudentRow[]>();
    for (const s of eligibleStudents) {
      const key = `${s["Physical Area"]}__${s.Grade}`;
      if (!areaGradeBuckets.has(key)) areaGradeBuckets.set(key, []);
      areaGradeBuckets.get(key)!.push(s);
    }

    // THIS WAS THE 21646e3 IMPLEMENTATION:
    const allCohortGroups: Array<{
      groupId: string;
      shortGroupId: string;
      grade: number;
      physicalArea: string;
      studentCount: number;
      studentIds: string[];
      isExcluded: boolean;
    }> = [];

    let groupCounter = 1;
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
        allCohortGroups.push({
          groupId,
          shortGroupId: `G${groupCounter}`,
          grade,
          physicalArea: area,
          studentCount: groupStudents.length,
          studentIds: groupStudents.map((s) => s.S_ID),
          isExcluded: false,
        });
        groupCounter += 1;
      }
    }

    const totalGroups = allCohortGroups.length;
    const baseGroupsPerMg = Math.floor(totalGroups / N);
    const remainderGroups = totalGroups % N;

    let groupOffset = 0;
    for (let i = 0; i < N; i++) {
      const mg = mgs[i];
      const countForThisMg = i === N - 1 ? baseGroupsPerMg + remainderGroups : baseGroupsPerMg;
      const assignedGroups = allCohortGroups.slice(groupOffset, groupOffset + countForThisMg);
      groupOffset += countForThisMg;

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
      groupMembershipsByMg.set(mg.name, assignedGroups);
    }
  }

  return { megaGroups: updatedMegaGroups, groupMembershipsByMg };
}

async function main() {
  const studentsRaw = JSON.parse(fs.readFileSync("scratch/real_25304_students.json", "utf-8")) as StudentRow[];
  console.log(`Loaded ${studentsRaw.length} real students`);

  const labBuf = fs.readFileSync("public/sample-files/egypt_labs_benchmark.xlsx");
  const labFile = new File([labBuf], "egypt_labs_benchmark.xlsx");

  const csvHeader = "S_ID,Grade,Physical Area\n";
  const csvBody = studentsRaw.map((s) => `"${s.S_ID}",${s.Grade},"${s["Physical Area"]}"`).join("\n");
  const studentFile = new File([csvHeader + csvBody], "students.csv");

  const week1Days = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
  const week2Days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
  const times = ["10:00", "12:30", "16:00", "19:30"];

  const week1Slots: string[] = [];
  for (const d of week1Days) for (const t of times) week1Slots.push(`${d}@${t}`);
  const week2Slots: string[] = [];
  for (const d of week2Days) for (const t of times) week2Slots.push(`${d}@${t}`);
  const all40Slots = [...week1Slots, ...week2Slots];

  const rawMegaGroups: MegaGroupDefinition[] = [
    { name: "Mega Group A", dates: week1Days, grades: [], areas: [], time_slots: [] },
    { name: "Mega Group B", dates: week2Days, grades: [], areas: [], time_slots: [] }
  ];

  // Pre-partition using 21646e3 logic
  const partitioned = partitionGroupsEvenlyAcrossMegaGroups_21646e3(studentsRaw, rawMegaGroups);
  console.log("Partitioned Mega Groups with 21646e3 logic:");
  for (const mg of partitioned.megaGroups) {
    console.log(`- ${mg.name}: ${mg.student_ids?.length} students, ${mg.group_ids?.length} groups`);
  }

  // Now run allocation with these pre-partitioned mega groups
  console.log("\nRunning allocation with 21646e3 partitioned mega groups...");
  const res = await runAllocation({
    studentFile,
    labFile,
    preferences: {
      customSlots: all40Slots,
      mega_groups: partitioned.megaGroups,
      blocked_days: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
      overfillRules: [],
      preferredLabRules: []
    }
  });

  const s = res.payload.summary;
  console.log(`\n======================================================`);
  console.log(`21646e3 RUN RESULT ON REAL 25,304 STUDENTS:`);
  console.log(`  Total Demand: ${s.total_students}`);
  console.log(`  Assigned: ${s.assigned_count}`);
  console.log(`  Unassigned: ${s.unassigned_count}`);
  console.log(`  Overfill: ${s.overfill_count || 0}`);
  console.log(`======================================================`);
}

main().catch(console.error);
