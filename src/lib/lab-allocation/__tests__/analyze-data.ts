import fs from "fs";
import * as XLSX from "xlsx";

const labCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Operations_Dashboard.csv", "utf-8");
const labWb = XLSX.read(labCsv, { type: "string" });
const labRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(labWb.Sheets[labWb.SheetNames[0]], { defval: "" });

const studentCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Full_Students.csv", "utf-8");
const studentWb = XLSX.read(studentCsv, { type: "string" });
const studentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(studentWb.Sheets[studentWb.SheetNames[0]], { defval: "" });

console.log("Total students in full file:", studentRows.length);

const studentCounts: Record<string, number> = {};
for (const s of studentRows) {
  const area = String(s["Physical Area"] || "").trim();
  const grade = String(s["Grade(25-26)"] || "").trim();
  const key = `${area} | ${grade}`;
  studentCounts[key] = (studentCounts[key] || 0) + 1;
}

const labSlotCounts: Record<string, { slots: number; capacity: number; groupCodes: string[] }> = {};
const slotKeys = ["Thu 9 AM", "Thu 12 PM", "Thu 3 PM", "Thu 6 PM", "Fri 9 AM", "Fri 3 PM", "Fri 6 PM"];

for (const l of labRows) {
  const area = String(l["Area"] || "").trim();
  const cap = Number(l["Lab Capacity"]) || 20;
  for (const sk of slotKeys) {
    const slotGrade = String(l[sk + " Grade"] || "").trim();
    const slotGrp = String(l[sk] || "").trim();
    if (slotGrade && slotGrp) {
      const key = `${area} | ${slotGrade}`;
      if (!labSlotCounts[key]) labSlotCounts[key] = { slots: 0, capacity: 0, groupCodes: [] };
      labSlotCounts[key].slots += 1;
      labSlotCounts[key].capacity += cap;
      labSlotCounts[key].groupCodes.push(slotGrp);
    }
  }
}

console.log("\n--- Top 20 Area/Grade combinations ---");
const sortedKeys = Object.keys(studentCounts).sort();
for (const k of sortedKeys.slice(0, 20)) {
  const lab = labSlotCounts[k];
  console.log(`${k.padEnd(25)} => Students: ${String(studentCounts[k]).padStart(3)} | Slots Cap: ${String(lab?.capacity ?? 0).padStart(3)} (Slots: ${lab?.slots ?? 0}, Grps: ${lab?.groupCodes?.join(", ") || "NONE"})`);
}

// Check if any student area/grade has NO matching lab slots
console.log("\n--- Checking Mismatches ---");
let totalStudentCount = 0;
let totalMatchedCap = 0;
let missingAreas: string[] = [];

for (const [k, count] of Object.entries(studentCounts)) {
  totalStudentCount += count;
  const lab = labSlotCounts[k];
  if (!lab) {
    missingAreas.push(k);
  } else {
    totalMatchedCap += lab.capacity;
  }
}
console.log("Total students:", totalStudentCount);
console.log("Missing Area/Grade in Dashboard:", missingAreas);
