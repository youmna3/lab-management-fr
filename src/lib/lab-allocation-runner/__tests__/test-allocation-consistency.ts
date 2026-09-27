import assert from "node:assert/strict";
import { reconcileFinalAllocationSummary } from "../../batch-allocation-storage";
import { isCurrentBatchRequest } from "../../latest-batch-request";
import type { AllocationResultPayload } from "../../allocation-client";
import { calculateAllocationAccounting } from "../../allocation-client";

export async function runAllocationConsistencyTests() {
  const projectId = "00000000-0000-4000-8000-000000000010";
  const multipleSessions = "00000000-0000-4000-8000-000000000001";
  const cohort2 = "00000000-0000-4000-8000-000000000002";
  let version = 1;
  const oldRequest = { version, batchId: multipleSessions, projectId };
  const newRequest = { version: ++version, batchId: cohort2, projectId };

  await Promise.resolve();
  assert.equal(isCurrentBatchRequest(oldRequest, version, cohort2, projectId), false);
  assert.equal(isCurrentBatchRequest(newRequest, version, cohort2, projectId), true);

  const physicalIds = Array.from({ length: 25_207 }, (_, index) => `P-${index + 1}`);
  const vpIds = Array.from({ length: 17 }, (_, index) => `VP-${index + 1}`);
  const payload = {
    jobId: "consistency-test",
    summary: {
      total_students: 25_304,
      assigned_count: 25_207,
      unassigned_count: 97,
      total_labs: 0,
      total_sessions_available: 0,
      total_sessions_assigned: 0,
      areas_count: 0,
    },
    master_allocation: [],
    physical_master_allocation: physicalIds.map((S_ID) => ({ S_ID })),
    physical_unassigned_students: [],
    online_migration_suggestions: [{ status: "accepted", affectedStudentIds: vpIds }],
    dashboard_summary: [], area_grade_summary: [], lab_pivot: [], lab_allocation: [],
    unassigned_students: [], shortfall_math: [], logs: [], shortfall_text: "", generated_files: {},
  } as unknown as AllocationResultPayload;
  const reconciled = reconcileFinalAllocationSummary(payload);
  assert.equal(reconciled.summary.assigned_count, 25_224);
  assert.equal(reconciled.summary.unassigned_count, 80);
  assert.equal(
    reconciled.summary.assigned_count + reconciled.summary.unassigned_count,
    reconciled.summary.total_students,
  );

  const twoVisitRows = Array.from({ length: 25_286 }, (_, index) => [
    { S_ID: `P-${index + 1}`, Lab_ID: "LAB-1", Slot_Num: 1 },
    { S_ID: `P-${index + 1}`, Lab_ID: "LAB-1", Slot_Num: 2 },
  ]).flat();
  const eighteenUnassigned = Array.from({ length: 18 }, (_, index) => ({ S_ID: `U-${index + 1}` }));
  const repeatedAccounting = Array.from({ length: 3 }, () =>
    calculateAllocationAccounting(twoVisitRows, eighteenUnassigned),
  );
  for (const accounting of repeatedAccounting) {
    assert.equal(accounting.physicalAssignedCount, 25_286);
    assert.equal(accounting.vpAssignedCount, 0);
    assert.equal(accounting.unassignedCount, 18);
    assert.equal(accounting.totalSeatVisits, 50_572);
    assert.equal(accounting.physicalAssignedCount + accounting.unassignedCount, 25_304);
  }

  console.log("Batch race guard and unique-student allocation accounting passed.");
}
