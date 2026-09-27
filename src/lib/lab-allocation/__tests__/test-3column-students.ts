import fs from "fs";
import * as XLSX from "xlsx";
import { parseAndValidateStudents } from "../student-importer";
import { parseMasterLabScheduleSheet } from "../master-sheet-importer";
import { generateGroups } from "../group-generator";
import { runAllocation } from "../allocation-engine";

export function test3ColumnAllocation() {
  const labCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Operations_Dashboard.csv", "utf-8");
  const labWb = XLSX.read(labCsv, { type: "string" });
  const labRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(labWb.Sheets[labWb.SheetNames[0]], { defval: "" });
  const masterResult = parseMasterLabScheduleSheet(labRows);

  const studentCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Full_Students.csv", "utf-8");
  const studentWb = XLSX.read(studentCsv, { type: "string" });
  const studentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(studentWb.Sheets[studentWb.SheetNames[0]], { defval: "" });

  // Strip Group ID and Location ID to simulate what the user actually uploads
  const strippedRows = studentRows.map((row) => ({
    "{{S_ID}}": row["{{S_ID}}"] || row["student : {{S_ID}}"],
    "Grade(25-26)": row["Grade(25-26)"],
    "Physical Area": row["Physical Area"],
  }));

  console.log("Stripped student rows count:", strippedRows.length);
  const validation = parseAndValidateStudents(strippedRows);
  console.log("Valid students:", validation.validStudents.length);
  console.log("Detected areas:", validation.detectedAreas);

  const groups = generateGroups(validation.validStudents, 20);
  console.log("Groups generated:", groups.length);
  console.log("First 5 groups:", groups.slice(0, 5).map(g => ({ code: g.groupCode, area: g.area, grade: g.grade, count: g.studentCount })));

  const result = runAllocation(groups, masterResult.labs, {
    groupCapacity: 20,
    respectGradeSlots: false,
    allowFallbackToGov: true,
    organization: "DEMI",
  });

  console.log("\n=== ALLOCATION STATS (3-COLUMN STUDENTS) ===");
  console.log("Stats:", result.stats);
  console.log("Total issues:", result.issues.length);
  console.log("Allocations count:", result.allocations.length);
  console.log("Unallocated count:", result.unallocatedGroups.length);

  if (result.issues.length > 0) {
    console.log("First 15 issues:");
    result.issues.slice(0, 15).forEach((iss, idx) => {
      console.log(`${idx + 1}. [${iss.level.toUpperCase()}] ${iss.type}: ${iss.message}`);
    });
  }
}

test3ColumnAllocation();
