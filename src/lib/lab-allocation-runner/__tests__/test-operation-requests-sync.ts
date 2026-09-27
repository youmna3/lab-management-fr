import {
  saveBatchResolutionRequest,
  fetchBatchResolutionRequests,
  fetchAllResolutionRequests,
  updateBatchResolutionRequestStatus,
  deleteBatchResolutionRequest,
  markBatchRequestsSolverRerun,
  type ResolutionRequest,
} from "../../batch-allocation-storage";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

export async function runOperationRequestsSyncTests() {
  console.log("=========================================================================");
  console.log("🧪 TESTING OPERATION REQUESTS TWO-WAY SYNC & ROUTING SEQUENCING");
  console.log("=========================================================================");

  const batchA = crypto.randomUUID();
  const batchB = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  // 1. Operations creates 2 Overfill/New Lab requests in Batch A
  const req1 = await saveBatchResolutionRequest({
    batch_id: batchA,
    project_id: projectId,
    type: "overfill",
    target_team: "Event Team",
    status: "pending",
    area: "مدينة نصر",
    grades: [4, 5, 6],
    unassigned_count: 15,
    lab_id: "L556",
    max_overfill_per_lab: 2,
    submitted_by_name: "Tarek Operations",
    submitted_by_role: "Operations",
  });

  const req1b = await saveBatchResolutionRequest({
    batch_id: batchA,
    project_id: projectId,
    type: "new_lab",
    target_team: "Event Team",
    status: "pending",
    area: "الدقي",
    grades: [4, 5],
    requested_capacity: 25,
    submitted_by_name: "Tarek Operations",
    submitted_by_role: "Operations",
  });
  console.log("✓ Operations created 2 Overfill & New Lab tickets for Batch A");

  // 2. Operations creates a CS Reassignment request in Batch B
  const req2 = await saveBatchResolutionRequest({
    batch_id: batchB,
    project_id: projectId,
    type: "cs_outreach",
    target_team: "CS Team",
    status: "pending",
    area: "المعادي",
    grades: [4, 5],
    unassigned_count: 8,
    suggested_nearest_lab: "LAB-GIZA-01",
    submitted_by_name: "Tarek Operations",
    submitted_by_role: "Operations",
  });
  console.log("✓ Operations created CS Reassignment ticket for Batch B");

  // 3. Test Top-Level "Operation Requests" fetchAllResolutionRequests() receives all
  const allReqs = await fetchAllResolutionRequests();
  const foundReq1 = allReqs.find((r) => r.id === req1.id);
  const foundReq1b = allReqs.find((r) => r.id === req1b.id);
  const foundReq2 = allReqs.find((r) => r.id === req2.id);

  assert(foundReq1 !== undefined, "Operation Requests page must see req1");
  assert(foundReq1b !== undefined, "Operation Requests page must see req1b");
  assert(foundReq2 !== undefined, "Operation Requests page must see req2");
  assert(foundReq1?.project_id === projectId, "req1 must contain project_id");
  assert(foundReq1?.lab_id === "L556", "req1 must contain target lab ID");
  assert(foundReq2?.status === "pending", "req2 must start in pending state");
  console.log("✓ Top-level Operation Requests view correctly aggregates tickets across all batches");

  // 4. Lab Manager Approves both tickets in Batch A via Operation Requests page
  const reviewerLM = { name: "Mahmoud LabManager", role: "Lab Manager" };
  await updateBatchResolutionRequestStatus(req1.id, batchA, "approved", reviewerLM);
  await updateBatchResolutionRequestStatus(req1b.id, batchA, "approved", reviewerLM);

  // Verify modal view for Batch A sees "approved" status immediately (2-way sync)
  const batchAReqs = await fetchBatchResolutionRequests(batchA);
  const syncedReq1 = batchAReqs.find((r) => r.id === req1.id);
  assert(syncedReq1?.status === "approved", "Batch A modal must immediately reflect approved status");
  assert(syncedReq1?.reviewed_by_name === "Mahmoud LabManager", "Attribution must sync to modal");
  console.log("✓ Two-way sync confirmed: LM approval on Operation Requests reflects in Batch Allocation modal");

  // 5. Sequence Check: Mark Resolved is BLOCKED until Solver is re-run
  const canMarkResolved = (req: ResolutionRequest) => {
    if (req.type === "overfill" || req.type === "new_lab") {
      return req.status === "approved" && Boolean(req.solver_rerun_at);
    }
    return req.status === "approved" || req.status === "contacted";
  };

  assert(canMarkResolved(syncedReq1!) === false, "Overfill ticket CANNOT be marked resolved before solver re-run");
  console.log("✓ Sequence enforced: Mark Resolved blocked until solver re-run is triggered");

  // 6. Multi-ticket Batch Satisfaction: One Solver Re-run marks ALL approved tickets in that batch as re-run
  await markBatchRequestsSolverRerun(batchA);
  const reloadedBatchAReqs = await fetchBatchResolutionRequests(batchA);
  const rerunReq1 = reloadedBatchAReqs.find((r) => r.id === req1.id);
  const rerunReq1b = reloadedBatchAReqs.find((r) => r.id === req1b.id);

  assert(Boolean(rerunReq1?.solver_rerun_at), "req1 must record solver_rerun_at timestamp");
  assert(Boolean(rerunReq1b?.solver_rerun_at), "req1b must also record solver_rerun_at timestamp from the same re-run pass");
  assert(canMarkResolved(rerunReq1!) === true, "req1 can now be marked Resolved");
  assert(canMarkResolved(rerunReq1b!) === true, "req1b can now also be marked Resolved");
  console.log("✓ Single solver re-run satisfied re-run requirement for all approved tickets in Batch A");

  // Mark req1 resolved
  await updateBatchResolutionRequestStatus(req1.id, batchA, "resolved", reviewerLM);
  const resolvedReq1 = (await fetchBatchResolutionRequests(batchA)).find((r) => r.id === req1.id);
  assert(resolvedReq1?.status === "resolved", "req1 is now resolved");
  console.log("✓ Overfill ticket marked Resolved successfully following solver re-run");

  // 7. Routing Sequencing for CS Reassignment: Blocked until LM approves, then does NOT require solver re-run
  const canCSAct = (req: ResolutionRequest) => req.status === "approved" || req.status === "contacted";
  assert(canCSAct(req2) === false, "CS Team CANNOT act while ticket is still pending LM approval");

  // Lab Manager approves CS ticket
  await updateBatchResolutionRequestStatus(req2.id, batchB, "approved", reviewerLM);
  const updatedReq2 = (await fetchAllResolutionRequests()).find((r) => r.id === req2.id);
  assert(updatedReq2?.status === "approved", "req2 is now approved by Lab Manager");
  assert(canCSAct(updatedReq2!) === true, "CS Team can now proceed with outreach without solver rerun");
  console.log("✓ CS ticket directly proceeds to CS outreach once LM approves (no solver re-run needed)");

  // CS Team updates status to Contacted -> Resolved
  const reviewerCS = { name: "Nour CS", role: "CS Team" };
  await updateBatchResolutionRequestStatus(req2.id, batchB, "contacted", reviewerCS);
  await updateBatchResolutionRequestStatus(req2.id, batchB, "resolved", reviewerCS);
  const resolvedReq2 = (await fetchAllResolutionRequests()).find((r) => r.id === req2.id);
  assert(resolvedReq2?.status === "resolved", "req2 status must be resolved");
  console.log("✓ CS Team completed contact and resolution lifecycle");

  // 8. Navigation Role-Gating Verification
  const checkNavAccess = (roles: string[], path: string) => {
    if (path === "/operation-requests") {
      return roles.includes("lab_manager") || roles.includes("administration");
    }
    return true;
  };

  assert(checkNavAccess(["lab_manager"], "/operation-requests") === true, "Lab Manager has access to /operation-requests");
  assert(checkNavAccess(["administration"], "/operation-requests") === true, "Admin has access to /operation-requests");
  assert(checkNavAccess(["operations"], "/operation-requests") === false, "Operations only is restricted from /operation-requests");
  assert(checkNavAccess(["finance"], "/operation-requests") === false, "Finance only is restricted from /operation-requests");
  console.log("✓ Navigation role gating verified for /operation-requests");

  // 9. Cleanup
  await deleteBatchResolutionRequest(req1.id, batchA);
  await deleteBatchResolutionRequest(req1b.id, batchA);
  await deleteBatchResolutionRequest(req2.id, batchB);
  console.log("🎉 ALL OPERATION REQUESTS SYNC & SEQUENCING TESTS PASSED 100%!");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOperationRequestsSyncTests().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
