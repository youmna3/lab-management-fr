import assert from "assert";
import fs from "fs";
import * as XLSX from "xlsx";
import {
  generateTimelineTemplateFiles,
  parseTimelineSpreadsheetRows,
} from "../src/lib/project-timeline-template";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";
import { loadLabCapacity, type StudentRow } from "../src/lib/lab-allocation-runner/parse";

async function testTimelineAllocationEndToEnd() {
  console.log("================================================================================");
  console.log("TEST: Timeline Project Creation -> Lab Allocation Pipeline Integration");
  console.log("================================================================================\n");

  // 1. Generate template & parse it
  const { xlsxBuffer } = generateTimelineTemplateFiles();
  const wb = XLSX.read(xlsxBuffer, { type: "array" });
  const rawRows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const parsed = parseTimelineSpreadsheetRows(rawRows);

  console.log(`Parsed Project: "${parsed.projectName}"`);
  console.log(`Batches Found: ${parsed.batches.length}`);

  // 2. Load benchmark students & labs
  const studentsRaw = JSON.parse(fs.readFileSync("scratch/real_25304_students.json", "utf-8")) as StudentRow[];
  const labBuf = fs.readFileSync("public/sample-files/egypt_labs_benchmark.xlsx");
  const studentFile = new File([JSON.stringify(studentsRaw)], "students.json");
  const labFile = new File([labBuf], "egypt_labs_benchmark.xlsx");

  const csvHeader = "S_ID,Grade,Physical Area\n";
  const csvBody = studentsRaw.map((s) => `"${s.S_ID}",${s.Grade},"${s["Physical Area"]}"`).join("\n");
  const realStudentFile = new File([csvHeader + csvBody], "students.csv");

  // 3. Test Batch 2 (Cohort 2: Multi-session with Group A and Group B)
  const cohort2 = parsed.batches.find((b) => b.name === "Cohort 2")!;
  assert(cohort2, "Cohort 2 batch must exist in template");
  assert.strictEqual(cohort2.groupDistributionMode, "multi_session");
  assert.strictEqual(cohort2.megaGroups.length, 2);

  // Construct customSlots array combining dates & standard time slots
  const customSlots: string[] = [];
  for (const d of cohort2.dates) {
    for (const t of cohort2.timeSlots) {
      customSlots.push(`${d}@${t}`);
    }
  }

  console.log(`Running allocation solver for parsed Batch "${cohort2.name}"...`);
  console.log(`  - Total Slots: ${customSlots.length} across ${cohort2.dates.length} days`);
  console.log(`  - Blocked Days: ${JSON.stringify(cohort2.blockedDays)}`);
  console.log(`  - Mega Groups: ${cohort2.megaGroups.map((m) => `${m.name} (${m.dates?.length} days)`).join(", ")}`);

  const res = await runAllocation({
    studentFile: realStudentFile,
    labFile,
    preferences: {
      customSlots,
      mega_groups: cohort2.megaGroups,
      blocked_days: cohort2.blockedDays,
      batchGroupType: cohort2.groupDistributionMode,
      defaultRepeatCount: cohort2.expectedSessionsPerGroup,
      overfillRules: [],
      preferredLabRules: [],
    },
  });

  const s = res.payload.summary;
  console.log(`\nAllocation Result:`);
  console.log(`  Total Demand: ${s.total_students}`);
  console.log(`  Assigned: ${s.assigned_count}`);
  console.log(`  Unassigned: ${s.unassigned_count}`);
  console.log(`  Overfill: ${s.overfill_count || 0}`);

  assert(s.total_students === 25304, "Total demand must match student count");
  assert.strictEqual(s.overfill_count ?? 0, 0, "Overfill must be 0");
  assert(s.assigned_count > 0, "Must assign students");

  console.log("\n================================================================================");
  console.log("✓ END-TO-END TIMELINE TO ALLOCATION TEST PASSED PERFECTLY!");
  console.log("================================================================================\n");
}

testTimelineAllocationEndToEnd().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
