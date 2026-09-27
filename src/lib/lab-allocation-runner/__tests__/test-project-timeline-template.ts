import assert from "assert";
import * as XLSX from "xlsx";
import {
  generateTimelineTemplateFiles,
  parseTimelineSpreadsheetRows,
  normalizeDateToIso,
  normalizeSessionType,
  normalizeOfflineStatus,
  buildProjectTimelineFromRows,
  type TimelineRow,
} from "../../project-timeline-template";

async function testProjectTimelineTemplate() {
  console.log("================================================================================");
  console.log("TEST SUITE: Project & Timeline Template Generator and Parser");
  console.log("================================================================================\n");

  // 1. Test Template Generation
  const { xlsxBuffer, csvContent } = generateTimelineTemplateFiles();
  assert(xlsxBuffer.length > 0, "XLSX template buffer must not be empty");
  assert(csvContent.includes("Date,Day,Batch Name,Session Type,Sub-Group,Blocked Day"), "CSV must have proper 6-column header");
  console.log("✓ Template generation produced valid XLSX and CSV buffers.");

  // 2. Test Parsing the Generated XLSX
  const wb = XLSX.read(xlsxBuffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet);
  
  const parsed = parseTimelineSpreadsheetRows(rawRows, "DEMI Summer 2026");
  console.log(`Parsed Project: "${parsed.projectName}" (${parsed.program})`);
  console.log(`Date Range: ${parsed.startDate} to ${parsed.endDate}`);
  console.log(`Total Batches: ${parsed.batches.length}`);
  for (const b of parsed.batches) {
    console.log(`- Batch "${b.name}": Mode=${b.groupDistributionMode}, Sessions=${b.expectedSessionsPerGroup}, Dates=${b.dates.length}, Blocked=${b.blockedDays.length}, MegaGroups=${b.megaGroups.length}`);
    for (const mg of b.megaGroups) {
      console.log(`    MegaGroup "${mg.name}": ${mg.start_date} -> ${mg.end_date} (${mg.dates?.length} dates)`);
    }
  }

  assert.strictEqual(parsed.projectName, "DEMI Summer 2026");
  assert.strictEqual(parsed.batches.length, 2, "Must identify exactly 2 distinct batches (Cohort 1 and Cohort 2)");

  const cohort1 = parsed.batches.find((b) => b.name === "Cohort 1")!;
  assert.strictEqual(cohort1.groupDistributionMode, "single_session");
  assert.strictEqual(cohort1.expectedSessionsPerGroup, 1);
  assert.strictEqual(cohort1.dates.length, 2);

  const cohort2 = parsed.batches.find((b) => b.name === "Cohort 2")!;
  assert.strictEqual(cohort2.groupDistributionMode, "multi_session");
  assert.strictEqual(cohort2.megaGroups.length, 2, "Must create 2 mega groups (Group A and Group B)");
  
  const mgA = cohort2.megaGroups.find((m) => m.name === "Group A")!;
  assert.strictEqual(mgA.dates?.length, 3, "Group A should have 3 active dates (excluding the 1 offline date on 2026-09-18)");
  assert.strictEqual(mgA.start_date, "2026-09-15");
  assert.strictEqual(mgA.end_date, "2026-09-17");

  const mgB = cohort2.megaGroups.find((m) => m.name === "Group B")!;
  assert.strictEqual(mgB.dates?.length, 3, "Group B should have 3 active dates");
  assert.strictEqual(mgB.start_date, "2026-09-20");
  assert.strictEqual(mgB.end_date, "2026-09-22");

  assert(cohort2.blockedDays.includes("2026-09-18"), "2026-09-18 must be recorded as blocked/offline in Cohort 2");

  console.log("\n✓ Parsed structure matches all schema expectations exactly.");

  // 3. Test Date Normalization Edge Cases
  assert.strictEqual(normalizeDateToIso("2026-09-13"), "2026-09-13");
  assert.strictEqual(normalizeDateToIso("13/09/2026"), "2026-09-13");
  assert.strictEqual(normalizeDateToIso("13-09-2026"), "2026-09-13");
  console.log("✓ Date normalization handles ISO, UK/EG (DD/MM/YYYY) formats.");

  // 4. Test Session Type and Offline Normalization
  assert.strictEqual(normalizeSessionType("SG"), "SG");
  assert.strictEqual(normalizeSessionType("Single"), "SG");
  assert.strictEqual(normalizeSessionType("Multi"), "Multi");
  assert.strictEqual(normalizeSessionType("Multi-Session"), "Multi");

  assert.strictEqual(normalizeOfflineStatus("Yes"), true);
  assert.strictEqual(normalizeOfflineStatus("Y"), true);
  assert.strictEqual(normalizeOfflineStatus("No"), false);
  assert.strictEqual(normalizeOfflineStatus("N"), false);
  assert.strictEqual(normalizeOfflineStatus("عطلة"), true);
  console.log("✓ Session type and offline normalization handles bilingual & alternative text.");

  console.log("\n================================================================================");
  console.log("✓ ALL PROJECT & TIMELINE TEMPLATE TESTS PASSED PERFECTLY!");
  console.log("================================================================================\n");
}

testProjectTimelineTemplate().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
