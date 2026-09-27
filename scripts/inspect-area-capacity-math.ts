import fs from "fs";
import * as XLSX from "xlsx";

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

  const areaLabs: Record<string, any[]> = {};
  for (const l of labs) {
    const a = String(l.Area || l.area || "").trim();
    if (!areaLabs[a]) areaLabs[a] = [];
    areaLabs[a].push(l);
  }

  const areaStudents: Record<string, number> = {};
  for (const s of rawStudents) {
    const a = String(s["Physical Area"] || s.Area || s.area || "").trim();
    areaStudents[a] = (areaStudents[a] || 0) + 1;
  }

  console.log("AREA LAB CAPACITY AUDIT (Multi-session 5 repeat visits / student):");
  console.log("------------------------------------------------------------------");
  for (const [area, sCount] of Object.entries(areaStudents)) {
    const labList = areaLabs[area] || [];
    const totalSlotCap = labList.reduce((sum, l) => sum + Number(l["Lab Capacity"] || l.capacity || 20), 0);
    // In 1 week (5 days, 4 time slots/day), each lab can hold 4 simultaneous multi-session tracks (1 track per time slot, running across the 5 days).
    // So 1 lab can seat 4 * capacity unique multi-session students per week.
    // Across 2 weeks (Mega Group A + Mega Group B), 1 lab can seat 8 * capacity unique multi-session students.
    const maxStudentsIn2Weeks = totalSlotCap * 8; // 8 tracks (4 in Week 1, 4 in Week 2)
    const maxStudentsIn1Week = totalSlotCap * 4;  // 4 tracks

    console.log(`\nArea "${area}":`);
    console.log(`  Total Students in file: ${sCount}`);
    console.log(`  Physical Labs count: ${labList.length} (Labs: ${labList.map(l => `${l["Lab ID"] || l.id}(cap=${l["Lab Capacity"] || 20})`).join(", ")})`);
    console.log(`  Total Lab Capacity per single slot: ${totalSlotCap} seats`);
    console.log(`  Max Students seatable in 1 Week (4 tracks × 5 days): ${maxStudentsIn1Week} students`);
    console.log(`  Max Students seatable in 2 Weeks (8 tracks × 5 days): ${maxStudentsIn2Weeks} students`);
    console.log(`  Physical Deficit in 2 Weeks: ${sCount > maxStudentsIn2Weeks ? sCount - maxStudentsIn2Weeks : 0} students`);
  }
}

main().catch(console.error);
