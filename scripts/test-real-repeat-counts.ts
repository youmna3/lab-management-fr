import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import type { AllocationPreferences, MegaGroupDefinition } from "../src/lib/allocation-client";

function makeXlsxFile(data: any[], filename: string): File {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function main() {
  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  const rawStudents = JSON.parse(fs.readFileSync("scratch/real_25304_students.json", "utf-8"));
  const studentFile = makeXlsxFile(rawStudents, "students.xlsx");
  const labFile = makeXlsxFile(labs, "labs.xlsx");

  const days10 = [
    "13 Sept", "14 Sept", "15 Sept", "16 Sept", "17 Sept",
    "20 Sept", "21 Sept", "22 Sept", "23 Sept", "24 Sept"
  ];
  const times4 = ["10:00 AM", "12:30 PM", "04:00 PM", "07:30 PM"];
  const customSlots: string[] = [];
  for (const d of days10) {
    for (const t of times4) {
      customSlots.push(`${d} @ ${t}`);
    }
  }

  const mgWeek1: MegaGroupDefinition = {
    id: "mg-1",
    name: "Mega Group A",
    grades: [4, 5, 6],
    areas: [],
    dates: days10.slice(0, 5),
  };
  const mgWeek2: MegaGroupDefinition = {
    id: "mg-2",
    name: "Mega Group B",
    grades: [4, 5, 6],
    areas: [],
    dates: days10.slice(5, 10),
  };

  for (const repeat of [2, 3, 5]) {
    console.log(`\n==============================================================`);
    console.log(`TESTING REPEAT COUNT = ${repeat} ON REAL 25,304 STUDENTS`);
    console.log(`==============================================================`);

    const res = await runAllocation({
      studentFile,
      labFile,
      program: "DEMI",
      prefix: "Physical-DEMI-G",
      preferences: {
        batchGroupType: "multi_session",
        defaultRepeatCount: repeat,
        customSlots,
        mega_groups: [mgWeek1, mgWeek2],
      },
    });

    console.log(`Repeat = ${repeat} Results:`);
    console.log(`  Total Demand: ${res.payload.summary.total_students}`);
    console.log(`  Assigned: ${res.payload.summary.assigned_count}`);
    console.log(`  Unassigned: ${res.payload.summary.unassigned_count}`);
    console.log(`  Overfill: ${res.payload.summary.overfill_count}`);
  }
}

main().catch(console.error);
