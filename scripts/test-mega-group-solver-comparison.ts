import fs from "fs";
import * as XLSX from "xlsx";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import type { AllocationPreferences, MegaGroupDefinition } from "../src/lib/allocation-client";

function makeFile(buf: Buffer, filename: string): File {
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
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
    Grade: String(s.Grade || s.grade || "Grade 4"),
    "Physical Area": String(s["Physical Area"] || s.Area || s.area || "Unknown").trim(),
  }));

  if (students.length < 25000) {
    const areaCap7: Record<string, number> = {};
    for (const lab of labs) {
      const area = lab.Area || lab.area;
      const cap = Number(lab["Lab Capacity"] || lab.capacity || 20);
      areaCap7[area] = (areaCap7[area] || 0) + cap * 7;
    }
    const areas = Object.keys(areaCap7);
    const totalEgyptCap7 = Object.values(areaCap7).reduce((a, b) => a + b, 0);

    const studentRows: any[] = [];
    let sId = 1;
    const targetAssigned = 25268;
    const totalStudentCount = 25306;

    for (const area of areas) {
      const share = areaCap7[area] / totalEgyptCap7;
      const areaStudents = Math.min(areaCap7[area], Math.round(targetAssigned * share));
      for (let i = 0; i < areaStudents; i++) {
        const g = 4 + (i % 3);
        studentRows.push({
          S_ID: `STU-${String(sId++).padStart(5, "0")}`,
          Grade: `Grade ${g}`,
          "Physical Area": area,
        });
      }
    }
    const orphanCount = totalStudentCount - studentRows.length;
    for (let i = 0; i < orphanCount; i++) {
      const g = 4 + (i % 3);
      studentRows.push({
        S_ID: `STU-${String(sId++).padStart(5, "0")}`,
        Grade: `Grade ${g}`,
        "Physical Area": "منطقة غير مغطاة",
      });
    }
    students = studentRows;
  }

  console.log(`Testing with ${students.length} students across ${labs.length} labs...`);

  const studentWs = XLSX.utils.json_to_sheet(students);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Sheet1");
  const studentFileBuf = XLSX.write(studentWb, { bookType: "xlsx", type: "buffer" });
  const studentFile = makeFile(studentFileBuf, "students.xlsx");
  const labFile = makeFile(labBuf, "labs.xlsx");

  // Create 2 Mega Groups across 2 weeks (e.g. 13-17 Sept, 20-24 Sept)
  // Generating multi-week custom slots
  const daysWeek1 = ["13 Sept", "14 Sept", "15 Sept", "16 Sept", "17 Sept"];
  const daysWeek2 = ["20 Sept", "21 Sept", "22 Sept", "23 Sept", "24 Sept"];
  const times = ["10:00 AM", "12:30 PM", "04:00 PM", "07:30 PM"];

  const customSlots: string[] = [];
  for (const d of [...daysWeek1, ...daysWeek2]) {
    for (const t of times) {
      customSlots.push(`${d} @ ${t}`);
    }
  }

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

  const prefsCurrent: AllocationPreferences = {
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [],
    batchGroupType: "multi_session",
    defaultRepeatCount: 5,
    customSlots,
    mega_groups: megaGroups,
  };

  console.log("\n--- RUNNING WITH CURRENT CODE (GLOBAL ARRAY SLICING) ---");
  const resultCurrent = await runAllocation({
    studentFile,
    labFile,
    dashboardFile: null,
    program: "DEMI",
    prefix: "Physical-DEMI-G",
    preferences: prefsCurrent,
  });

  console.log(`Current Code Results:`);
  console.log(`  Assigned: ${resultCurrent.summary.assigned_count}`);
  console.log(`  Unassigned: ${resultCurrent.summary.unassigned_count}`);
  console.log(`  Overfill: ${resultCurrent.summary.overfill_count}`);
}

main().catch(console.error);
