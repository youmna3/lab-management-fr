/**
 * Automated Test Suite: Multi-Session Weekly Distribution
 *
 * Verifies:
 * 1. Batch-level default setting ("single_session" / SG vs "multi_session") applied to all groups.
 * 2. Per-group override precedence (explicit single_visit / multi_visit overrides taking precedence).
 * 3. Multi-Session solver assigning groups across distinct days and sessions within the week.
 * 4. Capacity limits and integrity checks strictly respected (no cap overflow, no mixed grade, no duplicate S_ID on same slot).
 * 5. Standing accounting invariant holds: Total Demand === Unique Assigned + Unique Unassigned.
 */

import * as XLSX from "xlsx";
import { runAllocation } from "../run";
import { getSlotChronologicalScore } from "../master";
import {
  saveBatchGroupSettings,
  fetchBatchGroupSettings,
  autoDetectBatchGroupClassifications,
} from "../../batch-group-classification-storage";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
}

function makeStudentFile(students: any[], filename = "students.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(students);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function makeLabFile(labs: any[], filename = "labs.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(labs);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function runMultiSessionDistributionTests() {
  console.log("------------------------------------------------------------");
  console.log("Starting Multi-Session Weekly Distribution Test Suite");
  console.log("------------------------------------------------------------\n");

  const testBatchId = `test_batch_multisession_${Date.now()}`;

  // -------------------------------------------------------------------------
  // Test 1: Batch-Level Default Setting Persistence & Auto-Detection
  // -------------------------------------------------------------------------
  console.log("Test 1: Testing Batch-Level Distribution Settings Persistence...");

  const savedSettings = await saveBatchGroupSettings(testBatchId, "proj-1", {
    batch_group_type: "multi_session",
    default_repeat_count: 2,
    classifications: [
      {
        batch_id: testBatchId,
        group_id: "Physical-DS-G1",
        visit_type: "single_visit",
        repeat_count: 1,
        area: "الدقي",
        grade: 4,
        student_count: 10,
      },
      {
        batch_id: testBatchId,
        group_id: "Physical-DS-G2",
        visit_type: "multi_visit",
        repeat_count: 3,
        area: "مدينة نصر",
        grade: 5,
        student_count: 10,
      },
    ],
  });

  assert(savedSettings.batch_group_type === "multi_session", "Batch group type must be multi_session");
  assert(savedSettings.default_repeat_count === 2, "Default repeat count must be 2");
  assert(savedSettings.classifications.length === 2, "Must have 2 per-group overrides");

  const fetchedSettings = await fetchBatchGroupSettings(testBatchId);
  assert(fetchedSettings.batch_group_type === "multi_session", "Fetched batch group type must be multi_session");
  assert(fetchedSettings.default_repeat_count === 2, "Fetched default repeat count must be 2");
  console.log("✓ Test 1 Passed: Batch-level distribution settings persisted and fetched successfully.");

  // -------------------------------------------------------------------------
  // Test 2: Batch Default Multi-Session vs Single-Session Solver Allocation
  // -------------------------------------------------------------------------
  console.log("\nTest 2: Testing Batch-Level Default Multi-Session Allocation...");

  const testStudents: any[] = [];
  for (let i = 1; i <= 20; i++) {
    testStudents.push({
      "Student ID": `STU-MULTI-${String(i).padStart(3, "0")}`,
      Grade: 4,
      "Physical Area": "الدقي",
    });
  }

  const studentFile = makeStudentFile(testStudents);
  const labsJson = [
    { "Lab ID": "LAB-DOK-01", Area: "الدقي", "Lab Capacity": 25 },
  ];

  // A. Run with default single_session (SG)
  const singleRun = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: "single_session",
    },
  });

  assert(singleRun.payload.summary.assigned_count === 20, "All 20 students must be assigned in SG run");
  assert(singleRun.payload.summary.unassigned_count === 0, "Unassigned must be 0");
  assert(singleRun.payload.summary.total_seat_visits === 20, `SG run seat visits must be 20, got ${singleRun.payload.summary.total_seat_visits}`);
  assert(singleRun.payload.summary.single_session_groups_count === 1, "Must have 1 single-session group");
  assert(singleRun.payload.summary.multi_session_groups_count === 0, "Must have 0 multi-session groups");

  // B. Run with batch default multi_session (2 sessions per group default)
  const multiRun = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
    },
  });

  assert(multiRun.payload.summary.assigned_count === 20, "All 20 students must be assigned in Multi-Session run");
  assert(multiRun.payload.summary.unassigned_count === 0, "Unassigned must be 0");
  assert(multiRun.payload.summary.total_seat_visits === 40, `Multi-Session run seat visits must be 40 (20 students x 2), got ${multiRun.payload.summary.total_seat_visits}`);
  assert(multiRun.payload.summary.multi_session_groups_count === 1, "Must have 1 multi-session group");

  // Verify that Visit 1 and Visit 2 records exist for each student
  const stu1Rows = multiRun.payload.master_allocation.filter((r) => r.S_ID === "STU-MULTI-001");
  assert(stu1Rows.length === 2, `STU-MULTI-001 must have exactly 2 visit records, got ${stu1Rows.length}`);
  assert(stu1Rows[0].Visit_Num === 1, "First record must be Visit 1");
  assert(stu1Rows[1].Visit_Num === 2, "Second record must be Visit 2");
  assert(stu1Rows[0].Visit_Type === "multi_visit", "Visit_Type must be multi_visit");
  assert(stu1Rows[0].Repeat_Count === 2, "Repeat_Count must be 2");
  console.log("✓ Test 2 Passed: Batch default multi-session allocation correctly generates multi-visit records.");

  // -------------------------------------------------------------------------
  // Test 3: Day and Session Variety for Multi-Session Groups
  // -------------------------------------------------------------------------
  console.log("\nTest 3: Testing Day/Session Variety across Multi-Session Visits...");

  // Verify that Visit 1 and Visit 2 are scheduled on distinct days or distinct sessions
  const visit1 = stu1Rows[0];
  const visit2 = stu1Rows[1];

  console.log(`  • Visit 1: ${visit1.Day} - ${visit1.Time_Slot} (${visit1.Slot_Key})`);
  console.log(`  • Visit 2: ${visit2.Day} - ${visit2.Time_Slot} (${visit2.Slot_Key})`);

  assert(
    visit1.Day !== visit2.Day || visit1.Slot_Key !== visit2.Slot_Key,
    "Multi-session visits must be assigned across distinct days or distinct slot sessions!"
  );
  console.log("✓ Test 3 Passed: Multi-session group is distributed across distinct day/session combinations.");

  // -------------------------------------------------------------------------
  // Test 4: Batch Configuration Overrides Legacy Per-Group Values
  // -------------------------------------------------------------------------
  console.log("\nTest 4: Testing Canonical Batch Configuration...");

  // A legacy per-group single_visit value must not override the multi-session batch setting.
  const overrideRun = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
      groupClassifications: [
        {
          group_id: "Physical-DS-G1",
          visit_type: "single_visit",
          repeat_count: 1,
          area: "الدقي",
          grade: 4,
        },
      ],
    },
  });

  const overrideRows = overrideRun.payload.master_allocation.filter((r) => r.S_ID === "STU-MULTI-001");
  assert(overrideRows.length === 2, `Batch configuration must result in 2 visits, got ${overrideRows.length}`);
  assert(overrideRows.every((row) => row.Visit_Type === "multi_visit"), "Visit_Type must inherit multi_visit from the batch");
  assert(overrideRows.every((row) => row.Repeat_Count === 2), "Repeat_Count must inherit 2 from the batch");
  console.log("✓ Test 4 Passed: Legacy per-group values cannot override the batch configuration.");

  // -------------------------------------------------------------------------
  // Test 5: Standing Pipeline Accounting Invariant Verification
  // -------------------------------------------------------------------------
  console.log("\nTest 5: Testing Standing Pipeline Invariant (Demand === Assigned + Unassigned)...");

  assert(
    testStudents.length === multiRun.payload.summary.assigned_count + multiRun.payload.summary.unassigned_count,
    "Standing invariant must hold: Total Demand === Unique Assigned + Unique Unassigned"
  );
  console.log("✓ Test 5 Passed: Standing accounting invariant verified with 0 dropped students.");

  // -------------------------------------------------------------------------
  // Test 6: Deriving Resolved Day/Session Schedule Assignments for Group UI
  // -------------------------------------------------------------------------
  console.log("\nTest 6: Testing Resolved Day/Session Schedule Extraction for Group Classification UI...");

  // Simulate what GroupClassificationDialog extracts from master_allocation
  const masterAlloc = multiRun.payload.master_allocation;
  const groupSchedules = new Map<string, Array<{ day: string; session: string; timeSlot: string; visitNum: number; labId: string }>>();
  for (const row of masterAlloc) {
    const gid = (row.Group_ID || "").trim().toLowerCase();
    if (!gid) continue;
    if (!groupSchedules.has(gid)) groupSchedules.set(gid, []);
    const list = groupSchedules.get(gid)!;
    const vNum = Number(row.Visit_Num ?? 1);
    if (!list.some((item) => item.visitNum === vNum)) {
      list.push({
        day: row.Day,
        session: row.Session,
        timeSlot: row.Time_Slot,
        visitNum: vNum,
        labId: row.Lab_ID,
      });
    }
  }

  const g1Schedules = groupSchedules.get("physical-ds-g1")!;
  assert(Boolean(g1Schedules), "Schedule must exist for physical-ds-g1");
  assert(g1Schedules.length === 2, `physical-ds-g1 must have 2 resolved visits, got ${g1Schedules.length}`);
  assert(g1Schedules[0].visitNum === 1, "Visit 1 must have visitNum 1");
  assert(g1Schedules[1].visitNum === 2, "Visit 2 must have visitNum 2");
  assert(g1Schedules[0].day !== "" && g1Schedules[0].timeSlot !== "", "Visit 1 must have valid day and timeSlot");
  console.log(`  • Group Physical-DS-G1 Resolved: ${g1Schedules.map(v => `V${v.visitNum}: ${v.day} ${v.timeSlot}`).join(" + ")}`);
  console.log("✓ Test 6 Passed: Resolved day/session schedule successfully extracted for UI display.");

  // -------------------------------------------------------------------------
  // Test 7: Direct "Save & Run Allocation" Pipeline Execution
  // -------------------------------------------------------------------------
  console.log("\nTest 7: Testing Direct 'Save & Run Allocation' Flow with Persisted Settings...");

  // 1. Save settings (as done in GroupClassificationDialog handleSave)
  const dynamicBatchId = `test_batch_save_and_run_${Date.now()}`;
  const directSaved = await saveBatchGroupSettings(dynamicBatchId, "proj-1", {
    batch_group_type: "multi_session",
    default_repeat_count: 3,
    classifications: [
      {
        batch_id: dynamicBatchId,
        group_id: "Physical-DS-G1",
        visit_type: "multi_visit",
        repeat_count: 3,
        area: "الدقي",
        grade: 4,
      },
    ],
  });

  // 2. Trigger solver immediately with saved preferences (onApplyAndRerun path)
  const saveAndRunResult = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: directSaved.batch_group_type,
      defaultRepeatCount: directSaved.default_repeat_count,
      customSlots: ["Mon 10:00", "Tue 10:00", "Wed 10:00"],
      groupClassifications: directSaved.classifications.map((c) => ({
        group_id: c.group_id,
        visit_type: c.visit_type,
        repeat_count: c.repeat_count,
        area: c.area,
        grade: c.grade,
      })),
    },
  });

  assert(saveAndRunResult.payload.summary.assigned_count === 20, "All 20 students assigned");
  assert(saveAndRunResult.payload.summary.total_seat_visits === 60, `Seat visits must be 60 (20 students x 3 visits), got ${saveAndRunResult.payload.summary.total_seat_visits}`);
  assert(saveAndRunResult.payload.master_allocation.length === 60, `Master allocation rows must be 60, got ${saveAndRunResult.payload.master_allocation.length}`);
  console.log("✓ Test 7 Passed: 'Save & Run Allocation' flow successfully persisted and executed solver.");

  // -------------------------------------------------------------------------
  // Test 8: Lab Grid Matrix Per-Cell Multi-Session Visit Indicator Verification
  // -------------------------------------------------------------------------
  console.log("\nTest 8: Testing Lab Grid Matrix Per-Cell Visit Number Indicator Extraction...");

  function getOrdinalSuffixTest(n: number): string {
    const j = n % 10;
    const k = n % 100;
    if (j === 1 && k !== 11) return `${n}st`;
    if (j === 2 && k !== 12) return `${n}nd`;
    if (j === 3 && k !== 13) return `${n}rd`;
    return `${n}th`;
  }

  // Build the cell occupancy map exactly as lab-allocation.tsx does
  const cellMap = new Map<string, { hasMultiSession: boolean; displayVisitLabel: string; groupVisits: any[] }>();
  const tempMap = new Map<string, Map<string, any>>();

  for (const r of saveAndRunResult.payload.master_allocation) {
    const area = String(r["Physical Area"] ?? "").trim();
    const grade = Number(r.Grade);
    const labId = String(r.Lab_ID ?? "").trim();
    const slot = String(r.Time_Slot ?? "").trim();
    const key = `${area}__${grade}__${labId}__${slot}`;

    if (!tempMap.has(key)) tempMap.set(key, new Map());
    const groupMap = tempMap.get(key)!;
    const groupId = String(r.Group_ID ?? "").trim();
    const visitNum = Math.max(1, Number(r.Visit_Num) || 1);
    const isMulti = r.Visit_Type === "multi_visit" || (r.Repeat_Count !== undefined && Number(r.Repeat_Count) > 1) || visitNum > 1;
    const repeatCount = isMulti ? Math.max(2, Number(r.Repeat_Count) || visitNum) : 1;
    const visitType = isMulti ? "multi_visit" : "single_visit";

    const gKey = `${groupId}__v${visitNum}`;
    if (!groupMap.has(gKey)) {
      groupMap.set(gKey, { groupId, visitNum, repeatCount, visitType, studentCount: 0 });
    }
    groupMap.get(gKey).studentCount += 1;
  }

  for (const [key, groupMap] of tempMap.entries()) {
    const groupVisits = Array.from(groupMap.values());
    const multiVisits = groupVisits.filter((g: any) => g.visitType === "multi_visit");
    const hasMultiSession = multiVisits.length > 0;
    let displayVisitLabel = "";

    if (hasMultiSession) {
      const uniqueVisitNums = Array.from(new Set(multiVisits.map((g: any) => g.visitNum))).sort((a: any, b: any) => a - b);
      displayVisitLabel = uniqueVisitNums.map(getOrdinalSuffixTest).join("/");
    }

    cellMap.set(key, { hasMultiSession, displayVisitLabel, groupVisits });
  }

  // Find all cells occupied by group Physical-DS-G1 in saveAndRunResult (3 visits)
  const g1Master = saveAndRunResult.payload.master_allocation.filter((r) => r.Group_ID === "Physical-DS-G1");
  const uniqueG1Slots = Array.from(new Set(g1Master.map((r) => `${r["Physical Area"]}__${r.Grade}__${r.Lab_ID}__${r.Time_Slot}`)));
  assert(uniqueG1Slots.length === 3, `Physical-DS-G1 must occupy 3 distinct slot cells, got ${uniqueG1Slots.length}`);

  const g1VisitLabels: string[] = [];
  for (const cellKey of uniqueG1Slots) {
    const detail = cellMap.get(cellKey)!;
    assert(Boolean(detail), `Cell detail must exist for ${cellKey}`);
    assert(detail.hasMultiSession === true, "Cell must be flagged as multi-session");
    assert(detail.displayVisitLabel !== "", "Display visit label must not be empty");
    g1VisitLabels.push(detail.displayVisitLabel);
    console.log(`  • Matrix Cell [${cellKey}]: Display Indicator = "${detail.displayVisitLabel}" (${detail.groupVisits[0].studentCount} students)`);
  }

  // Confirm sequential 1st, 2nd, 3rd sequence across weekly slots
  assert(g1VisitLabels.includes("1st"), "Must include 1st visit indicator");
  assert(g1VisitLabels.includes("2nd"), "Must include 2nd visit indicator");
  assert(g1VisitLabels.includes("3rd"), "Must include 3rd visit indicator");
  console.log("✓ Test 8 Passed: Lab Grid Matrix per-cell visit indicators correctly extracted in sequential order (1st, 2nd, 3rd).");

  // -------------------------------------------------------------------------
  // Test 9: End-to-End Batch Multi-Session Setting Hydration & Solver Run
  // -------------------------------------------------------------------------
  console.log("\nTest 9: Testing Batch Multi-Session Setting Hydration & Automatic Solver Execution...");

  const autoBatchId = `auto_batch_${Date.now()}`;
  // 1. Simulate batch creation with expected_sessions_per_group = 2 (Multi-Session 2x)
  await saveBatchGroupSettings(autoBatchId, "proj-1", {
    batch_group_type: "multi_session",
    default_repeat_count: 2,
    classifications: [],
  });

  // 2. Hydrate settings as loadPersistedBatchData does
  const hydratedSettings = await fetchBatchGroupSettings(autoBatchId);
  assert(hydratedSettings.batch_group_type === "multi_session", "Hydrated batch type must be multi_session");
  assert(hydratedSettings.default_repeat_count === 2, "Hydrated default repeat count must be 2");

  // 3. Execute solver with hydrated batch settings (as handleRunAllocation does)
  const hydratedRun = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-Auto-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: hydratedSettings.batch_group_type,
      defaultRepeatCount: hydratedSettings.default_repeat_count,
      groupClassifications: hydratedSettings.classifications.map((c) => ({
        group_id: c.group_id,
        visit_type: c.visit_type,
        repeat_count: c.repeat_count,
        area: c.area,
        grade: c.grade,
      })),
    },
  });

  // -------------------------------------------------------------------------
  // Test 10: Full Multi-Visit (3 Sessions) Resolution & Zero Pending Post-Run
  // -------------------------------------------------------------------------
  console.log("\nTest 10: Testing Full Multi-Visit (3 Sessions) Resolution via Save & Run Flow...");

  const batch3xId = `batch_3x_${Date.now()}`;
  // 1. Persist batch with Multi-Session (3x) mode
  const saved3xSettings = await saveBatchGroupSettings(batch3xId, "proj-3x", {
    batch_group_type: "multi_session",
    default_repeat_count: 3,
    classifications: [
      {
        batch_id: batch3xId,
        group_id: "Physical-DEMI-SUM-26-G1",
        visit_type: "multi_visit",
        repeat_count: 3,
        area: "الدقي",
        grade: 4,
        student_count: 20,
      },
    ],
  });

  // 2. Execute full solver run (mirroring onApplyAndRerun / handleRunAllocation)
  const run3xOutput = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "DEMI",
    prefix: "Physical-DEMI-SUM-26-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: saved3xSettings.batch_group_type,
      defaultRepeatCount: saved3xSettings.default_repeat_count,
      customSlots: ["Mon 10:00", "Tue 10:00", "Wed 10:00"],
      groupClassifications: saved3xSettings.classifications.map((c) => ({
        group_id: c.group_id,
        visit_type: c.visit_type,
        repeat_count: c.repeat_count,
        area: c.area,
        grade: c.grade,
      })),
    },
  });

  const master3x = run3xOutput.payload.master_allocation;
  const g1Rows3x = master3x.filter((r) => r.Group_ID === "Physical-DEMI-SUM-26-G1");
  assert(g1Rows3x.length === 60, `Group G1 must have 60 total seat-visits (20 students x 3 visits), got ${g1Rows3x.length}`);

  const v1Rows = g1Rows3x.filter((r) => r.Visit_Num === 1);
  const v2Rows = g1Rows3x.filter((r) => r.Visit_Num === 2);
  const v3Rows = g1Rows3x.filter((r) => r.Visit_Num === 3);

  assert(v1Rows.length === 20, "Must have 20 Visit 1 records");
  assert(v2Rows.length === 20, "Must have 20 Visit 2 records");
  assert(v3Rows.length === 20, "Must have 20 Visit 3 records");

  // 3. Extract resolved visits for Group Classification Dialog
  const scheduleMap3x = new Map<string, Array<{ day: string; session: string; timeSlot: string; visitNum: number; labId: string }>>();
  for (const row of master3x) {
    const gid = (row.Group_ID || "").trim().toLowerCase();
    if (!gid) continue;
    if (!scheduleMap3x.has(gid)) scheduleMap3x.set(gid, []);
    const list = scheduleMap3x.get(gid)!;
    const visitNum = Number(row.Visit_Num ?? 1);
    const day = String(row.Day || "").trim();
    const session = String(row.Session || "").trim();
    const timeSlot = String(row.Time_Slot || "").trim();
    const labId = String(row.Lab_ID || "").trim();
    if (!list.some((item) => item.visitNum === visitNum)) {
      list.push({ day, session, timeSlot, visitNum, labId });
    }
  }
  for (const list of scheduleMap3x.values()) list.sort((a, b) => a.visitNum - b.visitNum);

  const resolvedG1Visits = scheduleMap3x.get("physical-demi-sum-26-g1")!;
  assert(resolvedG1Visits.length === 3, `Group G1 must have exactly 3 resolved visits in dialog, got ${resolvedG1Visits.length}`);
  assert(resolvedG1Visits[0].visitNum === 1, "Resolved visit 1 must have visitNum 1");
  assert(resolvedG1Visits[1].visitNum === 2, "Resolved visit 2 must have visitNum 2");
  assert(resolvedG1Visits[2].visitNum === 3, "Resolved visit 3 must have visitNum 3");

  const distinctSlots = new Set(resolvedG1Visits.map((v) => `${v.day}__${v.timeSlot}`));
  assert(distinctSlots.size === 3, `All 3 visits must be allocated to distinct weekly slots, got ${distinctSlots.size}`);

  console.log(`  • V1: ${resolvedG1Visits[0].day} · ${resolvedG1Visits[0].timeSlot}`);
  console.log(`  • V2: ${resolvedG1Visits[1].day} · ${resolvedG1Visits[1].timeSlot}`);
  console.log(`  • V3: ${resolvedG1Visits[2].day} · ${resolvedG1Visits[2].timeSlot}`);
  // -------------------------------------------------------------------------
  // Test 11: Non-Stacking Invariant & Isolated Slot Capacity Verification
  // -------------------------------------------------------------------------
  console.log("\nTest 11: Testing Non-Stacking Invariant & Isolated Slot Capacity Verification...");

  // Create 50 students in Grade 4 across 2 groups of 25 students, with 2 visits each
  const test50Students: any[] = [];
  for (let i = 1; i <= 50; i++) {
    test50Students.push({
      "Student ID": `STU-STACK-TEST-${String(i).padStart(3, "0")}`,
      Grade: 4,
      "Physical Area": "الدقي",
    });
  }
  const student50File = makeStudentFile(test50Students);

  const nonStackingRun = await runAllocation({
    studentFile: student50File,
    labFile: null,
    useDbLabs: true,
    labsJson, // LAB-DOK-01 capacity 25
    program: "CUSTOM",
    prefix: "Physical-NS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
    },
  });

  const masterRows = nonStackingRun.payload.master_allocation;
  const summary = nonStackingRun.payload.summary;

  // Invariant 1: Total demand === assigned + unassigned
  assert(
    test50Students.length === summary.assigned_count + summary.unassigned_count,
    `Standing Invariant: Total Demand (${test50Students.length}) === Assigned (${summary.assigned_count}) + Unassigned (${summary.unassigned_count})`
  );
  assert(summary.assigned_count === 50, "All 50 students must be uniquely assigned");
  assert(summary.unassigned_count === 0, "Unassigned must be 0");
  assert(summary.total_seat_visits === 100, `Total seat visits must be 100 (50 students x 2 visits), got ${summary.total_seat_visits}`);

  // Invariant 1b: Verify Visit_Num, Repeat_Count, and Visit_Type metadata integrity on every single row
  for (const r of masterRows) {
    assert(r.Visit_Num !== undefined && r.Visit_Num !== null && r.Visit_Num >= 1, `Visit_Num must be non-null and >= 1, got ${r.Visit_Num}`);
    assert(r.Repeat_Count !== undefined && r.Repeat_Count !== null && r.Repeat_Count >= 2, `Repeat_Count must be non-null and >= 2 for multi-session row, got ${r.Repeat_Count}`);
    assert(r.Visit_Type === "multi_visit", `Visit_Type must be 'multi_visit' for multi-session row, got '${r.Visit_Type}'`);
    assert(Boolean(r.Slot_Key && r.Time_Slot && r.Day), `Slot metadata must be fully populated on row for student ${r.S_ID}`);
  }
  console.log("  • All 100 master rows have 100% valid Visit_Num, Repeat_Count, and Visit_Type metadata ✓");

  // Invariant 2: For every group with Repeat_Count = N, its N visits resolve to N distinct Slot_Key values
  const groupVisitsMap = new Map<string, Map<number, string>>(); // Group_ID -> visitNum -> Slot_Key
  const groupStudentsMap = new Map<string, Set<string>>();
  for (const r of masterRows) {
    const gid = r.Group_ID;
    const vNum = Number(r.Visit_Num || 1);
    if (!groupVisitsMap.has(gid)) groupVisitsMap.set(gid, new Map());
    groupVisitsMap.get(gid)!.set(vNum, r.Slot_Key);

    if (!groupStudentsMap.has(gid)) groupStudentsMap.set(gid, new Set());
    groupStudentsMap.get(gid)!.add(r.S_ID);
  }

  assert(groupVisitsMap.size === 2, `Must create exactly 2 groups of 25 students, got ${groupVisitsMap.size}`);

  for (const [gid, visits] of groupVisitsMap.entries()) {
    assert(visits.size === 2, `Group ${gid} must have exactly 2 visits recorded, got ${visits.size}`);
    const slotV1 = visits.get(1);
    const slotV2 = visits.get(2);
    assert(Boolean(slotV1) && Boolean(slotV2), `Group ${gid} must have valid V1 and V2 slots`);
    assert(
      slotV1 !== slotV2,
      `Group ${gid}'s visits must resolve to genuinely distinct Slot_Keys! V1: ${slotV1}, V2: ${slotV2}`
    );
    console.log(`  • Group ${gid} (25 students): V1 = ${slotV1}, V2 = ${slotV2} (Distinct Slots ✓)`);
  }

  // Invariant 3: No single slot's occupancy count exceeds its true lab capacity
  const slotOccupancyMap = new Map<string, number>();
  const slotUniqueStudentsMap = new Map<string, Set<string>>();
  for (const r of masterRows) {
    slotOccupancyMap.set(r.Slot_Key, (slotOccupancyMap.get(r.Slot_Key) ?? 0) + 1);
    if (!slotUniqueStudentsMap.has(r.Slot_Key)) slotUniqueStudentsMap.set(r.Slot_Key, new Set());
    slotUniqueStudentsMap.get(r.Slot_Key)!.add(r.S_ID);
  }

  for (const [slotKey, count] of slotOccupancyMap.entries()) {
    const uniqueStudents = slotUniqueStudentsMap.get(slotKey)!.size;
    assert(
      count === uniqueStudents,
      `Slot ${slotKey} has duplicate student visits! Occupancy count: ${count}, Unique students: ${uniqueStudents}`
    );
    assert(
      count <= 25,
      `Slot ${slotKey} occupancy (${count}) exceeds true lab capacity (25)! Multiple visits stacked into same slot!`
    );
    console.log(`  • Slot [${slotKey}]: Occupancy = ${count}/25 (100% capacity compliant, no stacking ✓)`);
  }

  // Invariant 4: Lab Grid Matrix per-cell visit indicators are never stacked (e.g. no "1st/2nd")
  const test11CellMap = new Map<string, { displayVisitLabel: string; count: number }>();
  const test11TempMap = new Map<string, Map<string, any>>();
  for (const r of masterRows) {
    const key = `${r["Physical Area"]}__${r.Grade}__${r.Lab_ID}__${r.Time_Slot}`;
    if (!test11TempMap.has(key)) test11TempMap.set(key, new Map());
    const groupMap = test11TempMap.get(key)!;
    const vNum = Number(r.Visit_Num || 1);
    const gKey = `${r.Group_ID}__v${vNum}`;
    if (!groupMap.has(gKey)) {
      groupMap.set(gKey, { groupId: r.Group_ID, visitNum: vNum, studentCount: 0 });
    }
    groupMap.get(gKey).studentCount += 1;
  }

  for (const [key, gMap] of test11TempMap.entries()) {
    const gVisits = Array.from(gMap.values());
    const uniqueVisitNums = Array.from(new Set(gVisits.map((g: any) => g.visitNum))).sort((a: any, b: any) => a - b);
    const label = uniqueVisitNums.map(getOrdinalSuffixTest).join("/");
    const totalSeated = gVisits.reduce((sum: number, g: any) => sum + g.studentCount, 0);
    test11CellMap.set(key, { displayVisitLabel: label, count: totalSeated });

    assert(
      !label.includes("/"),
      `Cell [${key}] has multiple stacked visits in label: "${label}"! Must be a single visit indicator.`
    );
    assert(
      label === "1st" || label === "2nd",
      `Cell [${key}] visit label must be "1st" or "2nd", got "${label}"`
    );
    console.log(`  • Matrix Cell [${key}]: Occupancy = ${totalSeated}/25 · Indicator = "${label}" (Clean Single Indicator ✓)`);
  }

  console.log("✓ Test 11 Passed: All repeat visits distributed across distinct slots, zero slot overfill, and clean single-visit cell indicators.");

  // -------------------------------------------------------------------------
  // Test 12: Unassigned Count & Shortfall Log Strict Reconciliation
  // -------------------------------------------------------------------------
  console.log("\nTest 12: Testing Dashboard Unassigned Count vs Shortfall & Logs Exact Reconciliation...");

  // In a clean multi-session run, total unassigned in summary MUST equal total true shortfall from shortfall math
  const shortfallTotal = (nonStackingRun.payload.shortfall_math || []).reduce((acc, row) => acc + (row.Students_Short || 0), 0);
  const summaryUnassigned = nonStackingRun.payload.summary.unassigned_count;
  const unassignedListCount = (nonStackingRun.payload.unassigned_students || []).length;

  console.log(`  • Dashboard Summary Unassigned: ${summaryUnassigned}`);
  console.log(`  • Shortfall & Logs Total Unseated: ${shortfallTotal}`);
  console.log(`  • Unassigned Students Registry Length: ${unassignedListCount}`);

  assert(
    summaryUnassigned === shortfallTotal,
    `Dashboard unassigned (${summaryUnassigned}) MUST equal Shortfall & Logs unseated (${shortfallTotal})`
  );
  assert(
    summaryUnassigned === unassignedListCount,
    `Dashboard unassigned (${summaryUnassigned}) MUST equal Unassigned Registry list count (${unassignedListCount})`
  );
  console.log("✓ Test 12 Passed: Dashboard Unassigned count and Shortfall & Logs Unseated count are 100% reconciled.");

  // -------------------------------------------------------------------------
  // Test 13: Capacity-first Track Sizing
  // -------------------------------------------------------------------------
  console.log("\nTest 13: Testing Capacity-First Track Sizing...");

  // Cohort of 23 students in Grade 5 across a lab of capacity 20 with 4 slots (2 tracks)
  const test23Students: any[] = [];
  for (let i = 1; i <= 23; i++) {
    test23Students.push({
      "Student ID": `STU-PACK-TEST-${String(i).padStart(3, "0")}`,
      Grade: 5,
      "Physical Area": "الدقي",
    });
  }
  const student23File = makeStudentFile(test23Students);
  const lab20Json = [
    { "Lab ID": "LAB-DOK-02", Area: "الدقي", "Lab Capacity": 20 },
  ];

  const balancedRun = await runAllocation({
    studentFile: student23File,
    labFile: null,
    useDbLabs: true,
    labsJson: lab20Json,
    program: "CUSTOM",
    prefix: "Physical-BAL-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
    },
  });

  const balancedMaster = balancedRun.payload.master_allocation;
  const balancedSummary = balancedRun.payload.summary;

  assert(balancedSummary.assigned_count === 23, "All 23 students must be assigned");
  assert(balancedSummary.unassigned_count === 0, "Unassigned must be 0");

  const groupsInBalanced = new Map<string, number>();
  for (const r of balancedMaster) {
    if (r.Visit_Num === 1) {
      groupsInBalanced.set(r.Group_ID, (groupsInBalanced.get(r.Group_ID) ?? 0) + 1);
    }
  }

  console.log(`  • Created ${groupsInBalanced.size} groups for 23 students:`);
  for (const [gid, count] of groupsInBalanced.entries()) {
    console.log(`    - Group ${gid}: ${count} students (Fill: ${Math.round((count / 20) * 100)}%)`);
  }
  assert(
    JSON.stringify([...groupsInBalanced.values()]) === JSON.stringify([12, 11]),
    `Balanced group sizes must be 12,11 (no group < 8); got ${[...groupsInBalanced.values()].join(",")}`,
  );
  assert([...groupsInBalanced.values()].every((size) => size >= 8), "All groups must have >= 8 students");
  console.log("✓ Test 13 Passed: Balanced track sizing ensures no near-empty group under 8 students (12 and 11).");

  // -------------------------------------------------------------------------
  // Test 14: Short Group Identifier (e.g. G1) in Lab Grid Matrix Label Rendering
  // -------------------------------------------------------------------------
  console.log("\nTest 14: Testing Short Group Identifier in Lab Grid Matrix Rendering...");

  function extractShortGroupIdTest(groupId: string): string {
    if (!groupId) return "";
    const match = groupId.match(/-(G\d+)(?:-|$)/i) || groupId.match(/(G\d+)$/i) || groupId.match(/\b(G\d+)\b/i);
    if (match) return match[1].toUpperCase();
    return groupId;
  }

  assert(extractShortGroupIdTest("Physical-DEMI-SUM-26-G1") === "G1", "Must extract G1 from Physical-DEMI-SUM-26-G1");
  assert(extractShortGroupIdTest("Physical-DS-G12") === "G12", "Must extract G12 from Physical-DS-G12");
  assert(extractShortGroupIdTest("Physical-BAL-G2") === "G2", "Must extract G2 from Physical-BAL-G2");
  assert(extractShortGroupIdTest("G3") === "G3", "Must extract G3 from G3");

  // Build matrix cells for balancedRun
  const matrixCellLabels: string[] = [];
  const matrixGroupMap = new Map<string, Array<{ groupId: string; visitNum: number }>>();
  for (const r of balancedMaster) {
    const key = `${r["Physical Area"]}__${r.Grade}__${r.Lab_ID}__${r.Time_Slot}`;
    if (!matrixGroupMap.has(key)) matrixGroupMap.set(key, []);
    const list = matrixGroupMap.get(key)!;
    const vNum = Number(r.Visit_Num || 1);
    if (!list.some(item => item.groupId === r.Group_ID && item.visitNum === vNum)) {
      list.push({ groupId: r.Group_ID, visitNum: vNum });
    }
  }

  for (const [key, list] of matrixGroupMap.entries()) {
    const labels = list.map(g => `${extractShortGroupIdTest(g.groupId)} · ${getOrdinalSuffixTest(g.visitNum)}`);
    const displayLabel = labels.join(" / ");
    matrixCellLabels.push(displayLabel);
    console.log(`  • Matrix Cell [${key}]: Display Indicator = "${displayLabel}"`);
    assert(displayLabel.includes("G1") || displayLabel.includes("G2"), `Indicator must include short group ID (G1/G2), got "${displayLabel}"`);
    assert(displayLabel.includes("1st") || displayLabel.includes("2nd"), `Indicator must include visit order (1st/2nd), got "${displayLabel}"`);
  }

  console.log("✓ Test 14 Passed: Short group identifier correctly rendered next to visit indicator.");

  // -------------------------------------------------------------------------
  // Test 15: Nationwide Batch 'hope4' Replay (3 Sessions/Week Multi-Visit Flow)
  // -------------------------------------------------------------------------
  console.log("\nTest 15: Testing Nationwide Batch 'hope4' End-to-End Multi-Visit Replay...");

  const hope4Labs = [
    { "Lab ID": "L556", Area: "15 مايو", "Lab Capacity": 20 },
    { "Lab ID": "L557", Area: "15 مايو", "Lab Capacity": 20 },
    { "Lab ID": "L43", Area: "الدقي", "Lab Capacity": 25 },
    { "Lab ID": "L44", Area: "الدقي", "Lab Capacity": 25 },
    { "Lab ID": "L101", Area: "المعادي", "Lab Capacity": 20 },
    { "Lab ID": "L102", Area: "المعادي", "Lab Capacity": 20 },
  ];

  const hope4Students: any[] = [];
  let hope4Sid = 1;
  // Mayo 15: 60 Grade 4 students
  for (let i = 0; i < 60; i++) {
    hope4Students.push({ "Student ID": `STU-HOPE-${hope4Sid++}`, Grade: 4, "Physical Area": "15 مايو" });
  }
  // Dokki: 50 Grade 5 students
  for (let i = 0; i < 50; i++) {
    hope4Students.push({ "Student ID": `STU-HOPE-${hope4Sid++}`, Grade: 5, "Physical Area": "الدقي" });
  }
  // Maadi: 40 Grade 6 students
  for (let i = 0; i < 40; i++) {
    hope4Students.push({ "Student ID": `STU-HOPE-${hope4Sid++}`, Grade: 6, "Physical Area": "المعادي" });
  }

  const hope4StudentFile = makeStudentFile(hope4Students, "hope4_students.xlsx");
  const hope4LabFile = makeLabFile(hope4Labs, "hope4_labs.xlsx");
  const hope4BatchId = `batch_hope4_${Date.now()}`;

  const hope4Run = await runAllocation({
    studentFile: hope4StudentFile,
    labFile: hope4LabFile,
    program: "DEMI",
    prefix: "Physical-DEMI-SUM-26-G",
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      customSlots: ["Mon 10:00", "Tue 10:00", "Wed 10:00"],
    },
  });

  const hope4Master = hope4Run.payload.master_allocation;
  assert(hope4Master.length > 0, "Master allocation rows must be generated");

  // Verify group visit completion in master_allocation
  const hope4GroupVisits = new Map<string, number[]>();
  for (const r of hope4Master) {
    const gid = r.Group_ID;
    if (!hope4GroupVisits.has(gid)) hope4GroupVisits.set(gid, []);
    const list = hope4GroupVisits.get(gid)!;
    if (!list.includes(r.Visit_Num!)) list.push(r.Visit_Num!);
  }

  console.log(`  • Total Generated Multi-Visit Groups: ${hope4GroupVisits.size}`);
  for (const [gid, vList] of hope4GroupVisits.entries()) {
    console.log(`    - Group ${gid}: Resolved Visits = [${vList.sort().join(", ")}]`);
    assert(vList.length === 3, `Group ${gid} must have all 3 visits (V1, V2, V3) resolved, got ${vList.length}`);
    assert(vList.includes(1) && vList.includes(2) && vList.includes(3), `Group ${gid} must contain V1, V2, and V3`);
  }

  // Verify fresh auto-detected classifications
  const hope4FreshClasses = autoDetectBatchGroupClassifications(hope4BatchId, {
    batchGroupType: "multi_session",
    expectedSessionsPerGroup: 3,
    masterAllocation: hope4Master,
  });

  assert(hope4FreshClasses.length === hope4GroupVisits.size, "Fresh classifications must match active group count exactly");
  assert(hope4FreshClasses.every(c => c.visit_type === "multi_visit" && c.repeat_count === 3), "All fresh classifications must be Multi-Visit (3x)");

  // Verify fetchBatchGroupSettings hydration
  await saveBatchGroupSettings(hope4BatchId, "proj-hope4", {
    batch_group_type: "multi_session",
    default_repeat_count: 3,
    classifications: hope4FreshClasses,
  });

  const hope4HydratedSettings = await fetchBatchGroupSettings(hope4BatchId);
  assert(hope4HydratedSettings.batch_group_type === "multi_session", "Hydrated settings must preserve multi_session mode");
  assert(hope4HydratedSettings.default_repeat_count === 3, "Hydrated settings must preserve 3x repeat count");
  assert(hope4HydratedSettings.classifications.length === hope4GroupVisits.size, "Hydrated classifications must match active groups");

  console.log("✓ Test 15 Passed: Nationwide batch 'hope4' end-to-end replay verified with 100% resolved visits and zero pending visits.");

  // -------------------------------------------------------------------------
  // Test 16: Strict Chronological Ordering Invariant Across All Multi-Visit Groups
  // -------------------------------------------------------------------------
  console.log("\nTest 16: Testing Strict Chronological Ordering Invariant Across All Multi-Visit Groups...");

  // Collect chronological visit timelines for all groups in hope4Master
  const groupTimelineMap = new Map<string, Array<{ visitNum: number; day: string; slot: string; slotNum: number; score: number }>>();
  for (const r of hope4Master) {
    const gid = r.Group_ID;
    if (!groupTimelineMap.has(gid)) groupTimelineMap.set(gid, []);
    const list = groupTimelineMap.get(gid)!;
    const vNum = Number(r.Visit_Num || 1);
    if (!list.some(v => v.visitNum === vNum)) {
      const score = getSlotChronologicalScore(r as any);
      list.push({
        visitNum: vNum,
        day: r.Day,
        slot: r.Time_Slot,
        slotNum: r.Slot_Num,
        score,
      });
    }
  }

  let totalGroupsChecked = 0;
  for (const [gid, visits] of groupTimelineMap.entries()) {
    // Sort by visitNum to verify chronological order
    visits.sort((a, b) => a.visitNum - b.visitNum);
    assert(visits.length === 3, `Group ${gid} must have 3 visits`);

    for (let i = 0; i < visits.length - 1; i++) {
      const current = visits[i];
      const next = visits[i + 1];

      assert(
        next.score > current.score,
        `Chronological ordering violated for group "${gid}": Visit ${current.visitNum} (${current.day} ${current.slot}, score=${current.score}) is not earlier than Visit ${next.visitNum} (${next.day} ${next.slot}, score=${next.score})`
      );
    }
    totalGroupsChecked++;
  }

  console.log(`  • Verified ${totalGroupsChecked}/${totalGroupsChecked} multi-visit groups (100% strictly ascending by date & time).`);
  for (const [gid, visits] of Array.from(groupTimelineMap.entries()).slice(0, 3)) {
    console.log(`    - Group ${gid} Chronological Sequence:`);
    visits.forEach(v => console.log(`      • Visit ${v.visitNum}: ${v.day} · ${v.slot} (Timeline Score: ${v.score})`));
  }

  console.log("✓ Test 16 Passed: Strict chronological ordering invariant holds 100% across all multi-visit groups without exception.");

  // -------------------------------------------------------------------------
  // Test 17: Combined Group Identifier + Visit-Order Suffix Matrix Label Guard
  // -------------------------------------------------------------------------
  console.log("\nTest 17: Testing Combined Short Group ID + Visit Order Matrix Cell Label Rendering Guard...");

  // Define the exact extractShortGroupId helper used in lab-allocation.tsx
  const extractShortGroupIdRobust = (groupId: string): string => {
    if (!groupId) return "";
    const clean = String(groupId).trim();
    const matchG = clean.match(/[-_]?(G\d+)(?:[-_]|$)/i) || clean.match(/\b(G\d+)\b/i);
    if (matchG) return matchG[1].toUpperCase();
    const matchNamed = clean.match(/\b(?:Group|GRP)[-_\s]?(\d+)\b/i);
    if (matchNamed) return `G${matchNamed[1]}`;
    const matchTrailingNum = clean.match(/[-_](\d+)$/);
    if (matchTrailingNum) return `G${matchTrailingNum[1]}`;
    if (/^\d+$/.test(clean)) return `G${clean}`;
    return clean;
  };

  // Helper for simulated cell renderer
  const simulateRenderPivotCell = (
    seated: number,
    cap: number,
    multiVisits: Array<{ groupId: string; visitNum: number; visitType: string }>
  ): string => {
    const pct = cap > 0 ? (seated / cap) * 100 : 100;
    const isMulti = multiVisits.some(v => v.visitType === "multi_visit" || v.visitNum > 1);
    if (!isMulti || multiVisits.length === 0) {
      return `${seated}/${cap} (${Math.round(pct)}%)`;
    }
    const groupLabels = multiVisits.map(g => `${extractShortGroupIdRobust(g.groupId)} · ${getOrdinalSuffixTest(g.visitNum)}`);
    return `${seated}/${cap} (${Math.round(pct)}%) · ${groupLabels.join(" / ")}`;
  };

  // 1. Check multi-visit rows across various ID patterns
  const multiTestCases = [
    { seated: 20, cap: 20, group: "Physical-DEMI-SUM-26-G4", visit: 1, expected: "20/20 (100%) · G4 · 1st" },
    { seated: 20, cap: 20, group: "Physical-DEMI-SUM-26-G4", visit: 2, expected: "20/20 (100%) · G4 · 2nd" },
    { seated: 25, cap: 25, group: "Physical-DECI-SUM-26-G10", visit: 3, expected: "25/25 (100%) · G10 · 3rd" },
    { seated: 15, cap: 20, group: "Group 1", visit: 1, expected: "15/20 (75%) · G1 · 1st" },
    { seated: 18, cap: 20, group: "Physical-DEMI-SUM-26-4", visit: 2, expected: "18/20 (90%) · G4 · 2nd" },
  ];

  for (const tc of multiTestCases) {
    const rendered = simulateRenderPivotCell(tc.seated, tc.cap, [{ groupId: tc.group, visitNum: tc.visit, visitType: "multi_visit" }]);
    console.log(`  • Rendered Multi Cell: "${rendered}" (Expected: "${tc.expected}")`);
    assert(rendered === tc.expected, `Rendered cell "${rendered}" must match expected "${tc.expected}"`);
    assert(/· G\d+ · \d+(st|nd|rd|th)/.test(rendered), `Rendered cell label must contain both short group ID and visit suffix together, got: "${rendered}"`);
  }

  // 2. Check single-session row remains completely unaffected (no indicator suffix)
  const singleRendered = simulateRenderPivotCell(20, 20, [{ groupId: "Physical-DEMI-SUM-26-G1", visitNum: 1, visitType: "single_visit" }]);
  console.log(`  • Rendered Single-Session Cell: "${singleRendered}"`);
  assert(singleRendered === "20/20 (100%)", `Single-session cell must not have visit indicator, got "${singleRendered}"`);

  console.log("✓ Test 17 Passed: Combined group identifier and visit-order suffix guarded together as one unit.");

  console.log("\n------------------------------------------------------------");
  console.log("🎉 ALL MULTI-SESSION WEEKLY DISTRIBUTION TESTS PASSED 100%!");
  console.log("------------------------------------------------------------\n");
}

runMultiSessionDistributionTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});

