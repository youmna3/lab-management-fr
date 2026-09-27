import fs from "fs";
import * as XLSX from "xlsx";
import { parseAndValidateStudents } from "../student-importer";
import { parseMasterLabScheduleSheet } from "../master-sheet-importer";
import { generateGroups } from "../group-generator";
import { runAllocation } from "../allocation-engine";

export function runFullDatasetTest() {
  const labCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Operations_Dashboard.csv", "utf-8");
  const labWb = XLSX.read(labCsv, { type: "string" });
  const labRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(labWb.Sheets[labWb.SheetNames[0]], { defval: "" });
  const masterResult = parseMasterLabScheduleSheet(labRows);
  console.log("Master Labs parsed:", masterResult.labs.length);
  console.log("Master Pre-assigned Groups:", masterResult.groups.length);

  const studentCsv = fs.readFileSync("public/sample-files/DEMI_Summer_2026_Full_Students.csv", "utf-8");
  const studentWb = XLSX.read(studentCsv, { type: "string" });
  const studentRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(studentWb.Sheets[studentWb.SheetNames[0]], { defval: "" });

  console.log("Parsed raw student rows:", studentRows.length);
  const validation = parseAndValidateStudents(studentRows);
  console.log("Valid students:", validation.validStudents.length);
  console.log("Invalid students count:", validation.invalidRows.length);
  if (validation.invalidRows.length > 0) {
    console.log("Invalid rows:", JSON.stringify(validation.invalidRows, null, 2));
  }
  console.log("Detected areas:", validation.detectedAreas.length);
  console.log("Detected grades:", validation.detectedGrades);

  const groups = generateGroups(validation.validStudents, 25);
  console.log("Groups generated:", groups.length);

  const result = runAllocation(groups, masterResult.labs, {
    groupCapacity: 25,
    respectGradeSlots: false,
    allowFallbackToGov: true,
    organization: "DEMI",
  });

  console.log("\n=== FULL ALLOCATION STATS ===");
  console.log("Stats:", result.stats);
  console.log("Total issues:", result.issues.length);

  const issueTypes: Record<string, number> = {};
  for (const iss of result.issues) {
    issueTypes[iss.type] = (issueTypes[iss.type] || 0) + 1;
  }
  console.log("Issues by type:", issueTypes);

  console.log("\nAll issues:");
  result.issues.forEach((iss, idx) => {
    console.log(`${idx + 1}. [${iss.level.toUpperCase()}] ${iss.type}: ${iss.message}`);
  });
}

runFullDatasetTest();
