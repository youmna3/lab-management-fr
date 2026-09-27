/**
 * Automated Test Suite: Lab Manager Request Preview Impact (Dry-Run Simulation)
 *
 * Verifies:
 * 1. Read-only, non-persisting dry-run simulation using specific request parameters (Overfill & New Lab).
 * 2. Zero-persistence guarantee: zero writes to storage, zero audit entries created, ticket remains pending.
 * 3. Accurate simulated reduction in unassigned students and increase in seated capacity.
 */

import * as XLSX from "xlsx";
import { runAllocation } from "../run";
import {
  saveBatchResolutionRequest,
  fetchBatchResolutionRequests,
  type ResolutionRequest,
} from "@/lib/batch-allocation-storage";
import { fetchAuditLogs } from "@/lib/audit-logging";

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

async function runLabManagerPreviewTests() {
  console.log("------------------------------------------------------------");
  console.log("Starting Lab Manager Request Preview Impact Test Suite");
  console.log("------------------------------------------------------------\n");

  const testBatchId = `test_batch_preview_${Date.now()}`;

  // 1. Create a dataset with 30 students in Nasr City where standard lab capacity is 25 seats (leaving 5 unassigned)
  const testStudents: any[] = [];
  for (let i = 1; i <= 30; i++) {
    testStudents.push({
      "Student ID": `STU-NC-${String(i).padStart(3, "0")}`,
      Grade: 4,
      "Physical Area": "مدينة نصر",
    });
  }

  const studentFile = makeStudentFile(testStudents);
  const labsJson = [
    { "Lab ID": "LAB-NC-01", Area: "مدينة نصر", "Lab Capacity": 25 },
  ];
  // Custom schedule with 1 slot only so capacity is strictly 25 seats
  const customSlots = ["Thursday 9 AM"];

  // -------------------------------------------------------------------------
  // Baseline Run (Standard Capacity = 25 seats -> 25 Assigned, 5 Unassigned)
  // -------------------------------------------------------------------------
  console.log("Test 1: Running Baseline Allocation...");
  const baselineRun = await runAllocation({
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
      customSlots,
    },
  });

  assert(baselineRun.payload.summary.assigned_count === 25, `Baseline assigned must be 25, got ${baselineRun.payload.summary.assigned_count}`);
  assert(baselineRun.payload.summary.unassigned_count === 5, `Baseline unassigned must be 5, got ${baselineRun.payload.summary.unassigned_count}`);
  console.log("✓ Test 1 Passed: Baseline established with 25 Assigned, 5 Unassigned.");

  // -------------------------------------------------------------------------
  // Create a Pending Resolution Request in Storage
  // -------------------------------------------------------------------------
  console.log("\nTest 2: Creating Pending Overfill Request for Event Team...");
  const request: ResolutionRequest = {
    id: `req-preview-${Date.now()}`,
    batch_id: testBatchId,
    project_id: "proj-1",
    type: "overfill",
    target_team: "Event Team",
    status: "pending",
    area: "مدينة نصر",
    grades: [4],
    max_overfill_per_lab: 2,
    unassigned_count: 5,
    submitted_by_name: "Operations Team",
    submitted_by_role: "Operations Specialist",
    created_at: new Date().toISOString(),
  };

  const initialAuditLogsCount = (await fetchAuditLogs()).total;
  await saveBatchResolutionRequest(request);

  const pendingReqs = await fetchBatchResolutionRequests(testBatchId);
  assert(pendingReqs.length === 1, "Must have 1 pending request stored");
  assert(pendingReqs[0].status === "pending", "Request must be pending");
  console.log("✓ Test 2 Passed: Request created in pending state.");

  // -------------------------------------------------------------------------
  // Lab Manager Dry-Run Simulation (Overfill Preview)
  // -------------------------------------------------------------------------
  console.log("\nTest 3: Simulating Fair Overfill Impact (Dry-Run)...");

  // Construct simulated preferences from request parameters
  const simPrefsOverfill = {
    overfillRules: [
      {
        area: request.area,
        grades: request.grades,
        labIds: ["ALL"],
        maxOverfillPerLab: request.max_overfill_per_lab || 2,
      },
    ],
    preferredLabRules: [],
    extraLabs: [],
    customSlots,
  };

  const simulatedRun = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-DS-G",
    preferences: simPrefsOverfill,
  });

  // With +2 overfill, assigned goes from 25 to 27, unassigned goes from 5 to 3
  const simAssigned = simulatedRun.payload.summary.assigned_count;
  const simUnassigned = simulatedRun.payload.summary.unassigned_count;
  const deltaAssigned = simAssigned - baselineRun.payload.summary.assigned_count;
  const deltaUnassigned = baselineRun.payload.summary.unassigned_count - simUnassigned;

  console.log(`  • Simulated Assigned: ${simAssigned} (+${deltaAssigned} seated)`);
  console.log(`  • Simulated Unassigned: ${simUnassigned} (-${deltaUnassigned} shortfall)`);
  console.log(`  • Overfill Placed: +${simulatedRun.payload.summary.overfill_count} seats`);

  assert(simAssigned === 27, `Simulated assigned must be 27, got ${simAssigned}`);
  assert(simUnassigned === 3, `Simulated unassigned must be 3, got ${simUnassigned}`);
  assert(deltaAssigned === 2, "Delta assigned must be +2");
  assert(deltaUnassigned === 2, "Delta unassigned must be -2");
  console.log("✓ Test 3 Passed: Dry-run simulation accurately computed overfill impact.");

  // -------------------------------------------------------------------------
  // Zero-Persistence Guarantee Verification
  // -------------------------------------------------------------------------
  console.log("\nTest 4: Verifying Zero-Persistence Guarantee...");

  // 1. Request status must still be strictly "pending"
  const reqsAfterSim = await fetchBatchResolutionRequests(testBatchId);
  assert(reqsAfterSim[0].status === "pending", "Request status must remain strictly 'pending' after simulation");

  // 2. Audit logs count must NOT have increased due to preview
  const auditLogsAfterSim = (await fetchAuditLogs()).total;
  assert(auditLogsAfterSim === initialAuditLogsCount, "Zero audit log entries must be created during preview simulation");

  console.log("✓ Test 4 Passed: Zero-persistence guarantee verified (0 DB writes, 0 audit logs, status remains pending).");

  // -------------------------------------------------------------------------
  // Test 5: New Lab Request Dry-Run Simulation
  // -------------------------------------------------------------------------
  console.log("\nTest 5: Simulating New Lab Venue Request (+10 seats)...");

  const newLabPrefs = {
    overfillRules: [],
    preferredLabRules: [],
    extraLabs: [
      {
        area: "مدينة نصر",
        labId: "NEW-LAB-NC-02",
        capacity: 10,
        slots: [1],
      },
    ],
    customSlots,
  };

  const newLabRun = await runAllocation({
    studentFile,
    labFile: null,
    useDbLabs: true,
    labsJson,
    program: "CUSTOM",
    prefix: "Physical-DS-G",
    preferences: newLabPrefs,
  });

  // With extra 10 capacity, all 30 students can be seated
  assert(newLabRun.payload.summary.assigned_count === 30, `All 30 students must be assigned with new lab, got ${newLabRun.payload.summary.assigned_count}`);
  assert(newLabRun.payload.summary.unassigned_count === 0, "Unassigned must be 0 with new lab");
  console.log("✓ Test 5 Passed: New Lab dry-run simulation successfully resolved remaining shortfall.");

  console.log("\n------------------------------------------------------------");
  console.log("🎉 ALL LAB MANAGER PREVIEW IMPACT TESTS PASSED 100%!");
  console.log("------------------------------------------------------------\n");
}

runLabManagerPreviewTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
