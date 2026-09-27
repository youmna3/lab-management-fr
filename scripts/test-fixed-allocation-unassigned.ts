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

  console.log(`Running allocation test for ${students.length} students across ${labs.length} labs...`);

  const studentWs = XLSX.utils.json_to_sheet(students);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Sheet1");
  const studentFileBuf = XLSX.write(studentWb, { bookType: "xlsx", type: "buffer" });
  const studentFile = makeFile(studentFileBuf, "students.xlsx");
  const labFile = makeFile(labBuf, "labs.xlsx");

  // 10 days × 4 slots = 40 slots
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
      dates: daysWeek1,
    },
    {
      id: "mg-2",
      name: "Mega Group B",
      grades: [4, 5, 6],
      areas: [],
      dates: daysWeek2,
    },
  ];

  const prefs: AllocationPreferences = {
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [],
    batchGroupType: "multi_session",
    defaultRepeatCount: 5,
    customSlots,
    mega_groups: megaGroups,
  };

  const output = await runAllocation({
    studentFile,
    labFile,
    dashboardFile: null,
    program: "DEMI",
    prefix: "Physical-DEMI-G",
    preferences: prefs,
  });

  const res = output.payload;
  console.log("\n================================================================================");
  console.log("ALLOCATION RUN SUMMARY:");
  console.log("================================================================================");
  console.log(`Total Students: ${res.summary.total_students}`);
  console.log(`Assigned Count: ${res.summary.assigned_count}`);
  console.log(`Unassigned Count: ${res.summary.unassigned_count}`);
  console.log(`Overfill Count: ${res.summary.overfill_count}`);
  console.log(`Total Labs Used: ${res.summary.total_labs}`);
  console.log(`Total Sessions Available: ${res.summary.total_sessions_available}`);
  console.log(`Total Sessions Assigned: ${res.summary.total_sessions_assigned}`);

  if (res.unassigned_students && res.unassigned_students.length > 0) {
    console.log(`\nUnassigned breakdown by reason:`);
    const byReason: Record<string, number> = {};
    for (const u of res.unassigned_students) {
      const r = u.Reason || "Unknown";
      byReason[r] = (byReason[r] || 0) + 1;
    }
    for (const [r, count] of Object.entries(byReason)) {
      console.log(`  • ${r}: ${count} students`);
    }

    console.log(`\nUnassigned breakdown by Area:`);
    const byArea: Record<string, number> = {};
    for (const u of res.unassigned_students) {
      const a = u["Physical Area"] || "Unknown";
      byArea[a] = (byArea[a] || 0) + 1;
    }
    for (const [a, count] of Object.entries(byArea)) {
      console.log(`  • ${a}: ${count} students`);
    }
  }
}

main().catch(console.error);
