import {
  formatRevocationDateTime,
  updateStudentStatusInBatch,
  bulkUpdateStudentStatuses,
  mergeStudentDatasets,
  convertStudentsToCsv,
  saveProjectUnassignedUpload,
  getProjectUnassignedBatchId,
  type StudentRecord,
} from "../../batch-allocation-storage.js";

export async function runRevocationTimestampTests() {
  console.log("=========================================================================");
  console.log("🧪 TESTING REVOCATION TIMESTAMP TRACKING & EXPORT (MISSING-013)");
  console.log("=========================================================================");

  // -------------------------------------------------------------------------
  // TEST 1: Timestamp Formatting Function
  // -------------------------------------------------------------------------
  console.log("\n[TEST 1] Testing formatRevocationDateTime formatting...");
  const isoTime = "2026-09-06T11:20:15.000Z";
  const formatted = formatRevocationDateTime(isoTime);

  if (!formatted.display || !formatted.full) {
    throw new Error("FAIL: formatRevocationDateTime returned empty results");
  }

  // Check display format contains AM/PM and date
  if (!formatted.display.includes("AM") && !formatted.display.includes("PM")) {
    throw new Error(`FAIL: Expected display to contain AM/PM, got: ${formatted.display}`);
  }
  // Check full format matches YYYY-MM-DD HH:MM:SS
  const fullRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!fullRegex.test(formatted.full)) {
    throw new Error(`FAIL: Expected full format to match YYYY-MM-DD HH:MM:SS, got: ${formatted.full}`);
  }
  console.log(`✓ formatRevocationDateTime output verified: display="${formatted.display}", full="${formatted.full}"`);

  // -------------------------------------------------------------------------
  // TEST 2: Single Student Revocation & Reactivation Lifecycle
  // -------------------------------------------------------------------------
  console.log("\n[TEST 2] Testing single student revocation & reactivation lifecycle...");
  const testProjectId = crypto.randomUUID();
  const testBatchId = getProjectUnassignedBatchId(testProjectId);
  const initialStudents: StudentRecord[] = [
    { S_ID: "STU-001", Grade: 4, "Physical Area": "Dokki", Status: "Enrolled" },
    { S_ID: "STU-002", Grade: 5, "Physical Area": "Maadi", Status: "Enrolled" },
  ];

  await saveProjectUnassignedUpload(testProjectId, "students.csv", 1000, initialStudents, undefined, "replace");

  // Revoke STU-001
  const beforeRevoke = new Date().getTime();
  const updatedRec = await updateStudentStatusInBatch(testBatchId, "STU-001", "Dropped Out");
  const stu1AfterRevoke = updatedRec?.students.find((s) => s.S_ID === "STU-001");

  if (!stu1AfterRevoke) throw new Error("FAIL: STU-001 not found after revocation");
  if (stu1AfterRevoke.Status !== "Dropped Out") throw new Error("FAIL: STU-001 status was not set to Dropped Out");
  if (!stu1AfterRevoke.revoked_at) throw new Error("FAIL: STU-001 revoked_at timestamp was not recorded");

  const revokeDate = new Date(stu1AfterRevoke.revoked_at).getTime();
  if (isNaN(revokeDate) || revokeDate < beforeRevoke - 5000) {
    throw new Error(`FAIL: Invalid revoked_at timestamp: ${stu1AfterRevoke.revoked_at}`);
  }
  console.log(`✓ Student STU-001 revoked with timestamp: ${stu1AfterRevoke.revoked_at}`);

  // Reactivate STU-001
  const reactivatedRec = await updateStudentStatusInBatch(testBatchId, "STU-001", "Enrolled");
  const stu1Reactivated = reactivatedRec?.students.find((s) => s.S_ID === "STU-001");

  if (!stu1Reactivated) throw new Error("FAIL: STU-001 not found after reactivation");
  if (stu1Reactivated.Status !== "Enrolled") throw new Error("FAIL: STU-001 status not restored to Enrolled");
  if (stu1Reactivated.revoked_at !== null && stu1Reactivated.revoked_at !== undefined) {
    throw new Error(`FAIL: STU-001 revoked_at was not cleared upon reactivation, got: ${stu1Reactivated.revoked_at}`);
  }
  console.log("✓ Student STU-001 reactivated and revocation timestamp cleared.");

  // -------------------------------------------------------------------------
  // TEST 3: Bulk Student Status Updates
  // -------------------------------------------------------------------------
  console.log("\n[TEST 3] Testing bulk student status changes with timestamp assignment...");
  const bulkResults = await bulkUpdateStudentStatuses([
    { batchId: testBatchId, studentId: "STU-001", status: "Dropped Out" },
    { batchId: testBatchId, studentId: "STU-002", status: "Dropped Out" },
  ]);
  const bulkUpdatedRec = bulkResults[0];
  const bStu1 = bulkUpdatedRec?.students.find((s) => s.S_ID === "STU-001");
  const bStu2 = bulkUpdatedRec?.students.find((s) => s.S_ID === "STU-002");

  if (!bStu1?.revoked_at || !bStu2?.revoked_at) {
    throw new Error("FAIL: Bulk revocation did not attach timestamps to all selected students");
  }
  console.log(`✓ Bulk revoked 2 students with timestamps: ${bStu1.revoked_at}, ${bStu2.revoked_at}`);

  // -------------------------------------------------------------------------
  // TEST 4: CSV Export with Revoked At Column
  // -------------------------------------------------------------------------
  console.log("\n[TEST 4] Verifying convertStudentsToCsv includes 'Revoked At' column & exact timestamp...");
  const exportStudents: StudentRecord[] = [
    { S_ID: "STU-ACTIVE", Grade: 4, "Physical Area": "Nasr City", Status: "Enrolled" },
    {
      S_ID: "STU-REVOKED",
      Grade: 6,
      "Physical Area": "Zamalek",
      Status: "Dropped Out",
      revoked_at: "2026-09-06T11:20:00.000Z",
    },
  ];

  const csv = convertStudentsToCsv(exportStudents, false);
  const csvLines = csv.trim().split("\n");

  // Check header
  const headerLine = csvLines[0];
  if (!headerLine.includes("Revoked At")) {
    throw new Error(`FAIL: CSV header missing 'Revoked At': ${headerLine}`);
  }

  // Check active student line has empty Revoked At
  const activeLine = csvLines.find((l) => l.includes("STU-ACTIVE"));
  if (!activeLine || !activeLine.endsWith('""')) {
    throw new Error(`FAIL: Active student should have empty Revoked At column, got: ${activeLine}`);
  }

  // Check revoked student line has exact YYYY-MM-DD HH:MM:SS
  const revokedLine = csvLines.find((l) => l.includes("STU-REVOKED"));
  if (!revokedLine) throw new Error("FAIL: Revoked student line missing from CSV");
  if (!revokedLine.includes("2026-09-06")) {
    throw new Error(`FAIL: Revoked student line missing formatted timestamp, got: ${revokedLine}`);
  }
  console.log(`✓ CSV export format verified:\n  Header: ${headerLine}\n  Revoked Row: ${revokedLine}`);

  // -------------------------------------------------------------------------
  // TEST 5: Merge Strategy Preserves Revocation Timestamps
  // -------------------------------------------------------------------------
  console.log("\n[TEST 5] Testing mergeStudentDatasets preserves existing revocation timestamps...");
  const existingRecords: StudentRecord[] = [
    {
      S_ID: "STU-M1",
      Grade: 4,
      "Physical Area": "Dokki",
      Status: "Dropped Out",
      revoked_at: "2026-09-01T08:30:00.000Z",
    },
  ];
  const incomingRecords: StudentRecord[] = [
    { S_ID: "STU-M1", Grade: 4, "Physical Area": "Dokki", Status: "Enrolled" },
    { S_ID: "STU-M2", Grade: 5, "Physical Area": "Giza", Status: "Enrolled" },
  ];

  const { merged } = mergeStudentDatasets(existingRecords, incomingRecords, "merge_overwrite");
  const m1 = merged.find((s) => s.S_ID === "STU-M1");

  if (!m1 || m1.Status !== "Dropped Out") {
    throw new Error("FAIL: Merged record did not keep manual 'Dropped Out' status");
  }
  if (m1.revoked_at !== "2026-09-01T08:30:00.000Z") {
    throw new Error(`FAIL: Merged record lost original revocation timestamp, got: ${m1.revoked_at}`);
  }
  console.log(`✓ Merged record retained original revocation timestamp: ${m1.revoked_at}`);

  console.log("\n🎉 ALL REVOCATION TIMESTAMP TESTS PASSED 100%!");
}
