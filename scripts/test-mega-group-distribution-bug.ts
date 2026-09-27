import fs from "fs";
import * as XLSX from "xlsx";
import { partitionGroupsEvenlyAcrossMegaGroups } from "../src/lib/lab-allocation-runner/mega-groups";
import type { MegaGroupDefinition } from "../src/lib/allocation-client";

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

  const students = rawStudents.map((s: any, idx: number) => ({
    S_ID: String(s.S_ID || s["Student ID"] || `STU-${idx}`),
    Grade: Number(String(s.Grade || s.grade || "").replace(/\D/g, "")) || 4,
    "Physical Area": String(s["Physical Area"] || s.Area || s.area || "Unknown").trim(),
  }));

  console.log(`Analyzing dataset with ${students.length} students across ${labs.length} labs...`);

  // Define 2 Mega Groups (MG1 and MG2) across all areas
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

  const partitioned = partitionGroupsEvenlyAcrossMegaGroups(students, megaGroups, {
    avgGroupSize: 20,
    prefix: "Group",
  });

  const mgA = partitioned.groupMembershipsByMg.get("Mega Group A") || [];
  const mgB = partitioned.groupMembershipsByMg.get("Mega Group B") || [];

  console.log(`Mega Group A total groups: ${mgA.length}, students: ${mgA.reduce((sum, g) => sum + g.studentCount, 0)}`);
  console.log(`Mega Group B total groups: ${mgB.length}, students: ${mgB.reduce((sum, g) => sum + g.studentCount, 0)}`);

  // Count groups per area in MG A vs MG B
  const areasMgA: Record<string, number> = {};
  const areasMgB: Record<string, number> = {};

  for (const g of mgA) {
    areasMgA[g.physicalArea] = (areasMgA[g.physicalArea] || 0) + g.studentCount;
  }
  for (const g of mgB) {
    areasMgB[g.physicalArea] = (areasMgB[g.physicalArea] || 0) + g.studentCount;
  }

  const allAreas = [...new Set([...Object.keys(areasMgA), ...Object.keys(areasMgB)])].sort();
  console.log(`\nSample Area Breakdown (Students in MG A vs MG B):`);
  let imbalancedAreas = 0;
  for (const area of allAreas.slice(0, 20)) {
    const aCount = areasMgA[area] || 0;
    const bCount = areasMgB[area] || 0;
    console.log(`  Area: "${area}" -> MG A: ${aCount} students, MG B: ${bCount} students`);
    if (aCount === 0 || bCount === 0) imbalancedAreas++;
  }
  console.log(`\nTotal areas examined: ${allAreas.length}`);
}

main().catch(console.error);
