import fs from "fs";
import * as XLSX from "xlsx";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";

function makeStudentFile(students: any[], filename = "students.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(students);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function traceLabSlots() {
  console.log("=========================================================================");
  console.log("🔍 TRACING LAB GRID MATRIX SLOTS & OCCUPANCY (INVESTIGATION ITEM 1)");
  console.log("=========================================================================");

  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  // Find L556 or first lab in "15 مايو"
  const targetLab = labs.find((l) => l["Lab ID"] === "L556" || l.Area === "15 مايو") || labs[0];
  const targetLabId = targetLab["Lab ID"];
  const targetArea = targetLab.Area;

  console.log(`• Target Lab: ${targetLabId} (Area: "${targetArea}", Capacity: ${targetLab["Lab Capacity"] || 20})`);

  // Generate students
  const studentRows: any[] = [];
  let sId = 1;
  // Generate 60 Grade 4 students, 40 Grade 5 students, 40 Grade 6 students in targetArea
  for (let i = 0; i < 60; i++) {
    studentRows.push({ "Student ID": `STU-${sId++}`, Grade: 4, "Physical Area": targetArea });
  }
  for (let i = 0; i < 40; i++) {
    studentRows.push({ "Student ID": `STU-${sId++}`, Grade: 5, "Physical Area": targetArea });
  }
  for (let i = 0; i < 40; i++) {
    studentRows.push({ "Student ID": `STU-${sId++}`, Grade: 6, "Physical Area": targetArea });
  }

  // Run solver with multi-session (e.g. 2 visits per group)
  const runRes = await runAllocation({
    studentFile: makeStudentFile(studentRows, "bench_students.xlsx"),
    labFile: null,
    useDbLabs: true,
    labsJson: [targetLab],
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
    },
  });

  const { lab_pivot, master_allocation, summary } = runRes.payload;

  console.log(`\n• Solver Summary: Total Demand=${summary.total_students}, Assigned=${summary.assigned_count}, Unassigned=${summary.unassigned_count}`);
  console.log(`• Total lab_pivot rows for this area: ${lab_pivot.length}`);

  console.log(`\n=== 1. LAB GRID MATRIX ROWS (by Area + Grade + Lab) ===`);
  for (const row of lab_pivot) {
    console.log(`\nRow: Area="${row["Physical Area"]}", Grade=${row.Grade}, Lab="${row.Lab_ID}"`);
    const slotKeys = Object.keys(row).filter((k) => !["Physical Area", "Grade", "Lab_ID"].includes(k));
    for (const k of slotKeys) {
      console.log(`    Slot [${k}]: ${row[k]}`);
    }
  }

  console.log(`\n=== 2. PHYSICAL LAB COMBINED TIMELINE (All Grades occupying Lab "${targetLabId}") ===`);
  const slotOccupancy = new Map<string, Array<{ Grade: number; Group_ID: string; count: number; Visit_Num: number }>>();
  for (const r of master_allocation) {
    if (r.Lab_ID !== targetLabId) continue;
    if (!slotOccupancy.has(r.Time_Slot)) slotOccupancy.set(r.Time_Slot, []);
    const list = slotOccupancy.get(r.Time_Slot)!;
    const existing = list.find((item) => item.Group_ID === r.Group_ID && item.Visit_Num === Number(r.Visit_Num));
    if (existing) {
      existing.count++;
    } else {
      list.push({ Grade: Number(r.Grade), Group_ID: r.Group_ID, count: 1, Visit_Num: Number(r.Visit_Num) || 1 });
    }
  }

  for (const [slot, occupants] of slotOccupancy.entries()) {
    const desc = occupants.map((o) => `Grade ${o.Grade} (${o.Group_ID} Visit #${o.Visit_Num}: ${o.count} students)`).join(", ");
    console.log(`  Slot [${slot}]: ${desc}`);
  }
}

traceLabSlots().catch(console.error);
