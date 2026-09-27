import assert from "node:assert/strict";
import type {
  AllocationResultPayload,
  OnlineMigrationSuggestion,
  VpSessionSummary,
} from "../../allocation-client";
import { recordToPayload, serializeBatchAllocationOutput } from "../../batch-allocation-storage";

function payload(): AllocationResultPayload {
  const recommendation: OnlineMigrationSuggestion = {
    id: "project-a|Cairo|DEMI:G4",
    decisionKey: "project-a|Cairo|DEMI:G4",
    projectId: "project-a",
    projectName: "Project A",
    program: "DEMI",
    academicIdentity: "DEMI:G4",
    academicLabel: "G4",
    level: 4,
    governorate: "Cairo",
    area: "Cairo",
    labId: "N/A",
    labCapacity: 0,
    totalAssigned: 2,
    studentCount: 2,
    totalCapacity: 0,
    utilizationRate: 0,
    utilizationPercent: 0,
    affectedStudentIds: ["S-1", "S-2"],
    affectedGrades: [4],
    status: "pending",
  };
  return {
    jobId: "vp-test",
    summary: {
      total_students: 2,
      assigned_count: 0,
      unassigned_count: 2,
      total_labs: 0,
      total_sessions_available: 0,
      total_sessions_assigned: 0,
      areas_count: 1,
    },
    logs: [],
    shortfall_text: "",
    dashboard_summary: [],
    area_grade_summary: [],
    master_allocation: [],
    lab_pivot: [],
    lab_allocation: [],
    unassigned_students: [],
    shortfall_math: [],
    generated_files: {},
    preferences_applied: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
    online_migration_suggestions: [recommendation],
    vp_sessions: [],
  };
}

export async function runVpWorkflowPersistenceTests() {
  const batchA = "00000000-0000-4000-8000-000000000001";
  const batchB = "00000000-0000-4000-8000-000000000002";
  const pending = payload();
  let recordA = serializeBatchAllocationOutput(
    batchA,
    "00000000-0000-4000-8000-000000000010",
    pending,
  );

  const afterTabSwitch = recordToPayload(recordA);
  assert.equal(afterTabSwitch?.online_migration_suggestions?.[0].status, "pending");

  const session: VpSessionSummary = {
    id: "VP-G4-001",
    projectId: "project-a",
    projectName: "Project A",
    program: "DEMI",
    academicIdentity: "DEMI:G4",
    academicLabel: "G4",
    level: 4,
    studentIds: ["S-1", "S-2"],
    studentCount: 2,
    capacity: 30,
    governorates: ["Cairo"],
    status: "active",
  };
  const accepted: AllocationResultPayload = {
    ...pending,
    online_migration_suggestions: pending.online_migration_suggestions?.map((item) => ({
      ...item,
      status: "accepted",
    })),
    vp_sessions: [session],
    preferences_applied: {
      ...pending.preferences_applied!,
      onlineMigrationDecisions: {
        [pending.online_migration_suggestions![0].decisionKey!]: "accepted",
      },
    },
  };
  recordA = serializeBatchAllocationOutput(batchA, null, accepted);
  assert.equal(recordToPayload(recordA).vp_sessions?.[0].id, session.id);

  recordA = serializeBatchAllocationOutput(batchA, null, {
    ...accepted,
    vp_sessions: [{ ...session, status: "completed" }],
  });
  const recordB = serializeBatchAllocationOutput(batchB, null, pending);
  assert.equal(recordToPayload(recordA).vp_sessions?.[0].status, "completed");
  assert.equal(recordToPayload(recordB).online_migration_suggestions?.[0].status, "pending");
  assert.equal(recordToPayload(recordB).vp_sessions?.length, 0);

  console.log("VP workflow persistence tests passed.");
}
