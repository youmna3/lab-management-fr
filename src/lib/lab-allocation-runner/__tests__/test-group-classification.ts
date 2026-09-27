/**
 * Automated Test Suite: Group ID Classification & Multi-Visit Allocation Solver Integration
 *
 * Verifies:
 * 1. Backend storage persistence (save, fetch, auto-detection).
 * 2. Multi-visit group solver behavior: locks identical roster across N sessions,
 *    records Visit_Num 1..N with Repeat_Count N, and maintains exact capacity accounting.
 * 3. Single-visit group backwards compatibility.
 */

import * as XLSX from "xlsx";
import { runAllocation } from "../run";
import {
  saveBatchGroupClassifications,
  fetchBatchGroupClassifications,
  autoDetectBatchGroupClassifications,
} from "../../batch-group-classification-storage";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
}

async function runGroupClassificationTests() {
  console.log("------------------------------------------------------------");
  console.log("Starting Group Classification & Multi-Visit Allocation Tests");
  console.log("------------------------------------------------------------\n");

  const testBatchId = `test_batch_group_${Date.now()}`;

  // -------------------------------------------------------------------------
  // Test 1: Storage Persistence & Auto-Detection
  // -------------------------------------------------------------------------
  console.log("Test 1: Testing Backend Persistence & Auto-Detection...");

  const testClassifications = [
    {
      batch_id: testBatchId,
      group_id: "Physical-DS-G1",
      visit_type: "multi_visit" as const,
      repeat_count: 2,
      area: "مدينة نصر",
      grade: 4,
      student_count: 20,
    },
    {
      batch_id: testBatchId,
      group_id: "Physical-DS-G2",
      visit_type: "single_visit" as const,
      repeat_count: 1,
      area: "الدقي",
      grade: 4,
      student_count: 15,
    },
  ];

  const saved = await saveBatchGroupClassifications(testBatchId, "proj-1", testClassifications);
  assert(saved.length === 2, `Expected 2 saved records, got ${saved.length}`);

  const fetched = await fetchBatchGroupClassifications(testBatchId);
  assert(fetched.length === 2, `Expected 2 fetched records, got ${fetched.length}`);
  const g1 = fetched.find((c) => c.group_id === "Physical-DS-G1");
  assert(g1?.visit_type === "multi_visit", "Physical-DS-G1 must be multi_visit");
  assert(g1?.repeat_count === 2, "Physical-DS-G1 repeat_count must be 2");

  const g2 = fetched.find((c) => c.group_id === "Physical-DS-G2");
  assert(g2?.visit_type === "single_visit", "Physical-DS-G2 must be single_visit");
  assert(g2?.repeat_count === 1, "Physical-DS-G2 repeat_count must be 1");

  // Auto-detection test
  const detected = autoDetectBatchGroupClassifications(testBatchId, {
    expectedSessionsPerGroup: 3,
    masterAllocation: [
      { Group_ID: "Physical-DS-G3", "Physical Area": "المعادي", Grade: 5, S_ID: "S1" },
      { Group_ID: "Physical-DS-G3", "Physical Area": "المعادي", Grade: 5, S_ID: "S2" },
    ],
  });
  const g3 = detected.find((c) => c.group_id === "Physical-DS-G3");
  assert(g3?.visit_type === "multi_visit", "Auto-detected group with expectedSessionsPerGroup=3 must be multi_visit");
  assert(g3?.repeat_count === 3, "Auto-detected repeat_count must be 3");
  console.log("✓ Test 1: Storage persistence and auto-detection heuristics passed successfully.");

  // -------------------------------------------------------------------------
  // Test 2: Multi-Visit Group Solver Allocation
  // -------------------------------------------------------------------------
  console.log("\nTest 2: Testing Multi-Visit Group Solver Allocation...");

  // Create student dataset with 10 students in Dokki (Grade 4)
  const students: any[] = [];
  for (let i = 1; i <= 10; i++) {
    students.push({
      "Student ID": `STU-DOK-${String(i).padStart(3, "0")}`,
      Grade: 4,
      "Physical Area": "الدقي",
    });
  }

  const studentWs = XLSX.utils.json_to_sheet(students);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Students");
  const studentBuf = XLSX.write(studentWb, { type: "buffer", bookType: "xlsx" });
  const studentFile = new File([studentBuf], "students.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Lab with 15 capacity in Dokki (7 standard slots = 105 seats)
  const labs = [
    { "Lab ID": "LAB-DOK-01", Area: "الدقي", "Lab Capacity": 15 },
  ];
  const labWs = XLSX.utils.json_to_sheet(labs);
  const labWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(labWb, labWs, "Labs");
  const labBuf = XLSX.write(labWb, { type: "buffer", bookType: "xlsx" });
  const labFile = new File([labBuf], "labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Run with Multi-Visit preference: 2 visits for Dokki Grade 4
  const multiPrefs = {
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [],
    groupClassifications: [
      {
        group_id: "Physical-DS-G1",
        visit_type: "multi_visit" as const,
        repeat_count: 2,
        area: "الدقي",
        grade: 4,
      },
    ],
  };

  const output = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: multiPrefs,
  });

  const master = output.payload.master_allocation;
  assert(master.length === 20, `Multi-visit (2x) for 10 students must produce 20 master rows, got ${master.length}`);

  const visit1Rows = master.filter((r) => r.Visit_Num === 1);
  const visit2Rows = master.filter((r) => r.Visit_Num === 2);

  assert(visit1Rows.length === 10, `Visit 1 must have 10 student rows, got ${visit1Rows.length}`);
  assert(visit2Rows.length === 10, `Visit 2 must have 10 student rows, got ${visit2Rows.length}`);

  // Check that the exact same student IDs exist in both visits
  const visit1Sids = new Set(visit1Rows.map((r) => r.S_ID));
  const visit2Sids = new Set(visit2Rows.map((r) => r.S_ID));
  assert(visit1Sids.size === 10, "Visit 1 must contain 10 distinct students");
  for (const sid of visit1Sids) {
    assert(visit2Sids.has(sid), `Student ${sid} must be present in Visit 2`);
  }

  // Check that all rows have correct Visit_Type and Repeat_Count
  for (const r of master) {
    assert(r.Visit_Type === "multi_visit", "All rows must have Visit_Type = multi_visit");
    assert(r.Repeat_Count === 2, "All rows must have Repeat_Count = 2");
    assert(r.Lab_ID === "LAB-DOK-01", "All visits must be seated in the assigned lab LAB-DOK-01");
  }

  // Verify dashboard summary displays 10 assigned students
  const dashSummary = output.payload.dashboard_summary;
  const dokkiDash = dashSummary.find((r) => r["Physical Area"] === "الدقي");
  assert(dokkiDash?.["Grand Total"] === 10, `Grand Total must show 10 unique students, got ${dokkiDash?.["Grand Total"]}`);
  assert(dokkiDash?.Unassigned === 0, `Unassigned must be 0, got ${dokkiDash?.Unassigned}`);

  console.log("✓ Test 2: Multi-visit group solver allocation passed (exact roster locked across 2 sessions, 20 seat-visits, 10 unique assigned).");

  // -------------------------------------------------------------------------
  // Test 3: Single-Visit Group Behavior
  // -------------------------------------------------------------------------
  console.log("\nTest 3: Testing Single-Visit Group Default Behavior...");

  const singlePrefs = {
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [],
    groupClassifications: [
      {
        group_id: "Physical-DS-G1",
        visit_type: "single_visit" as const,
        repeat_count: 1,
        area: "الدقي",
        grade: 4,
      },
    ],
  };

  const singleOutput = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: singlePrefs,
  });

  const singleMaster = singleOutput.payload.master_allocation;
  assert(singleMaster.length === 10, `Single-visit for 10 students must produce 10 master rows, got ${singleMaster.length}`);
  for (const r of singleMaster) {
    assert(r.Visit_Num === 1, "Single-visit row must have Visit_Num = 1");
    assert(r.Visit_Type === "single_visit", "Single-visit row must have Visit_Type = single_visit");
    assert(r.Repeat_Count === 1, "Single-visit row must have Repeat_Count = 1");
  }

  console.log("✓ Test 3: Single-visit default behavior preserved perfectly.");

  console.log("\n------------------------------------------------------------");
  console.log("All Group Classification & Multi-Visit Tests Passed! ✓");
  console.log("------------------------------------------------------------\n");
}

runGroupClassificationTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
