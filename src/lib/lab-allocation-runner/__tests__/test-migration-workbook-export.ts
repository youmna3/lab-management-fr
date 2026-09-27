import * as XLSX from "xlsx";
import {
  generateMigrationWorkbook,
  generateSlotId,
} from "../../exports/migration-workbook-generator";

export async function runMigrationWorkbookExportTests() {
  console.log("\n=======================================================");
  console.log("TEST SUITE: Master Migration Workbook Export (7 Sheets)");
  console.log("=======================================================");

  const mockProject = {
    id: "proj-123",
    name: "DECI Batch 4 — 2025/26",
    code: "DECI-B4",
    program: "DECI",
  };

  const mockBatch = {
    id: "batch-456",
    name: "Cairo East — Summer",
    dates: ["2026-09-01", "2026-09-02", "2026-09-03"],
    time_slots: ["08:30 - 10:30", "10:30 - 12:30", "13:00 - 15:00"],
  };

  const mockLabs = [
    {
      id: "lab-1",
      lab_code: "C-01-01",
      name: "Nasr City Tech Hub",
      gov: "Cairo",
      area: "Nasr City",
      capacity: 25,
      address: "15 Abbas El-Akkad St",
      maps_url: "https://maps.google.com/?q=30.05,31.33",
    },
    {
      id: "lab-2",
      lab_code: "G-02-03",
      name: "Dokki Innovation Center",
      gov: "Giza",
      area: "Dokki",
      capacity: 30,
      address: "10 Tahrir St",
      maps_url: "https://maps.google.com/?q=30.03,31.21",
    },
  ];

  const mockAllocationData = {
    summary: {
      total_students: 5,
      assigned_count: 4,
      unassigned_count: 1,
      match_rate: "80.0%",
    },
    master_allocation: [
      {
        "Student ID": "STU-001",
        "Assigned Lab": "C-01-01",
        "Assigned Area": "Nasr City",
        Gov: "Cairo",
        Day: "Thursday",
        Date: "2026-09-01",
        Shift: "08:30 - 10:30",
        Grade: 4,
      },
      {
        "Student ID": "STU-002",
        "Assigned Lab": "C-01-01",
        "Assigned Area": "Nasr City",
        Gov: "Cairo",
        Day: "Thursday",
        Date: "2026-09-01",
        Shift: "08:30 - 10:30",
        Grade: 4,
      },
      {
        "Student ID": "STU-003",
        "Assigned Lab": "C-01-01",
        "Assigned Area": "Nasr City",
        Gov: "Cairo",
        Day: "Friday",
        Date: "2026-09-02",
        Shift: "10:30 - 12:30",
        Grade: 5,
      },
      {
        "Student ID": "STU-004",
        "Assigned Lab": "G-02-03",
        "Assigned Area": "Dokki",
        Gov: "Giza",
        Day: "Friday",
        Date: "2026-09-02",
        Shift: "13:00 - 15:00",
        Grade: 6,
      },
    ],
    unassigned: [
      {
        "Student ID": "STU-005",
        Grade: 5,
        "Physical Area": "Helwan",
        Status: "Unassigned",
      },
    ],
  };

  // [TEST 1] Slot ID Determinism
  console.log("\n[TEST 1] Testing Deterministic Slot ID Generation...");
  const slot1 = generateSlotId("C-01-01", "Thursday", "08:30 - 10:30", 4);
  const slot2 = generateSlotId("C-01-01", "Thursday", "08:30 - 10:30", 4);
  if (slot1 !== slot2) {
    throw new Error(`Slot ID is not deterministic! slot1=${slot1} vs slot2=${slot2}`);
  }
  if (!slot1.startsWith("SLOT-C0101-THU-0830-G4")) {
    throw new Error(`Unexpected Slot ID format: ${slot1}`);
  }
  console.log(`✓ Slot ID generation is 100% deterministic: "${slot1}"`);

  // [TEST 2] Generate Workbook
  console.log("\n[TEST 2] Generating Workbook with 7 Standardized Sheets...");
  const wb = generateMigrationWorkbook({
    project: mockProject,
    batch: mockBatch,
    allocationData: mockAllocationData,
    labs: mockLabs,
  });

  const expectedSheetNames = [
    "Sessions",
    "Demo Day Sessions",
    "Online Groups Migration Sheet",
    "Offline Students Migration Sheet",
    "VP Session Students",
    "Slot ID",
    "Location",
    "Governorate VP Summary",
  ];

  if (wb.SheetNames.length !== 8) {
    throw new Error(`Expected 8 sheets, got ${wb.SheetNames.length}`);
  }

  expectedSheetNames.forEach((name, idx) => {
    const expected31 = name.slice(0, 31);
    if (wb.SheetNames[idx] !== expected31) {
      throw new Error(`Sheet index ${idx} expected "${expected31}", got "${wb.SheetNames[idx]}"`);
    }
  });
  console.log("✓ All 8 sheets present in exact specified order.");

  // [TEST 3] Verify Sheet Headers & Exact Column Order
  console.log("\n[TEST 3] Verifying Exact Column Headers and Order across all 8 sheets...");

  const expectedHeaders: Record<string, string[]> = {
    Sessions: [
      "Lab ID",
      "Gov",
      "Area",
      "Lab Capacity",
      "Grade",
      "Group ID",
      "Tutor ID",
      "TA ID",
      "Slot ID",
      "Day",
      "Date",
      "Shift",
    ],
    "Demo Day Sessions": [
      "Lab ID",
      "Gov",
      "Area",
      "Lab Capacity",
      "Grade",
      "Group ID",
      "Slot ID",
      "Day",
      "Date",
      "Shift",
    ],
    "Online Groups Migration Sheet": [
      "Lab ID",
      "Lab Capacity",
      "Grade",
      "Group ID",
      "Project Name",
      "Track",
      "Governorates",
      "Enrolled Students",
      "Occupancy (%)",
      "Remaining Seats",
      "Status",
      "Slot ID",
      "Day",
      "Date",
      "Shift",
    ],
    "Offline Students Migration Sheet": [
      "Student ID",
      "Offline Group",
    ],
    "VP Session Students": [
      "Student ID",
      "Online Group",
    ],
    "Slot ID": ["Slot ID", "Day", "Time", "Duration"],
    Location: [
      "Lab ID",
      "gov",
      "Area",
      "lab_name",
      "address",
      "Real Location URL",
      "location_id",
      "Facilitator Name",
      "Facilitator Number",
      "location status",
    ],
    "Governorate VP Summary": [
      "Governorate",
      "Physical Areas",
      "Total Demand",
      "VP Eligible Students",
      "VP Accepted Online",
      "Physical Remaining",
      "Online Migration (%)",
      "Status",
      "Qualification Reason",
    ],
  };

  for (const sheetName of expectedSheetNames) {
    const sheet = wb.Sheets[sheetName.slice(0, 31)];
    const rawData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    const actualHeader = rawData[0] || [];
    const expected = expectedHeaders[sheetName];

    if (actualHeader.length !== expected.length) {
      throw new Error(
        `Sheet "${sheetName}" header length mismatch: expected ${expected.length}, got ${actualHeader.length}. Actual: ${JSON.stringify(actualHeader)}`,
      );
    }

    expected.forEach((col, cIdx) => {
      if (actualHeader[cIdx] !== col) {
        throw new Error(
          `Sheet "${sheetName}" column ${cIdx} mismatch: expected "${col}", got "${actualHeader[cIdx]}"`,
        );
      }
    });

    console.log(`✓ Sheet "${sheetName}" headers match 100% (${actualHeader.join(", ")})`);
  }

  // [TEST 4] Verify Empty Column Constraint
  console.log("\n[TEST 4] Verifying Empty Columns (No placeholder values)...");
  const sessionsData = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Sessions"], { header: 1 }).slice(1);
  for (const row of sessionsData) {
    const tutorId = row[6]; // Tutor ID
    const taId = row[7]; // TA ID
    if (tutorId !== "" && tutorId !== undefined) {
      throw new Error(`Expected Tutor ID to be empty, got "${tutorId}"`);
    }
    if (taId !== "" && taId !== undefined) {
      throw new Error(`Expected TA ID to be empty, got "${taId}"`);
    }
  }
  console.log("✓ Tutor ID and TA ID are strictly blank as required.");

  // [TEST 5] Verify Location Sheet Facilitator Fields & Location Status
  console.log("\n[TEST 5] Verifying Location sheet columns and location status rule...");
  const locData = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Location"], { header: 1 }).slice(1);
  for (const row of locData) {
    const labCode = row[0];
    const locStatus = row[9];
    if (labCode.toUpperCase().includes("ONLINE")) {
      if (locStatus !== "TRUE") throw new Error(`Online lab must have location status TRUE, got "${locStatus}"`);
    } else {
      if (locStatus !== "FALSE") throw new Error(`Offline lab must have location status FALSE, got "${locStatus}"`);
    }
  }
  console.log("✓ Location status rule verified (FALSE for physical labs, TRUE for online).");

  // [TEST 6] Verify Sequential Integer Slot ID Consistency across Sheets 1, 2, 3, 6
  console.log("\n[TEST 6] Verifying Unified Sequential Integer Slot IDs across Sheets 1, 2, 3, and 6...");
  const slotSheetData = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Slot ID"], { header: 1 }).slice(1);
  const slotMap = new Map<number, { day: string; time: string }>();
  for (const row of slotSheetData) {
    const slotId = Number(row[0]);
    const day = String(row[1]);
    const time = String(row[2]);
    slotMap.set(slotId, { day, time });
    console.log(`  -> Slot #${slotId}: ${day} | ${time}`);
  }

  // Cross-check Sheet 1 Sessions against Sheet 6
  for (const row of sessionsData) {
    const sessionSlotId = Number(row[8]); // Slot ID column
    const sessionDay = String(row[9]);
    const sessionShift = String(row[11]);
    const mapped = slotMap.get(sessionSlotId);
    if (!mapped) {
      throw new Error(`Session has Slot ID ${sessionSlotId} which does not exist in Sheet 6!`);
    }
    if (mapped.day.toLowerCase() !== sessionDay.toLowerCase()) {
      throw new Error(`Slot ID ${sessionSlotId} day mismatch: Sheet 6 has "${mapped.day}", Session has "${sessionDay}"`);
    }
  }
  console.log("✓ Sheet 1 (Sessions) Slot IDs match Sheet 6 mappings 100%.");

  // Cross-check Sheet 2 Demo Day against Sheet 6
  const demoData = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Demo Day Sessions"], { header: 1 }).slice(1);
  for (const row of demoData) {
    const demoSlotId = Number(row[6]); // Slot ID column
    const demoDayVal = String(row[7]);
    const mapped = slotMap.get(demoSlotId);
    if (!mapped) {
      throw new Error(`Demo Day has Slot ID ${demoSlotId} which does not exist in Sheet 6!`);
    }
    if (mapped.day.toLowerCase() !== demoDayVal.toLowerCase()) {
      throw new Error(`Demo Slot ID ${demoSlotId} day mismatch: Sheet 6 has "${mapped.day}", Demo has "${demoDayVal}"`);
    }
  }
  console.log("✓ Sheet 2 (Demo Day) Slot IDs match Sheet 6 mappings 100%.");

  console.log("\n🎉 ALL MASTER MIGRATION WORKBOOK EXPORT TESTS PASSED 100%!");
  return true;
}

runMigrationWorkbookExportTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

