import {
  deleteBatchAllocationOutput,
  deleteBatchStudentUpload,
  fetchBatchAllocationOutput,
  fetchBatchStudentUpload,
  fetchProjectStudentRoster,
  getProjectUnassignedBatchId,
  saveBatchAllocationOutput,
  saveProjectUnassignedUpload,
  type StudentRecord,
} from "../../batch-allocation-storage";
import type { AllocationResultPayload } from "../../allocation-client";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function outputFor(batchName: string, totalStudents: number): AllocationResultPayload {
  return {
    jobId: batchName,
    summary: {
      total_students: totalStudents,
      assigned_count: 0,
      unassigned_count: totalStudents,
      total_labs: 0,
      total_sessions_available: 0,
      total_sessions_assigned: 0,
      areas_count: 0,
    },
    dashboard_summary: [],
    area_grade_summary: [],
    master_allocation: [],
    lab_pivot: [],
    lab_allocation: [],
    unassigned_students: [],
    shortfall_math: [],
    overfill_details: [],
    shortfall_text: batchName,
    logs: [],
    generated_files: {},
  };
}

export async function runBatchSwitchingIsolationTests() {
  console.log("\n=========================================================================");
  console.log("RUNNING PROJECT ROSTER / BATCH OUTPUT ISOLATION REGRESSION TEST");
  console.log("=========================================================================");

  const projectId = crypto.randomUUID();
  const batches = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const rosterId = getProjectUnassignedBatchId(projectId);
  const students: StudentRecord[] = Array.from({ length: 1294 }, (_, index) => ({
    S_ID: `STU-${String(index + 1).padStart(5, "0")}`,
    Grade: 4 + (index % 3),
    "Physical Area": index % 2 === 0 ? "Dokki" : "Nasr City",
    Status: "Enrolled",
  }));

  try {
    await saveProjectUnassignedUpload(projectId, "project_roster.xlsx", 102400, students, undefined, "replace");

    for (const batchId of batches) {
      const loadedRoster = await fetchProjectStudentRoster(projectId);
      assert(loadedRoster !== null, `project roster must load for batch ${batchId}`);
      assert(loadedRoster!.batch_id === rosterId, "all batches must resolve to the canonical project roster record");
      assert(loadedRoster!.students.length === 1294, `batch ${batchId} must receive all 1,294 project students`);
      assert(await fetchBatchStudentUpload(batchId) === null, `batch ${batchId} must not own a student upload copy`);
    }

    await Promise.all(
      batches.map((batchId, index) =>
        saveBatchAllocationOutput(batchId, projectId, outputFor(`batch-${index + 1}`, students.length)),
      ),
    );

    const outputs = await Promise.all(batches.map(fetchBatchAllocationOutput));
    assert(outputs.every(Boolean), "each batch must retain its own allocation output");
    assert(new Set(outputs.map((output) => output!.shortfall_text)).size === 3, "batch outputs must remain isolated");

    const rosterAfterAllocation = await fetchProjectStudentRoster(projectId);
    assert(rosterAfterAllocation?.students.length === 1294, "saving batch outputs must not modify the project roster");
    console.log("Project roster remains 1,294 across three batches with isolated outputs.");
  } finally {
    await deleteBatchStudentUpload(rosterId);
    await Promise.all(batches.map(deleteBatchAllocationOutput));
  }
}

if (process.argv[1]?.includes("test-batch-switching-isolation")) {
  runBatchSwitchingIsolationTests().catch((error) => {
    console.error("Project roster isolation test failed:", error);
    process.exit(1);
  });
}
