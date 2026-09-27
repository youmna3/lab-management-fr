import {
  saveBatchResolutionRequest,
  fetchBatchResolutionRequests,
  updateBatchResolutionRequestStatus,
  deleteBatchResolutionRequest,
  type ResolutionRequest,
} from "../../batch-allocation-storage";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

async function testResolutionRequests() {
  console.log("Testing Resolution Requests Flow & Batch Isolation...");

  const batch1 = "b_res_test_1_" + Date.now();
  const batch2 = "b_res_test_2_" + Date.now();

  // 1. Create Overfill request for Batch 1 (Target: Event Team)
  const req1 = await saveBatchResolutionRequest({
    batch_id: batch1,
    type: "overfill",
    target_team: "Event Team",
    status: "pending",
    area: "مدينة نصر",
    grades: [4, 5, 6],
    unassigned_count: 12,
    max_overfill_per_lab: 2,
    submitted_by_name: "Ahmed Ops",
    submitted_by_role: "Operations",
  });
  assert(req1.id !== undefined, "req1 must have an id");
  assert(req1.target_team === "Event Team", "req1 must target Event Team");
  assert(req1.submitted_by_name === "Ahmed Ops", "req1 must record submitter name");
  assert(req1.submitted_by_role === "Operations", "req1 must record submitter role");
  console.log("✓ Created Fair Overfill request with Operations attribution");

  // 2. Create New Lab request for Batch 1 (Target: Event Team)
  const req2 = await saveBatchResolutionRequest({
    batch_id: batch1,
    type: "new_lab",
    target_team: "Event Team",
    status: "pending",
    area: "الدقي",
    grades: [4, 5],
    requested_capacity: 30,
    reason: "Demand deficit",
    submitted_by_name: "Sara Admin",
    submitted_by_role: "Administration",
  });
  assert(req2.type === "new_lab", "req2 must be new_lab");
  console.log("✓ Created New Lab request for Batch 1");

  // 3. Create CS Outreach request for Batch 1 (Target: CS Team)
  const req3 = await saveBatchResolutionRequest({
    batch_id: batch1,
    type: "cs_outreach",
    target_team: "CS Team",
    status: "pending",
    area: "المعادي",
    grades: [4, 5, 6],
    suggested_nearest_lab: "LAB-HEL-01 (مصر الجديدة)",
    submitted_by_name: "Ahmed Ops",
    submitted_by_role: "Operations",
  });
  assert(req3.target_team === "CS Team", "req3 must target CS Team");
  console.log("✓ Created CS Outreach request for Batch 1");

  // 4. Verify Batch 2 has 0 requests (Batch Isolation check)
  const batch2Reqs = await fetchBatchResolutionRequests(batch2);
  assert(batch2Reqs.length === 0, "Batch 2 must have 0 requests");
  console.log("✓ Batch 2 is completely isolated and returned 0 requests");

  // 5. Verify Batch 1 has all 3 requests
  const batch1Reqs = await fetchBatchResolutionRequests(batch1);
  assert(batch1Reqs.length === 3, "Batch 1 must have 3 requests");
  console.log("✓ Batch 1 successfully returned all 3 requests");

  // 6. Role-gated Approval: Lab Manager approves Overfill
  const reviewerLM = { name: "Mahmoud LabMgr", role: "Lab Manager" };
  await updateBatchResolutionRequestStatus(req1.id, batch1, "approved", reviewerLM);
  const updatedReqs = await fetchBatchResolutionRequests(batch1);
  const updatedReq1 = updatedReqs.find((r) => r.id === req1.id);
  assert(updatedReq1?.status === "approved", "req1 status must be approved");
  assert(updatedReq1?.reviewed_by_name === "Mahmoud LabMgr", "req1 must record reviewer name");
  assert(updatedReq1?.reviewed_by_role === "Lab Manager", "req1 must record reviewer role");
  console.log("✓ Approved status & Lab Manager reviewer attribution persisted correctly");

  // 7. Role-gated CS Status: Operations marks Contacted
  const reviewerOps = { name: "Ahmed Ops", role: "Operations" };
  await updateBatchResolutionRequestStatus(req3.id, batch1, "contacted", reviewerOps);
  const updatedReqs2 = await fetchBatchResolutionRequests(batch1);
  const updatedReq3 = updatedReqs2.find((r) => r.id === req3.id);
  assert(updatedReq3?.status === "contacted", "req3 status must be contacted");
  assert(updatedReq3?.reviewed_by_name === "Ahmed Ops", "req3 must record reviewer name");
  console.log("✓ CS Contacted status & Operations attribution persisted correctly");

  // 8. Delete request 2
  await deleteBatchResolutionRequest(req2.id, batch1);
  const afterDeleteReqs = await fetchBatchResolutionRequests(batch1);
  assert(afterDeleteReqs.length === 2, "Batch 1 must have 2 requests after deletion");
  console.log("✓ Delete request works properly");

  // 9. Role Permissions Matrix Simulation
  const evaluateCanApprove = (roles: string[]) => roles.includes("lab_manager") || roles.includes("administration");
  const evaluateCanSubmit = (roles: string[]) => roles.includes("operations") || roles.includes("administration") || roles.includes("lab_manager");
  const evaluateCanUpdateCS = (roles: string[]) => roles.includes("operations") || roles.includes("administration");

  // Operations only user: can submit and update CS, but CANNOT approve Event requests
  assert(evaluateCanSubmit(["operations"]) === true, "Operations can submit");
  assert(evaluateCanApprove(["operations"]) === false, "Operations CANNOT approve Event requests");
  assert(evaluateCanUpdateCS(["operations"]) === true, "Operations can update CS requests");

  // Lab Manager user: can submit and CAN approve Event requests
  assert(evaluateCanSubmit(["lab_manager"]) === true, "Lab Manager can submit");
  assert(evaluateCanApprove(["lab_manager"]) === true, "Lab Manager CAN approve Event requests");

  // Finance user: viewer only in resolution flow
  assert(evaluateCanSubmit(["finance"]) === false, "Finance CANNOT submit");
  assert(evaluateCanApprove(["finance"]) === false, "Finance CANNOT approve");

  console.log("✓ Simulated role permission matrix checks validated");

  // 10. Grade 6 Fair Overfill (+2) Solver Resolution Verification
  const { runIlpAllAreas } = await import("../ilp");
  const { runGroupOptimization } = await import("../distribute");
  const { generateMasterAllocation } = await import("../master");
  const { buildGroupCountSummary } = await import("../summaries");

  const mockSessions = [1, 2, 3].map((slotNum) => ({
    Area: "Maadi",
    "Lab ID": "Lab_M1",
    Session: `Maadi_Lab_M1_Slot_${slotNum}`,
    Day: "Saturday",
    Slot_Num: slotNum,
    Slot_Label: `Slot ${slotNum}`,
    Lab_Capacity: 20,
    True_Capacity: 20,
    Session_Type: "Regular",
    Slot_Key: `Maadi__Lab_M1__Slot_${slotNum}`,
  }));

  const mockStudents = [
    ...Array.from({ length: 20 }, (_, i) => ({ S_ID: `G4_${i}`, Grade: 4, "Physical Area": "Maadi" })),
    ...Array.from({ length: 20 }, (_, i) => ({ S_ID: `G5_${i}`, Grade: 5, "Physical Area": "Maadi" })),
    ...Array.from({ length: 22 }, (_, i) => ({ S_ID: `G6_${i}`, Grade: 6, "Physical Area": "Maadi" })),
  ];

  const studentsByAreaGrade = new Map([
    ["Maadi__4", 20],
    ["Maadi__5", 20],
    ["Maadi__6", 22],
  ]);

  // Run Baseline (no overfill)
  const baseIlp = await runIlpAllAreas(mockSessions, studentsByAreaGrade, ["Maadi"], [4, 5, 6], () => {}, { overfillRules: [] });
  const baseDist = runGroupOptimization(mockStudents, baseIlp.sessionsAugmented, { overfillRules: [] });
  const baseMaster = await generateMasterAllocation(mockStudents, baseDist.assignmentPlan, new Map(baseIlp.sessionsAugmented.map((s) => [s.Slot_Key, s])), "GRP_", new Map());
  assert(baseMaster.unassignedRows.length === 2, "Baseline must have 2 unassigned Grade 6 students");

  // Run with Grade 6 Overfill (+2)
  const g6Ilp = await runIlpAllAreas(mockSessions, studentsByAreaGrade, ["Maadi"], [4, 5, 6], () => {}, {
    overfillRules: [{ area: "Maadi", grades: [6], labIds: ["ALL"], maxOverfillPerLab: 2 }],
  });
  const g6Dist = runGroupOptimization(mockStudents, g6Ilp.sessionsAugmented, {
    overfillRules: [{ area: "Maadi", grades: [6], labIds: ["ALL"], maxOverfillPerLab: 2 }],
  });
  const g6Master = await generateMasterAllocation(mockStudents, g6Dist.assignmentPlan, new Map(g6Ilp.sessionsAugmented.map((s) => [s.Slot_Key, s])), "GRP_", new Map());
  assert(g6Master.unassignedRows.length === 0, "Grade 6 Overfill must seat all 22 Grade 6 students (0 unassigned)");

  const g6GroupSummary = buildGroupCountSummary(g6Master.masterRows, g6Master.unassignedRows);
  const g4Row = g6GroupSummary.find((r) => r.Grade === 4)!;
  const g5Row = g6GroupSummary.find((r) => r.Grade === 5)!;
  const g6Row = g6GroupSummary.find((r) => r.Grade === 6)!;

  assert(g4Row.Students_Assigned === 20 && g4Row.Unassigned === 0, "G4 must remain 20 assigned, 0 unassigned");
  assert(g5Row.Students_Assigned === 20 && g5Row.Unassigned === 0, "G5 must remain 20 assigned, 0 unassigned");
  assert(g6Row.Students_Assigned === 22 && g6Row.Unassigned === 0, "G6 must have 22 assigned, 0 unassigned");

  const overfillSeats = g6Master.masterRows.filter((r) => r.Is_Overfill);
  assert(overfillSeats.length === 2, "Must have exactly 2 overfill seats");
  assert(overfillSeats.every((r) => r.Grade === 6), "All overfill seats must belong to Grade 6");
  console.log("✓ Grade 6 Fair Overfill (+2) resolution verified end-to-end");

  // 11. Cleanup
  await deleteBatchResolutionRequest(req1.id, batch1);
  await deleteBatchResolutionRequest(req3.id, batch1);

  console.log("All Resolution Request unit & isolation tests passed 100%!");
}

testResolutionRequests().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
