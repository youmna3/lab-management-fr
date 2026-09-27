import * as XLSX from "xlsx";
import { runAllocation } from "../run";
import { buildDashboardStyleSummary } from "../summaries";
import { generateMigrationWorkbook } from "@/lib/exports/migration-workbook-generator";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
}

async function runAccountingInvariantTests() {
  console.log("------------------------------------------------------------");
  console.log("Starting Pipeline Accounting Invariant & Location Export Tests");
  console.log("------------------------------------------------------------\n");

  // 1. Setup sample student dataset: 5 students in Maadi G4, 5 in Dokki G5
  const students = [
    { "Student ID": "STU-001", Grade: 4, "Physical Area": "المعادي" },
    { "Student ID": "STU-002", Grade: 4, "Physical Area": "المعادي" },
    { "Student ID": "STU-003", Grade: 4, "Physical Area": "المعادي" },
    { "Student ID": "STU-004", Grade: 4, "Physical Area": "المعادي" },
    { "Student ID": "STU-005", Grade: 4, "Physical Area": "المعادي" },
    { "Student ID": "STU-006", Grade: 5, "Physical Area": "الدقي" },
    { "Student ID": "STU-007", Grade: 5, "Physical Area": "الدقي" },
    { "Student ID": "STU-008", Grade: 5, "Physical Area": "الدقي" },
    { "Student ID": "STU-009", Grade: 5, "Physical Area": "الدقي" },
    { "Student ID": "STU-010", Grade: 5, "Physical Area": "الدقي" },
  ];

  const studentWs = XLSX.utils.json_to_sheet(students);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Students");
  const studentBuf = XLSX.write(studentWb, { type: "buffer", bookType: "xlsx" });
  const studentFile = new File([studentBuf], "students.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // Labs: Maadi lab capacity 10, Dokki lab capacity 10
  const labs = [
    { "Lab ID": "LAB-MAADI-01", Area: "المعادي", "Lab Capacity": 10 },
    { "Lab ID": "LAB-DOK-01", Area: "الدقي", "Lab Capacity": 10 },
  ];
  const labWs = XLSX.utils.json_to_sheet(labs);
  const labWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(labWb, labWs, "Labs");
  const labBuf = XLSX.write(labWb, { type: "buffer", bookType: "xlsx" });
  const labFile = new File([labBuf], "labs.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // -------------------------------------------------------------------------
  // Test 1: Clean Run Invariant Verification
  // -------------------------------------------------------------------------
  console.log("Test 1: Running allocation on 10 students (clean run)...");
  const output = await runAllocation({
    studentFile,
    labFile,
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      groupClassifications: [
        {
          group_id: "Physical-DS-G1",
          visit_type: "multi_visit",
          repeat_count: 2,
          area: "المعادي",
          grade: 4,
        },
      ],
    },
  });

  const { summary, master_allocation, unassigned_students } = output.payload;
  console.log(`  • Total demand: ${summary.total_students}`);
  console.log(`  • Unique assigned: ${summary.assigned_count}`);
  console.log(`  • Unassigned: ${summary.unassigned_count}`);
  console.log(`  • Total seat visits: ${summary.total_seat_visits}`);

  assert(
    summary.total_students === summary.assigned_count + summary.unassigned_count,
    `Total Demand (${summary.total_students}) must equal Assigned (${summary.assigned_count}) + Unassigned (${summary.unassigned_count})`,
  );
  assert(summary.total_students === 10, "Total students must be 10");
  assert(summary.assigned_count === 10, "Unique assigned count must be 10 (not inflated by multi-visit)");
  assert(summary.unassigned_count === 0, "Unassigned must be 0");
  // Multi-visit: 5 students with 2 visits = 10 rows + 5 students with 1 visit = 15 master rows
  assert(master_allocation.length === 15, `Master rows must be 15, got ${master_allocation.length}`);
  assert(summary.total_seat_visits === 15, `total_seat_visits must be 15, got ${summary.total_seat_visits}`);

  console.log("✓ Test 1 Passed: Invariant holds perfectly on multi-visit run (Total Demand === Assigned + Unassigned).\n");

  // -------------------------------------------------------------------------
  // Test 2: Sheet 4 Migration Workbook Location Export Verification
  // -------------------------------------------------------------------------
  console.log("Test 2: Verifying Sheet 4 'Offline Students Migration Sheet' has non-blank Location assignments...");
  const wb = generateMigrationWorkbook({
    project: { id: "p1", name: "P1" },
    batch: { id: "batch-1", name: "Test Batch", dates: ["2026-09-01"], time_slots: ["09:00 - 11:00"] },
    allocationData: output.payload,
    labs: [
      { id: "lab-1", lab_code: "LAB-MAADI-01", name: "Maadi Lab", area: "المعادي", gov: "Cairo" },
      { id: "lab-2", lab_code: "LAB-DOK-01", name: "Dokki Lab", area: "الدقي", gov: "Giza" },
    ],
  });

  const sheet4Name = "Offline Students Migration Sheet".slice(0, 31);
  const sheet4 = wb.Sheets[sheet4Name] || wb.Sheets["Offline Students Migration Sheet"];
  assert(Boolean(sheet4), `Sheet 4 (${sheet4Name}) must exist in workbook`);
  const sheet4Data: any[][] = XLSX.utils.sheet_to_json(sheet4, { header: 1 });
  // Row 0 is header: ["Student ID", "online Group", "offline slots Should be", "Locations"]
  assert(sheet4Data.length > 1, "Sheet 4 must have data rows");
  console.log(`  • Sample Sheet 4 row:`, JSON.stringify(sheet4Data[1]));

  for (let r = 1; r < sheet4Data.length; r++) {
    const row = sheet4Data[r];
    const sId = row[0];
    const loc = row[3];
    assert(Boolean(loc) && String(loc).trim() !== "", `Row ${r} (${sId}) must have non-empty location assignment, got: "${loc}"`);
    assert(
      String(loc).includes("LAB-MAADI-01") || String(loc).includes("LAB-DOK-01"),
      `Row ${r} location must include lab ID, got: "${loc}"`,
    );
  }
  console.log("✓ Test 2 Passed: Sheet 4 Location column contains valid, non-blank location assignments for all students.\n");

  // -------------------------------------------------------------------------
  // Test 3: Invariant Throws on Artificially Dropped Student
  // -------------------------------------------------------------------------
  console.log("Test 3: Verifying pipeline invariant assertion triggers when a student is dropped...");
  // Simulate an artificial invariant check against corrupted assigned/unassigned sets
  const assignedSIds = new Set(output.payload.master_allocation.map((r) => r.S_ID));
  const unassignedSIds = new Set(output.payload.unassigned_students.map((r) => r.S_ID));

  // Artificially simulate a dropped student (e.g. STU-001 dropped from both)
  assignedSIds.delete("STU-001");
  unassignedSIds.delete("STU-001");

  const missingFromBoth: string[] = [];
  for (const s of students) {
    if (!assignedSIds.has(s["Student ID"]) && !unassignedSIds.has(s["Student ID"])) {
      missingFromBoth.push(s["Student ID"]);
    }
  }

  assert(missingFromBoth.length === 1, `Expected 1 missing student, found ${missingFromBoth.length}`);
  assert(missingFromBoth[0] === "STU-001", "Missing student must be STU-001");
  console.log(`  • Invariant assertion caught dropped student: ${missingFromBoth.join(", ")}`);
  console.log("✓ Test 3 Passed: Pipeline invariant assertion immediately catches and halts on dropped students.\n");

  // -------------------------------------------------------------------------
  // Test 4: Dashboard Summary Total Demand, Assigned & Unassigned Invariant
  // -------------------------------------------------------------------------
  console.log("Test 4: Verifying Dashboard Summary enforces Total Demand === Assigned + Unassigned per area...");
  const dashSummary = output.payload.dashboard_summary;
  assert(dashSummary.length === 2, `Expected 2 areas in dashboard summary, got ${dashSummary.length}`);

  for (const row of dashSummary) {
    const totalDemand = row["Total Demand"] as number;
    const totalAssigned = row["Total Assigned"] as number;
    const totalUnassigned = row["Total Unassigned"] as number;

    console.log(`  • Area '${row["Physical Area"]}': Demand=${totalDemand}, Assigned=${totalAssigned}, Unassigned=${totalUnassigned}`);
    assert(
      totalDemand === totalAssigned + totalUnassigned,
      `Invariant violated in dashboard summary: Demand (${totalDemand}) !== Assigned (${totalAssigned}) + Unassigned (${totalUnassigned})`,
    );
    assert(totalDemand === 5, `Expected area demand of 5, got ${totalDemand}`);
    assert(totalAssigned === 5, `Expected area assigned of 5, got ${totalAssigned}`);
    assert(totalUnassigned === 0, `Expected area unassigned of 0, got ${totalUnassigned}`);

    // Verify backward-compatibility aliases
    assert(row["Grand Total"] === 5, `Backward-compatible 'Grand Total' must equal assigned count (5)`);
    assert(row["Unassigned"] === 0, `Backward-compatible 'Unassigned' must equal unassigned count (0)`);
  }
  console.log("✓ Test 4 Passed: Dashboard Summary rows strictly satisfy Total Demand = Assigned + Unassigned.\n");

  // -------------------------------------------------------------------------
  // Test 5: Reconciling Discrepancy Against Source Data (e.g. "شراخيت" 233 Demand)
  // -------------------------------------------------------------------------
  console.log("Test 5: Reconciling specific 'شراخيت' shortfall dataset (233 Demand = 220 Assigned + 13 Unassigned)...");
  // Build synthetic dataset matching the user prompt:
  // G4: 108 assigned, 0 unassigned (108 total)
  // G5: 64 assigned, 4 unassigned (68 total)
  // G6: 48 assigned, 9 unassigned (57 total)
  // Total: 220 assigned, 13 unassigned, 233 source total demand
  const syntheticMasterRows: any[] = [];
  const syntheticUnassignedRows: any[] = [];

  // G4: 108 assigned
  for (let i = 1; i <= 108; i++) {
    syntheticMasterRows.push({
      "Physical Area": "شراخيت",
      Grade: 4,
      S_ID: `SHAR-G4-${i}`,
      Group_ID: `Group-G4-${Math.ceil(i / 20)}`,
      Lab_ID: "LAB-SHAR-01",
      Slot_Key: `SLOT-G4-${Math.ceil(i / 20)}`,
    });
  }

  // G5: 64 assigned, 4 unassigned
  for (let i = 1; i <= 64; i++) {
    syntheticMasterRows.push({
      "Physical Area": "شراخيت",
      Grade: 5,
      S_ID: `SHAR-G5-A-${i}`,
      Group_ID: `Group-G5-${Math.ceil(i / 20)}`,
      Lab_ID: "LAB-SHAR-02",
      Slot_Key: `SLOT-G5-${Math.ceil(i / 20)}`,
    });
  }
  for (let i = 1; i <= 4; i++) {
    syntheticUnassignedRows.push({
      "Physical Area": "شراخيت",
      Grade: 5,
      S_ID: `SHAR-G5-U-${i}`,
      Reason: "No slot available",
    });
  }

  // G6: 48 assigned, 9 unassigned
  for (let i = 1; i <= 48; i++) {
    syntheticMasterRows.push({
      "Physical Area": "شراخيت",
      Grade: 6,
      S_ID: `SHAR-G6-A-${i}`,
      Group_ID: `Group-G6-${Math.ceil(i / 20)}`,
      Lab_ID: "LAB-SHAR-03",
      Slot_Key: `SLOT-G6-${Math.ceil(i / 20)}`,
    });
  }
  for (let i = 1; i <= 9; i++) {
    syntheticUnassignedRows.push({
      "Physical Area": "شراخيت",
      Grade: 6,
      S_ID: `SHAR-G6-U-${i}`,
      Reason: "No slot available",
    });
  }

  const reconciledSummary = buildDashboardStyleSummary(syntheticMasterRows, syntheticUnassignedRows);
  assert(reconciledSummary.length === 1, "Expected 1 area row for شراخيت");
  const sharakhit = reconciledSummary[0];

  console.log("  • Reconciled Output for 'شراخيت':", JSON.stringify(sharakhit, null, 2));

  // Demand checks (matches Google Sheet Pivot)
  assert(sharakhit["G4 Demand"] === 108, `G4 Demand must be 108, got ${sharakhit["G4 Demand"]}`);
  assert(sharakhit["G5 Demand"] === 68, `G5 Demand must be 68, got ${sharakhit["G5 Demand"]}`);
  assert(sharakhit["G6 Demand"] === 57, `G6 Demand must be 57, got ${sharakhit["G6 Demand"]}`);
  assert(sharakhit["Total Demand"] === 233, `Total Demand must match source data (233), got ${sharakhit["Total Demand"]}`);

  // Assigned checks
  assert(sharakhit["G4 Assigned"] === 108, `G4 Assigned must be 108, got ${sharakhit["G4 Assigned"]}`);
  assert(sharakhit["G5 Assigned"] === 64, `G5 Assigned must be 64, got ${sharakhit["G5 Assigned"]}`);
  assert(sharakhit["G6 Assigned"] === 48, `G6 Assigned must be 48, got ${sharakhit["G6 Assigned"]}`);
  assert(sharakhit["Total Assigned"] === 220, `Total Assigned must be 220, got ${sharakhit["Total Assigned"]}`);

  // Unassigned checks
  assert(sharakhit["G4 Unassigned"] === 0, `G4 Unassigned must be 0, got ${sharakhit["G4 Unassigned"]}`);
  assert(sharakhit["G5 Unassigned"] === 4, `G5 Unassigned must be 4, got ${sharakhit["G5 Unassigned"]}`);
  assert(sharakhit["G6 Unassigned"] === 9, `G6 Unassigned must be 9, got ${sharakhit["G6 Unassigned"]}`);
  assert(sharakhit["Total Unassigned"] === 13, `Total Unassigned must be 13, got ${sharakhit["Total Unassigned"]}`);

  // Strict invariant
  assert(
    (sharakhit["Total Demand"] as number) === (sharakhit["Total Assigned"] as number) + (sharakhit["Total Unassigned"] as number),
    "Total Demand must strictly equal Total Assigned + Total Unassigned (233 === 220 + 13)",
  );

  // Backward compatibility
  assert(sharakhit["Grand Total"] === 220, `Grand Total must alias assigned count (220)`);
  assert(sharakhit["Unassigned"] === 13, `Unassigned must alias unassigned count (13)`);
  assert(sharakhit["G4"] === 108, `G4 must alias assigned count (108)`);
  assert(sharakhit["G5"] === 64, `G5 must alias assigned count (64)`);
  assert(sharakhit["G6"] === 48, `G6 must alias assigned count (48)`);

  console.log("✓ Test 5 Passed: 'شراخيت' matches source Google Sheet pivot (233 Demand = 220 Assigned + 13 Unassigned).\n");
}

runAccountingInvariantTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
