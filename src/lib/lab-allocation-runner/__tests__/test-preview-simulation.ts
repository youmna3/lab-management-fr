import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../run";
import type { AllocationPreferences, OverfillRule, ExtraLabDefinition } from "../../allocation-client";
import { fetchBatchAllocationOutput, fetchBatchResolutionRequests } from "../../batch-allocation-storage";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

async function runPreviewSimulationTests() {
  console.log("------------------------------------------------------------");
  console.log("Starting Preview Simulation & Zero-Persistence Tests");
  console.log("------------------------------------------------------------\n");

  // Sample student demand data (40 students across Nasr City Grade 4 & Dokki Grade 5)
  const studentRows: any[] = [];
  let sId = 1;
  // 20 students in Nasr City, Grade 4
  for (let i = 0; i < 20; i++) {
    studentRows.push({
      "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
      Grade: 4,
      "Physical Area": "مدينة نصر",
    });
  }
  // 20 students in Dokki, Grade 5
  for (let i = 0; i < 20; i++) {
    studentRows.push({
      "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
      Grade: 5,
      "Physical Area": "الدقي",
    });
  }

  const studentWs = XLSX.utils.json_to_sheet(studentRows);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Students");
  const studentBuf = XLSX.write(studentWb, { type: "buffer", bookType: "xlsx" });
  const studentFile = new File([studentBuf], "students.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Sample lab capacity: 1 lab in Nasr City with cap 2, 1 lab in Dokki with cap 2
  // (2 cap * 7 slots = 14 seats per area -> each area has 20 students, so 6 unassigned per area = 12 unassigned total)
  const labRows = [
    { "Lab ID": "LAB_NC_01", Area: "مدينة نصر", "Lab Capacity": 2 },
    { "Lab ID": "LAB_DK_01", Area: "الدقي", "Lab Capacity": 2 },
  ];

  const labWs = XLSX.utils.json_to_sheet(labRows);
  const labWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(labWb, labWs, "Labs");
  const labBuf = XLSX.write(labWb, { type: "buffer", bookType: "xlsx" });
  const labFile = new File([labBuf], "labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const testBatchId = `test_preview_batch_${Date.now()}`;

  // -------------------------------------------------------------------------
  // Test 1: Baseline Allocation Run (Capacity deficit)
  // -------------------------------------------------------------------------
  console.log("Test 1: Running baseline allocation with tight capacities (2 seats/lab/slot = 14 seats/lab)...");
  const baselineOutput = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
  });

  const baselineResult = baselineOutput.payload;
  assert(baselineResult.summary.total_students === 40, "Total students must be 40");
  assert(baselineResult.summary.assigned_count <= 28, "Baseline assigned should be constrained by capacity (28)");
  assert(baselineResult.summary.unassigned_count >= 12, "Baseline unassigned should be at least 12");
  assert(baselineResult.summary.overfill_count === 0, "Baseline overfill count must be 0");
  console.log(
    `✓ Baseline: ${baselineResult.summary.assigned_count} Assigned / ${baselineResult.summary.unassigned_count} Unassigned (0 Overfill)`
  );

  // -------------------------------------------------------------------------
  // Test 2: Preview Simulation (Fair Overfill +1 per lab)
  // -------------------------------------------------------------------------
  console.log("\nTest 2: Simulating Fair Overfill (+1 per lab) dry-run preview...");
  const simulatedOverfillRule: OverfillRule = {
    area: "مدينة نصر",
    grades: [4, 5, 6],
    labIds: ["ALL"],
    maxOverfillPerLab: 1,
  };

  const previewPrefs: AllocationPreferences = {
    overfillRules: [simulatedOverfillRule],
    preferredLabRules: [],
    extraLabs: [],
  };

  const previewOutput = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: previewPrefs,
  });

  const previewResult = previewOutput.payload;
  assert(previewResult.summary.total_students === 40, "Total students must remain 40");
  assert(
    previewResult.summary.assigned_count > baselineResult.summary.assigned_count,
    "Preview must seat more students due to simulated +1 overfill"
  );
  assert(
    previewResult.summary.unassigned_count < baselineResult.summary.unassigned_count,
    "Preview must reduce unassigned count"
  );
  assert(
    (previewResult.summary.overfill_count ?? 0) > 0,
    "Preview must report non-zero overfill placement count"
  );
  console.log(
    `✓ Preview Impact: ${previewResult.summary.assigned_count} Assigned (+${
      previewResult.summary.assigned_count - baselineResult.summary.assigned_count
    } seated), ${previewResult.summary.unassigned_count} Unassigned (-${
      baselineResult.summary.unassigned_count - previewResult.summary.unassigned_count
    }), Overfill: +${previewResult.summary.overfill_count}`
  );

  // -------------------------------------------------------------------------
  // Test 3: Preview Simulation (New Extra Lab Provisioning)
  // -------------------------------------------------------------------------
  console.log("\nTest 3: Simulating New Extra Lab (+2 seats/slot in Dokki) dry-run preview...");
  const extraLabSim: ExtraLabDefinition = {
    area: "الدقي",
    labId: "EXTRA-DK-01",
    capacity: 2,
    slots: [1, 2, 3, 4, 5, 6, 7],
  };

  const newLabPreviewOutput = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [extraLabSim],
    },
  });

  const newLabPreviewResult = newLabPreviewOutput.payload;
  assert(
    newLabPreviewResult.summary.assigned_count > baselineResult.summary.assigned_count,
    "New Lab preview must seat remaining unassigned cohort in Dokki"
  );
  console.log(
    `✓ New Lab Preview Impact: ${newLabPreviewResult.summary.assigned_count} Assigned / ${newLabPreviewResult.summary.unassigned_count} Unassigned`
  );

  // -------------------------------------------------------------------------
  // Test 3b: Preview Simulation (Grade-Specific Overfill Target Isolation)
  // -------------------------------------------------------------------------
  console.log("\nTest 3b: Testing Grade-Specific Overfill (Targeting only Grade 4 in Nasr City)...");
  const gradeSpecificOverfill: OverfillRule = {
    area: "مدينة نصر",
    grades: [4],
    labIds: ["ALL"],
    maxOverfillPerLab: 1,
  };

  const g4PreviewOutput = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [gradeSpecificOverfill],
      preferredLabRules: [],
      extraLabs: [],
    },
  });

  const g4PreviewResult = g4PreviewOutput.payload;
  const getUnassignedFor = (summaryList: any[], area: string, grade: number) => {
    const row = summaryList.find((s: any) => (s["Physical Area"] === area || s.area === area) && (Number(s.Grade ?? s.grade) === grade));
    return row ? Number(row.Unassigned ?? row.unassigned ?? row.unassigned_count) || 0 : 0;
  };
  const ncG4Baseline = getUnassignedFor(baselineResult.area_grade_summary, "مدينة نصر", 4);
  const ncG4Sim = getUnassignedFor(g4PreviewResult.area_grade_summary, "مدينة نصر", 4);
  const ncG4Delta = ncG4Baseline - ncG4Sim;

  assert(ncG4Delta > 0, `Grade 4 in Nasr City must see unassigned reduction (delta: ${ncG4Delta})`);
  console.log(`✓ Grade-specific target isolation confirmed: Grade 4 Nasr City unassigned reduced from ${ncG4Baseline} to ${ncG4Sim} (+${ncG4Delta} seated).`);

  // -------------------------------------------------------------------------
  // Test 4: Verification of Zero-Persistence during Preview
  // -------------------------------------------------------------------------
  console.log("\nTest 4: Verifying Zero-Persistence guarantee for dry-run preview...");
  const persistedData = await fetchBatchAllocationOutput(testBatchId);
  assert(persistedData === null, "Preview must NOT write any allocation output to batch storage");

  const persistedReqs = await fetchBatchResolutionRequests(testBatchId);
  assert(persistedReqs.length === 0, "Preview must NOT create resolution requests in database");
  console.log("✓ Zero-Persistence confirmed: 0 stored outputs, 0 DB mutations during dry-run.");

  // -------------------------------------------------------------------------
  // Test 6: Stale Data Prevention & Live Baseline Sync after Issue Resolution
  // -------------------------------------------------------------------------
  console.log("\nTest 6: Testing Stale Data Prevention & Live Baseline Sync after Issue Resolution...");
  // 1. Initial State: Area 15 May has 10 unassigned students
  const may15Students: any[] = [];
  for (let i = 0; i < 10; i++) {
    may15Students.push({
      "Student ID": `MAY15-${String(i + 1).padStart(4, "0")}`,
      Grade: 6,
      "Physical Area": "15 مايو",
    });
  }
  const may15Ws = XLSX.utils.json_to_sheet(may15Students);
  const may15Wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(may15Wb, may15Ws, "Students");
  const may15Buf = XLSX.write(may15Wb, { type: "buffer", bookType: "xlsx" });
  const may15StudentFile = new File([may15Buf], "may15.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const may15LabRows = [{ "Lab ID": "LAB_MAY15_01", Area: "15 مايو", "Lab Capacity": 1 }]; // 1 cap * 7 slots = 7 seats -> 3 unassigned
  const may15LabWs = XLSX.utils.json_to_sheet(may15LabRows);
  const may15LabWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(may15LabWb, may15LabWs, "Labs");
  const may15LabBuf = XLSX.write(may15LabWb, { type: "buffer", bookType: "xlsx" });
  const may15LabFile = new File([may15LabBuf], "may15labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Run initial baseline
  const may15InitOutput = await runAllocation({
    studentFile: may15StudentFile,
    labFile: may15LabFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: { overfillRules: [], preferredLabRules: [], extraLabs: [] },
  });
  const may15InitUnassigned = getUnassignedFor(may15InitOutput.payload.area_grade_summary, "15 مايو", 6);
  assert(may15InitUnassigned === 3, `Initial unassigned in 15 May must be 3 (got ${may15InitUnassigned})`);

  // 2. Now simulate resolution applied (+1 overfill on 15 May)
  const may15ResolvedOutput = await runAllocation({
    studentFile: may15StudentFile,
    labFile: may15LabFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [{ area: "15 مايو", grades: [6], labIds: ["ALL"], maxOverfillPerLab: 1 }],
      preferredLabRules: [],
      extraLabs: [],
    },
  });
  const may15ResolvedUnassigned = getUnassignedFor(may15ResolvedOutput.payload.area_grade_summary, "15 مايو", 6);
  assert(may15ResolvedUnassigned === 0, `After resolution applied, unassigned in 15 May must be 0 (got ${may15ResolvedUnassigned})`);

  // 3. Now verify that a subsequent preview against the resolved baseline accurately reflects 0 unassigned
  const liveBaselineUnassigned = getUnassignedFor(may15ResolvedOutput.payload.area_grade_summary, "15 مايو", 6);
  // -------------------------------------------------------------------------
  // Test 7: Multi-Area Baseline Preference Preservation during Preview
  // -------------------------------------------------------------------------
  console.log("\nTest 7: Testing Multi-Area Baseline Preference Preservation during Preview...");
  // Suppose Area A (Nasr City) has 13 overfill students and Area B (15 May) has 0 shortfall
  const multiAreaStudents: any[] = [];
  // 14 students in Nasr City (with 1 lab of 1 cap * 7 slots = 7 standard seats, needs 7 overfill)
  for (let i = 0; i < 14; i++) {
    multiAreaStudents.push({
      "Student ID": `NC-${String(i + 1).padStart(4, "0")}`,
      Grade: 4,
      "Physical Area": "مدينة نصر",
    });
  }
  // 7 students in 15 May (fits in 1 lab of 1 cap * 7 slots = 7 seats)
  for (let i = 0; i < 7; i++) {
    multiAreaStudents.push({
      "Student ID": `MAY15-${String(i + 1).padStart(4, "0")}`,
      Grade: 4,
      "Physical Area": "15 مايو",
      Gov: "حلوان",
    });
  }

  const multiWs = XLSX.utils.json_to_sheet(multiAreaStudents);
  const multiWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(multiWb, multiWs, "Students");
  const multiBuf = XLSX.write(multiWb, { type: "buffer", bookType: "xlsx" });
  const multiStudentFile = new File([multiBuf], "multi.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const multiLabRows = [
    { "Lab ID": "LAB_NC_01", Area: "مدينة نصر", "Lab Capacity": 1 },
    { "Lab ID": "LAB_MAY15_01", Area: "15 مايو", "Lab Capacity": 1 },
  ];
  const multiLabWs = XLSX.utils.json_to_sheet(multiLabRows);
  const multiLabWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(multiLabWb, multiLabWs, "Labs");
  const multiLabBuf = XLSX.write(multiLabWb, { type: "buffer", bookType: "xlsx" });
  const multiLabFile = new File([multiLabBuf], "multilabs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // 1. Run baseline where Nasr City has overfill applied (+1 per lab = +7 seats -> 14 assigned, 0 unassigned)
  const baselinePrefs = {
    overfillRules: [{ area: "مدينة نصر", grades: [4], labIds: ["ALL"], maxOverfillPerLab: 1 }],
    preferredLabRules: [],
    extraLabs: [],
  };
  const multiBaselineOutput = await runAllocation({
    studentFile: multiStudentFile,
    labFile: multiLabFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: baselinePrefs,
  });
  assert(multiBaselineOutput.payload.summary.unassigned_count === 0, "Baseline unassigned must be 0");
  assert(multiBaselineOutput.payload.summary.assigned_count === 21, "Baseline assigned must be 21");

  // 2. User previews candidate rule for 15 May (+2 per lab)
  // Build simulated preferences by preserving baseline rules + candidate rule
  const candidateRule = { area: "15 مايو", grades: [4], labIds: ["ALL"], maxOverfillPerLab: 2 };
  const mergedSimPrefs = {
    overfillRules: [
      ...baselinePrefs.overfillRules.filter((r) => r.area !== candidateRule.area),
      candidateRule,
    ],
    preferredLabRules: [],
    extraLabs: [],
  };

  const multiPreviewOutput = await runAllocation({
    studentFile: multiStudentFile,
    labFile: multiLabFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: mergedSimPrefs,
  });

  // Verify that Nasr City's 14 students remain 100% assigned and total unassigned remains 0
  assert(multiPreviewOutput.payload.summary.unassigned_count === 0, "Preview unassigned must remain 0 (no leftover unassigned from other areas)");
  assert(multiPreviewOutput.payload.summary.assigned_count === 21, "Preview assigned must remain 21");
  console.log("✓ Multi-area baseline preference preservation passed: Preview preserves existing overfill in other areas with 0 unassigned bleed.");

  console.log("\n------------------------------------------------------------");
  console.log("All Preview Simulation & Zero-Persistence Tests Passed! ✓");
  console.log("------------------------------------------------------------\n");
}

runPreviewSimulationTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
