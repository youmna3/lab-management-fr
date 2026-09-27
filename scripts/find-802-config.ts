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
  const totalStudentCount = 25304;

  for (const area of areas) {
    const share = areaCap7[area] / totalEgyptCap7;
    const areaStudents = Math.min(areaCap7[area], Math.round(targetAssigned * share));
    for (let i = 0; i < areaStudents; i++) {
      const g = 4 + (i % 3);
      studentRows.push({
        "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
        Grade: `Grade ${g}`,
        "Physical Area": area,
      });
    }
  }
  const orphanCount = totalStudentCount - studentRows.length;
  for (let i = 0; i < orphanCount; i++) {
    const g = 4 + (i % 3);
    studentRows.push({
      "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
      Grade: `Grade ${g}`,
      "Physical Area": "منطقة غير مغطاة",
    });
  }

  const studentFile = makeXlsxFile(studentRows, "students.xlsx");
  const labFile = makeXlsxFile(labs, "labs.xlsx");

  console.log(`Loaded dataset: ${studentRows.length} students across ${labs.length} labs.`);

  // Test various slot combinations (e.g. 5 days, 6 days, 7 days, 10 days, blocked days, mega groups)
  const slotPresets: Array<{ name: string; slots: string[]; mgs: MegaGroupDefinition[]; repeat: number }> = [];

  // Preset 1: 5 days Week 1 (13-17 Sept) & 5 days Week 2 (20-24 Sept), 4 times daily
  const daysW1 = ["13 Sept", "14 Sept", "15 Sept", "16 Sept", "17 Sept"];
  const daysW2 = ["20 Sept", "21 Sept", "22 Sept", "23 Sept", "24 Sept"];
  const times4 = ["10:00 AM", "12:30 PM", "04:00 PM", "07:30 PM"];
  const slotsW1W2: string[] = [];
  for (const d of [...daysW1, ...daysW2]) {
    for (const t of times4) slotsW1W2.push(`${d} @ ${t}`);
  }
  slotPresets.push({
    name: "10 Days (13-17 Sept & 20-24 Sept), 2 Mega Groups, repeat=2",
    slots: slotsW1W2,
    mgs: [
      { id: "mg1", name: "Mega Group A", dates: daysW1 },
      { id: "mg2", name: "Mega Group B", dates: daysW2 },
    ],
    repeat: 2,
  });
  slotPresets.push({
    name: "10 Days (13-17 Sept & 20-24 Sept), 2 Mega Groups, repeat=3",
    slots: slotsW1W2,
    mgs: [
      { id: "mg1", name: "Mega Group A", dates: daysW1 },
      { id: "mg2", name: "Mega Group B", dates: daysW2 },
    ],
    repeat: 3,
  });

  // Preset 2: 7 days single session / multi session
  const days7 = ["10 Sept", "11 Sept", "12 Sept", "13 Sept", "14 Sept", "15 Sept", "16 Sept"];
  const slots7: string[] = [];
  for (const d of days7) {
    for (const t of times4) slots7.push(`${d} @ ${t}`);
  }
  slotPresets.push({
    name: "7 Days, 2 Mega Groups (Days 1-4 vs Days 5-7), repeat=2",
    slots: slots7,
    mgs: [
      { id: "mg1", name: "Mega Group A", dates: days7.slice(0, 4) },
      { id: "mg2", name: "Mega Group B", dates: days7.slice(4) },
    ],
    repeat: 2,
  });

  // Preset 3: 2026-09-10 to 2026-09-17 dates with 2 Mega Groups
  const isoDatesW1 = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
  const isoDatesW2 = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"];
  const slotsIso: string[] = [];
  for (const d of [...isoDatesW1, ...isoDatesW2]) {
    for (const t of ["10:00", "12:30", "16:00", "19:30"]) slotsIso.push(`${d}@${t}`);
  }
  slotPresets.push({
    name: "ISO 8 Days (2026-09-10..17), 2 Mega Groups (4 days each), repeat=2",
    slots: slotsIso,
    mgs: [
      { id: "mg1", name: "Mega Group A", dates: isoDatesW1 },
      { id: "mg2", name: "Mega Group B", dates: isoDatesW2 },
    ],
    repeat: 2,
  });

  for (const preset of slotPresets) {
    console.log(`\n==============================================================`);
    console.log(`RUNNING: ${preset.name}`);
    const res = await runAllocation({
      studentFile,
      labFile,
      program: "DEMI",
      prefix: "Physical-DEMI-G",
      preferences: {
        batchGroupType: preset.repeat > 1 ? "multi_session" : "single_session",
        defaultRepeatCount: preset.repeat,
        customSlots: preset.slots,
        mega_groups: preset.mgs,
      },
    });
    console.log(`Result: Total=${res.payload.summary.total_students}, Assigned=${res.payload.summary.assigned_count}, Unassigned=${res.payload.summary.unassigned_count}, Overfill=${res.payload.summary.overfill_count}`);
  }
}

main().catch(console.error);
