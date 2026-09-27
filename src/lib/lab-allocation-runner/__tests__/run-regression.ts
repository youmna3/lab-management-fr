import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../run.js";
import { runBatchSwitchingIsolationTests } from "./test-batch-switching-isolation.js";
import { runOperationRequestsSyncTests } from "./test-operation-requests-sync.js";
import { runCustomBatchSlotsTests } from "./test-custom-batch-slots.js";
import { runMigrationWorkbookExportTests } from "./test-migration-workbook-export.js";
import { runRevocationTimestampTests } from "./test-revocation-timestamp.js";
import { runMultiSessionRecurringTrackTests } from "./test-multi-session-recurring-tracks.js";
import { runVpWorkflowPersistenceTests } from "./test-vp-workflow-persistence.js";
import { runPhysicalConsolidationTests } from "./test-physical-consolidation.js";
import { runSingleSessionPackingTests } from "./test-single-session-packing.js";

async function runRegressionSuite() {
  runSingleSessionPackingTests();
  console.log("=========================================================================");
  console.log("🧪 RUNNING NATIONWIDE LAB ALLOCATION REGRESSION & ACCURACY SUITE");
  console.log("=========================================================================");

  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  console.log(`• Loaded Physical Labs: ${labs.length} labs across Egypt`);

  // Calculate total capacity per area under 7 slots
  const areaCap7: Record<string, number> = {};
  for (const lab of labs) {
    const area = lab.Area || lab.area;
    const cap = Number(lab["Lab Capacity"] || lab.capacity || 20);
    areaCap7[area] = (areaCap7[area] || 0) + cap * 7;
  }

  const areas = Object.keys(areaCap7);
  const totalEgyptCap7 = Object.values(areaCap7).reduce((a, b) => a + b, 0);
  console.log(`• Total 7-Slot Egypt Capacity: ${totalEgyptCap7} seats across ${areas.length} areas`);

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
        Area: area,
      });
    }
  }

  // Add 36 students in an orphan area without labs
  const orphanCount = totalStudentCount - studentRows.length;
  for (let i = 0; i < orphanCount; i++) {
    const g = 4 + (i % 3);
    studentRows.push({
      "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
      Grade: `Grade ${g}`,
      Area: "OrphanAreaWithoutLabs",
    });
  }

  console.log(`• Generated Student Demand: ${studentRows.length} records (Target: 25,304)`);

  const studentWbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWbOut, XLSX.utils.json_to_sheet(studentRows), "Students");
  const studentFileBuf = XLSX.write(studentWbOut, { type: "buffer", bookType: "xlsx" });

  console.log("\n[TEST 1] Running Standard 7-Slot Schedule (4 Thu + 3 Fri)...");
  const t0 = performance.now();
  const res1 = await runAllocation({
    studentFile: new File([studentFileBuf], "students.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    labFile: new File([labBuf], "labs.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [], customSlots: undefined },
  });
  const t1 = performance.now();

  const summary = res1.payload.summary;
  const matchRate = (summary.assigned_count / summary.total_students) * 100;

  console.log(`  -> Execution Time: ${(t1 - t0).toFixed(0)} ms`);
  console.log(`  -> Total Students: ${summary.total_students.toLocaleString()}`);
  console.log(`  -> Assigned Students: ${summary.assigned_count.toLocaleString()}`);
  console.log(`  -> Unassigned Students: ${summary.unassigned_count.toLocaleString()}`);
  console.log(`  -> Match Rate: ${matchRate.toFixed(2)}%`);
  console.log(`  -> Total Sessions: ${summary.total_sessions_available.toLocaleString()}`);

  if (summary.total_students !== 25304) {
    throw new Error(`FAIL: Expected 25,304 students, got ${summary.total_students}`);
  }
  if (summary.assigned_count + summary.unassigned_count !== summary.total_students) {
    throw new Error("FAIL: Assigned + unassigned must equal total demand");
  }
  if (summary.total_sessions_available !== labs.length * 7) {
    throw new Error(`FAIL: Expected ${labs.length * 7} sessions, got ${summary.total_sessions_available}`);
  }

  console.log("✅ TEST 1 PASSED: Baseline 7-Slot Run preserves complete demand accounting!");

  console.log("\n[TEST 2] Determinism Verification (Consecutive Run)...");
  const res2 = await runAllocation({
    studentFile: new File([studentFileBuf], "students.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    labFile: new File([labBuf], "labs.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [], customSlots: undefined },
  });

  if (res1.payload.summary.assigned_count !== res2.payload.summary.assigned_count) {
    throw new Error(`FAIL: Inconsistent assigned count between consecutive runs`);
  }
  if (res1.payload.summary.unassigned_count !== res2.payload.summary.unassigned_count) {
    throw new Error(`FAIL: Inconsistent unassigned count between consecutive runs`);
  }

  console.log("✅ TEST 2 PASSED: Consecutive runs are 100% deterministic!");

  await runBatchSwitchingIsolationTests();
  await runOperationRequestsSyncTests();
  await runCustomBatchSlotsTests();
  await runMigrationWorkbookExportTests();
  await runRevocationTimestampTests();
  await runMultiSessionRecurringTrackTests();
  await runVpWorkflowPersistenceTests();
  await runPhysicalConsolidationTests();

  console.log("\n🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY!");
}

runRegressionSuite().catch((err) => {
  console.error("❌ REGRESSION TEST FAILED:", err);
  process.exit(1);
});

