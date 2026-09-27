import fs from "fs";
import * as XLSX from "xlsx";
import { partitionGroupsEvenlyAcrossMegaGroups } from "../src/lib/lab-allocation-runner/mega-groups";
import { buildFullSessionGrid } from "../src/lib/lab-allocation-runner/grid";
import { resolveSlotSchedule } from "../src/lib/lab-allocation-runner/schedule";
import type { MegaGroupDefinition, AllocationPreferences } from "../src/lib/allocation-client";

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

  console.log("================================================================================");
  console.log("DIAGNOSTIC ANALYSIS: Mega Groups & Capacity Allocation Root Cause");
  console.log("================================================================================\n");

  // 1. Raw Capacity Comparison: Old 7-slot config vs Multi-Week config
  const slotInfo7 = resolveSlotSchedule(undefined, []); // default 7 slots
  const sessions7 = buildFullSessionGrid(labs.map(l => ({ "Lab ID": l["Lab ID"] || l.id, Area: l.Area || l.area, "Lab Capacity": Number(l["Lab Capacity"] || l.capacity || 20) })), [], slotInfo7, []);
  const totalCap7 = sessions7.reduce((sum, s) => sum + s.True_Capacity, 0);

  const daysWeek1 = ["13 Sept", "14 Sept", "15 Sept", "16 Sept", "17 Sept"];
  const daysWeek2 = ["20 Sept", "21 Sept", "22 Sept", "23 Sept", "24 Sept"];
  const times = ["10:00 AM", "12:30 PM", "04:00 PM", "07:30 PM"];
  const customSlotsMultiWeek: string[] = [];
  for (const d of [...daysWeek1, ...daysWeek2]) {
    for (const t of times) {
      customSlotsMultiWeek.push(`${d} @ ${t}`);
    }
  }
  const slotInfoMultiWeek = resolveSlotSchedule(customSlotsMultiWeek, []);
  const sessionsMultiWeek = buildFullSessionGrid(labs.map(l => ({ "Lab ID": l["Lab ID"] || l.id, Area: l.Area || l.area, "Lab Capacity": Number(l["Lab Capacity"] || l.capacity || 20) })), [], slotInfoMultiWeek, []);
  const totalCapMultiWeek = sessionsMultiWeek.reduce((sum, s) => sum + s.True_Capacity, 0);

  console.log("--- 1. RAW CAPACITY COMPARISON ---");
  console.log(`Old Config (7 slots):`);
  console.log(`  Total Slot Sessions: ${sessions7.length}`);
  console.log(`  Total Raw Seat Visits Capacity: ${totalCap7.toLocaleString()} seat-visits`);
  console.log(`\nNew Multi-Week Config (${daysWeek1.length + daysWeek2.length} days × ${times.length} slots = ${customSlotsMultiWeek.length} slots):`);
  console.log(`  Total Slot Sessions: ${sessionsMultiWeek.length}`);
  console.log(`  Total Raw Seat Visits Capacity: ${totalCapMultiWeek.toLocaleString()} seat-visits`);
  console.log(`  Capacity Multiplier: ${(totalCapMultiWeek / totalCap7).toFixed(2)}x more raw capacity than old config.`);

  // 2. Mega Group Partitioning Analysis
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

  console.log("\n--- 2. MEGA GROUP PARTITIONING BEHAVIOR ---");
  const partitioned = partitionGroupsEvenlyAcrossMegaGroups(students as any, megaGroups, {
    avgGroupSize: 20,
    prefix: "Group",
  });

  const mgA = partitioned.groupMembershipsByMg.get("Mega Group A") || [];
  const mgB = partitioned.groupMembershipsByMg.get("Mega Group B") || [];

  console.log(`Mega Group A total groups: ${mgA.length}, students: ${mgA.reduce((sum, g) => sum + g.studentCount, 0)}`);
  console.log(`Mega Group B total groups: ${mgB.length}, students: ${mgB.reduce((sum, g) => sum + g.studentCount, 0)}`);

  // Check how many areas have students ONLY in MG A or ONLY in MG B
  const areaDistribution: Record<string, { mgAStudents: number; mgBStudents: number; totalStudents: number }> = {};
  for (const s of students) {
    const a = s["Physical Area"];
    if (!areaDistribution[a]) areaDistribution[a] = { mgAStudents: 0, mgBStudents: 0, totalStudents: 0 };
    areaDistribution[a].totalStudents++;
  }

  for (const g of mgA) {
    if (areaDistribution[g.physicalArea]) {
      areaDistribution[g.physicalArea].mgAStudents += g.studentCount;
    }
  }
  for (const g of mgB) {
    if (areaDistribution[g.physicalArea]) {
      areaDistribution[g.physicalArea].mgBStudents += g.studentCount;
    }
  }

  let singleMgAreas = 0;
  let bothMgAreas = 0;
  const areaLabs: Record<string, number> = {};
  for (const l of labs) {
    const a = String(l.Area || l.area).trim();
    areaLabs[a] = (areaLabs[a] || 0) + Number(l["Lab Capacity"] || l.capacity || 20);
  }

  console.log(`\nArea-by-Area Distribution Analysis:`);
  for (const [area, dist] of Object.entries(areaDistribution)) {
    const isSingle = dist.mgAStudents === 0 || dist.mgBStudents === 0;
    if (isSingle) singleMgAreas++;
    else bothMgAreas++;

    const labCapPerSlot = areaLabs[area] || 0;
    const labCap5Days = labCapPerSlot * 4; // 4 slots/day, assuming 5 days repeat count means 4 tracks available
    if (dist.totalStudents > labCap5Days) {
      console.log(`\n  Area "${area}":`);
      console.log(`    Total Demand: ${dist.totalStudents} students`);
      console.log(`    Lab Capacity per 5-Day Window (4 tracks): ${labCap5Days} students`);
      console.log(`    Lab Capacity Across Entire 2-Week Schedule (8 tracks): ${labCap5Days * 2} students`);
      console.log(`    Current Partitioning: MG A = ${dist.mgAStudents} students, MG B = ${dist.mgBStudents} students`);
      if (dist.mgAStudents > labCap5Days) {
        console.log(`    -> EXCEEDS MG A WINDOW by ${dist.mgAStudents - labCap5Days} students! (Forces unassigned even though Week 2 is EMPTY for this area!)`);
      }
      if (dist.mgBStudents > labCap5Days) {
        console.log(`    -> EXCEEDS MG B WINDOW by ${dist.mgBStudents - labCap5Days} students! (Forces unassigned even though Week 1 is EMPTY for this area!)`);
      }
    }
  }

  console.log(`\nSummary of Areas:`);
  console.log(`  Areas with students assigned to ONLY ONE Mega Group: ${singleMgAreas}`);
  console.log(`  Areas split across BOTH Mega Groups: ${bothMgAreas}`);
}

main().catch(console.error);
