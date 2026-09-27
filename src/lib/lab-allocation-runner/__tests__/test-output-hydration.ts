import {
  saveBatchAllocationOutput,
  fetchBatchAllocationOutput,
  deleteBatchAllocationOutput,
} from "../../batch-allocation-storage";
import type { AllocationResultPayload, MasterAllocationRow, UnassignedStudentRow } from "../../allocation-client";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

async function testOutputHydration() {
  console.log("Testing Allocation Output Full Hydration & Visual Analytics Restoration...");

  const testBatchId = "batch_hydr_test_" + Date.now();

  const mockPayload: AllocationResultPayload = {
    jobId: "job-test-123",
    summary: {
      total_students: 100,
      assigned_count: 95,
      unassigned_count: 5,
      total_sessions_assigned: 10,
      total_sessions_available: 12,
      total_labs: 3,
      areas_count: 2,
    },
    logs: ["Log 1", "Log 2"],
    shortfall_text: "5 unseated students in Dokki",
    preferences_applied: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
    dashboard_summary: [
      { "Physical Area": "Nasr City", "Grand Total": 50, "Total Groups": 2, Unassigned: 0 },
      { "Physical Area": "Dokki", "Grand Total": 50, "Total Groups": 2, Unassigned: 5 },
    ],
    area_grade_summary: [
      {
        "Physical Area": "Nasr City",
        Grade: 4,
        Students_Assigned: 20,
        Unique_Groups: 1,
        Groups_Used: 1,
        Labs_Used: 1,
        Unassigned: 0,
        Total_Students: 20,
      },
      {
        "Physical Area": "Nasr City",
        Grade: 5,
        Students_Assigned: 30,
        Unique_Groups: 1,
        Groups_Used: 1,
        Labs_Used: 1,
        Unassigned: 0,
        Total_Students: 30,
      },
      {
        "Physical Area": "Dokki",
        Grade: 4,
        Students_Assigned: 20,
        Unique_Groups: 1,
        Groups_Used: 1,
        Labs_Used: 1,
        Unassigned: 0,
        Total_Students: 20,
      },
      {
        "Physical Area": "Dokki",
        Grade: 6,
        Students_Assigned: 25,
        Unique_Groups: 1,
        Groups_Used: 1,
        Labs_Used: 1,
        Unassigned: 5,
        Total_Students: 30,
      },
    ],
    master_allocation: [
      {
        Group_ID: "Physical-DS-G1",
        S_ID: "STU-001",
        Grade: 4,
        "Physical Area": "Nasr City",
        Day: "Thursday",
        Session: "Session 1",
        Time_Slot: "9 AM",
        Lab_ID: "LAB-NC-01",
        Slot_Key: "NC_G4_Thu_S1",
        Slot_Num: 1,
        Lab_Capacity: 25,
      },
    ],
    lab_pivot: [],
    lab_allocation: [],
    unassigned_students: [
      {
        S_ID: "STU-099",
        Grade: 6,
        "Physical Area": "Dokki",
        Reason: "Capacity shortfall",
      },
    ],
    shortfall_math: [],
    generated_files: { "summary.csv": "col1,col2" },
  };

  // 1. Save output
  await saveBatchAllocationOutput(testBatchId, "proj-1", mockPayload);
  console.log("✓ Saved output with complete area_grade_summary");

  // 2. Fetch output
  const restored = await fetchBatchAllocationOutput(testBatchId);
  assert(restored !== null, "Restored payload must not be null");
  if (!restored) throw new Error("Restored is null");
  assert(restored.summary.total_students === 100, "total_students must be 100");
  assert(restored.area_grade_summary.length === 4, "area_grade_summary must have 4 rows");
  console.log("✓ Full area_grade_summary successfully rehydrated on fetch!");

  // Verify Grade 4 placement calculation
  const g4Rows = restored.area_grade_summary.filter((r) => Number(r.Grade) === 4);
  const g4Assigned = g4Rows.reduce((sum, r) => sum + r.Students_Assigned, 0);
  assert(g4Assigned === 40, "G4 assigned must be 40 (20 Nasr City + 20 Dokki)");
  console.log(`✓ G4 breakdown correctly restores: ${g4Assigned} assigned students`);

  // Verify Grade 6 placement calculation
  const g6Rows = restored.area_grade_summary.filter((r) => Number(r.Grade) === 6);
  const g6Assigned = g6Rows.reduce((sum, r) => sum + r.Students_Assigned, 0);
  const g6Unassigned = g6Rows.reduce((sum, r) => sum + r.Unassigned, 0);
  assert(g6Assigned === 25 && g6Unassigned === 5, "G6 must be 25 assigned, 5 unassigned");
  console.log(`✓ G6 breakdown correctly restores: ${g6Assigned} assigned, ${g6Unassigned} unassigned`);

  // 3. Cleanup
  await deleteBatchAllocationOutput(testBatchId);
  console.log("All Output Hydration & Visual Analytics restoration tests passed 100%!");
}

testOutputHydration().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
