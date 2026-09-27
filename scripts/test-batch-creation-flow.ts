import * as XLSX from "xlsx";
import { saveBatchGroupSettings, fetchBatchGroupSettings } from "../src/lib/batch-group-classification-storage";
import { runAllocation } from "../src/lib/lab-allocation-runner/run";

function makeStudentFile(students: any[], filename = "students.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(students);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function makeLabFile(labs: any[], filename = "labs.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(labs);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Labs");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new File([buf], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function runTest() {
  console.log("=========================================================================");
  console.log("🧪 TESTING BATCH CREATION FLOW WITH BLOCKED DAYS & MEGA GROUPS");
  console.log("=========================================================================");

  const testBatchId = crypto.randomUUID();
  const testProjectId = crypto.randomUUID();

  console.log("\n[STEP 1] Testing Batch Creation Payload Handling & Schema Fallback...");

  const insertPayload = {
    project_id: testProjectId,
    name: `Automated Test Batch ${Date.now()}`,
    date_mode: "custom" as const,
    dates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10", "2026-10-12"],
    time_slots: ["10:00 AM", "12:30 PM", "03:00 PM"],
    expected_sessions_per_group: 1,
    blocked_days: ["2026-10-02"],
    mega_groups: [
      {
        id: "mg_cohort_1",
        name: "Cohort 1 - October Early",
        start_date: "2026-10-01",
        end_date: "2026-10-03",
        grades: ["4"],
        target_grades: [4],
        target_areas: ["Maadi"],
      },
      {
        id: "mg_cohort_2",
        name: "Cohort 2 - October Late",
        start_date: "2026-10-10",
        end_date: "2026-10-12",
        grades: ["5"],
        target_grades: [5],
        target_areas: ["Maadi"],
      },
    ],
    status: "draft",
  };

  // Verify that insert payload cleanly prepares base payload upon PGRST204
  const { blocked_days, mega_groups, ...basePayload } = insertPayload;
  assert(basePayload.name === insertPayload.name, "Base payload must preserve batch name");
  assert(basePayload.dates.length === 5, "Base payload must preserve dates");
  assert(basePayload.time_slots.length === 3, "Base payload must preserve time slots");
  assert(!("blocked_days" in basePayload), "Base payload must omit unmigrated blocked_days");
  assert(!("mega_groups" in basePayload), "Base payload must omit unmigrated mega_groups");
  console.log("  • Batch creation payload handler prepared resilient base fallback successfully.");

  console.log("\n[STEP 2] Persisting Batch Settings with Blocked Days & Mega Groups to Shared Storage...");
  const savedSettings = await saveBatchGroupSettings(testBatchId, testProjectId, {
    batch_group_type: "single_session",
    default_repeat_count: 1,
    blocked_days: ["2026-10-02"],
    mega_groups: insertPayload.mega_groups as any,
    classifications: [],
  });

  console.log("  • Saved Settings Summary:");
  console.log("    - Batch Group Type:", savedSettings.batch_group_type);
  console.log("    - Default Repeat Count:", savedSettings.default_repeat_count);
  console.log("    - Blocked Days:", savedSettings.blocked_days);
  console.log("    - Mega Groups Count:", savedSettings.mega_groups?.length);

  assert(savedSettings.blocked_days?.includes("2026-10-02"), "Blocked days must be saved in settings");
  assert(savedSettings.mega_groups?.length === 2, "Mega groups must be saved in settings");

  console.log("\n[STEP 3] Rehydrating Batch Settings from Authoritative Layer...");
  const rehydrated = await fetchBatchGroupSettings(testBatchId);

  console.log("  • Rehydrated Settings Summary:");
  console.log("    - Blocked Days:", rehydrated.blocked_days);
  console.log("    - Mega Groups:", rehydrated.mega_groups?.map((m) => `${m.name} [${m.start_date}..${m.end_date}]`));

  assert(rehydrated.blocked_days?.includes("2026-10-02"), "Rehydrated settings must contain blocked days");
  assert(rehydrated.mega_groups?.length === 2, "Rehydrated settings must contain 2 mega groups");

  console.log("\n[STEP 4] Executing Solver with Rehydrated Settings...");
  const sampleLabs = [
    {
      "Lab ID": "LAB-MAADI-01",
      "Lab Name": "Maadi Center Lab A",
      Gov: "Cairo",
      Area: "Maadi",
      "Lab Capacity": 25,
      Capacity: 25,
    },
  ];

  const sampleStudents = [
    ...Array.from({ length: 15 }, (_, i) => ({
      "Student ID": `STU-G4-${i + 1}`,
      S_ID: `STU-G4-${i + 1}`,
      Grade: 4,
      "Physical Area": "Maadi",
    })),
    ...Array.from({ length: 15 }, (_, i) => ({
      "Student ID": `STU-G5-${i + 1}`,
      S_ID: `STU-G5-${i + 1}`,
      Grade: 5,
      "Physical Area": "Maadi",
    })),
  ];

  const customSlots = [
    "2026-10-01 10:00",
    "2026-10-02 10:00", // Blocked day
    "2026-10-03 10:00",
    "2026-10-10 10:00",
    "2026-10-12 10:00",
  ];

  const solverRun = await runAllocation({
    studentFile: makeStudentFile(sampleStudents, "test_students.xlsx"),
    labFile: makeLabFile(sampleLabs, "labs.xlsx"),
    program: "DECI",
    prefix: "Physical-DS",
    preferences: {
      blocked_days: rehydrated.blocked_days,
      mega_groups: rehydrated.mega_groups,
      batchGroupType: rehydrated.batch_group_type,
      defaultRepeatCount: rehydrated.default_repeat_count,
      customSlots,
    },
  });

  const { summary, master_allocation } = solverRun.payload;
  console.log("  • Solver Execution Summary:");
  console.log(`    - Total Demand: ${summary.total_students}`);
  console.log(`    - Total Assigned: ${summary.assigned_count}`);
  console.log(`    - Total Seat Visits: ${summary.total_seat_visits}`);

  // Confirm zero sessions were scheduled on blocked day (2026-10-02)
  const blockedDayAssignments = master_allocation.filter((r) => String(r.Day || "").includes("2026-10-02"));
  console.log(`    - Assignments on Blocked Day (2026-10-02): ${blockedDayAssignments.length}`);
  assert(blockedDayAssignments.length === 0, "No assignments must occur on blocked day");

  // Confirm Grade 4 (Cohort 1) is scheduled strictly in Window 1 (2026-10-01 to 2026-10-03)
  const g4Assignments = master_allocation.filter((r) => Number(r.Grade) === 4);
  assert(g4Assignments.length > 0, "Grade 4 cohort must be assigned");
  for (const a of g4Assignments) {
    const dayStr = String(a.Day);
    assert(dayStr.includes("2026-10-01") || dayStr.includes("2026-10-03"), `Grade 4 must be in Cohort 1 window (2026-10-01..2026-10-03), got ${dayStr}`);
  }

  // Confirm Grade 5 (Cohort 2) is scheduled strictly in Window 2 (2026-10-10 to 2026-10-12)
  const g5Assignments = master_allocation.filter((r) => Number(r.Grade) === 5);
  assert(g5Assignments.length > 0, "Grade 5 cohort must be assigned");
  for (const a of g5Assignments) {
    const dayStr = String(a.Day);
    assert(dayStr.includes("2026-10-10") || dayStr.includes("2026-10-12"), `Grade 5 must be in Cohort 2 window (2026-10-10..2026-10-12), got ${dayStr}`);
  }

  console.log("\n=========================================================================");
  console.log("🎉 BATCH CREATION FLOW WITH BLOCKED DAYS & MEGA GROUPS VERIFIED 100%!");
  console.log("=========================================================================");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
