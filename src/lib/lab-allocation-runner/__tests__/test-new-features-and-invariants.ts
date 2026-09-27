import fs from "fs";
import * as XLSX from "xlsx";
import { runAllocation } from "../run";
import { buildFullSessionGrid } from "../grid";
import { resolveSlotSchedule } from "../schedule";
import { parseShortfallDiagnostics } from "@/components/ShortfallVisualizer";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
}

function makeStudentFile(students: any[], filename = "students.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(students);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function makeLabFile(labs: any[], filename = "labs.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(labs);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return new File([buf], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function runNewFeaturesAndInvariantsSuite() {
  console.log("=========================================================================");
  console.log("🧪 RUNNING NEW FEATURES, CONSTRAINTS & SHORTFALL ROOT-CAUSE TEST SUITE");
  console.log("=========================================================================\n");

  // -------------------------------------------------------------------------
  // TEST 1: Fixed-Slot Reservation Persisting Across Multiple Weeks
  // -------------------------------------------------------------------------
  console.log("[TEST 1] Testing Fixed Slot Reservation Across Multiple Weeks...");

  // Setup a 3-week batch with recurring Thursday 10:00 AM slots in the same lab
  const multiWeekStudents: any[] = [];
  for (let i = 1; i <= 20; i++) {
    multiWeekStudents.push({
      "Student ID": `STU-WK-${String(i).padStart(3, "0")}`,
      Grade: 4,
      "Physical Area": "المعادي",
    });
  }

  const multiWeekLabs = [
    { "Lab ID": "LAB-MAADI-FIXED", Area: "المعادي", "Lab Capacity": 25 },
  ];

  const customSlotsMultiWeek = [
    // Week 1
    "2026-10-01 10:00",
    "2026-10-01 13:00",
    // Week 2
    "2026-10-08 10:00",
    "2026-10-08 13:00",
    // Week 3
    "2026-10-15 10:00",
    "2026-10-15 13:00",
  ];

  const resMultiWeek = await runAllocation({
    studentFile: makeStudentFile(multiWeekStudents, "students_multiweek.xlsx"),
    labFile: makeLabFile(multiWeekLabs, "labs_multiweek.xlsx"),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 3,
      customSlots: customSlotsMultiWeek,
    },
  });

  const masterRowsMultiWeek = resMultiWeek.payload.master_allocation;
  assert(masterRowsMultiWeek.length === 60, `Must have 60 master allocation rows (20 students x 3 weeks), got ${masterRowsMultiWeek.length}`);

  // Group visits check: All visits for the group must be at the EXACT same time slot (10:00) and lab in recurring weeks
  const visitsByGroup = new Map<string, Array<{ date: string; time: string; lab: string; visitNum: number }>>();
  for (const r of masterRowsMultiWeek) {
    const gid = r.Group_ID;
    if (!visitsByGroup.has(gid)) visitsByGroup.set(gid, []);
    const list = visitsByGroup.get(gid)!;
    const vNum = Number(r.Visit_Num || 1);
    if (!list.some(v => v.visitNum === vNum)) {
      list.push({
        date: r.Day,
        time: r.Time_Slot,
        lab: r.Lab_ID,
        visitNum: vNum,
      });
    }
  }

  for (const [gid, visits] of visitsByGroup.entries()) {
    visits.sort((a, b) => a.visitNum - b.visitNum);
    assert(visits.length === 3, `Group ${gid} must have 3 visits, got ${visits.length}`);

    // Verify same lab
    const labIds = new Set(visits.map(v => v.lab));
    assert(labIds.size === 1, `Group ${gid} must remain in the exact same lab across all weeks, got ${Array.from(labIds).join(", ")}`);

    // Verify same time slot (10:00 AM)
    const timeOfDays = new Set(visits.map(v => v.time.match(/\d{1,2}:\d{2}(?:\s*[ap]m)?/i)?.[0] || v.time));
    assert(timeOfDays.size === 1, `Group ${gid} must retain the exact same time of day across all weeks, got ${Array.from(timeOfDays).join(", ")}`);
    assert(timeOfDays.has("10:00 AM") || timeOfDays.has("10:00"), "Time must be 10:00 AM");

    // Verify distinct weeks (2026-10-01, 2026-10-08, 2026-10-15)
    const dates = visits.map(v => v.date);
    assert(dates[0].includes("2026-10-01"), `Visit 1 must be on 2026-10-01, got ${dates[0]}`);
    assert(dates[1].includes("2026-10-08"), `Visit 2 must be on 2026-10-08, got ${dates[1]}`);
    assert(dates[2].includes("2026-10-15"), `Visit 3 must be on 2026-10-15, got ${dates[2]}`);

    console.log(`  • Group ${gid} Fixed Slot Track:`);
    visits.forEach(v => console.log(`    - Visit ${v.visitNum}: ${v.date} at ${v.time} in ${v.lab}`));
  }

  console.log("✅ [TEST 1 PASSED] Fixed slot reservation strictly locked group to exact recurring weekly slot!\n");

  // -------------------------------------------------------------------------
  // TEST 2: Day-Off / Blocked-Day Exclusion Producing Zero Slots on Blocked Days
  // -------------------------------------------------------------------------
  console.log("[TEST 2] Testing Day-Off / Blocked-Day Exclusion from Solver Grid...");

  const allCandidateDates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  const blockedDates = ["2026-10-02", "2026-10-04"]; // Block 2nd and 4th October

  const customSlotsWithBlocked = [
    "2026-10-01 10:00",
    "2026-10-01 14:00",
    "2026-10-02 10:00", // Should be excluded
    "2026-10-02 14:00", // Should be excluded
    "2026-10-03 10:00",
    "2026-10-03 14:00",
    "2026-10-04 10:00", // Should be excluded
  ];

  const gridSessions = buildFullSessionGrid(
    [{ "Lab ID": "LAB-DOK-01", Area: "الدقي", "Lab Capacity": 20 }],
    [],
    resolveSlotSchedule(customSlotsWithBlocked),
    blockedDates
  );

  // Assert 0 sessions on blocked dates
  const sessionsOnOct2 = gridSessions.filter(s => s.Day?.includes("2026-10-02") || s.Date === "2026-10-02");
  const sessionsOnOct4 = gridSessions.filter(s => s.Day?.includes("2026-10-04") || s.Date === "2026-10-04");
  assert(sessionsOnOct2.length === 0, `Blocked date 2026-10-02 must produce 0 grid sessions, got ${sessionsOnOct2.length}`);
  assert(sessionsOnOct4.length === 0, `Blocked date 2026-10-04 must produce 0 grid sessions, got ${sessionsOnOct4.length}`);

  // Run solver with blocked_days preference
  const resBlocked = await runAllocation({
    studentFile: makeStudentFile(multiWeekStudents, "students_blocked.xlsx"),
    labFile: makeLabFile([{ "Lab ID": "LAB-MAADI-01", Area: "المعادي", "Lab Capacity": 25 }], "labs_blocked.xlsx"),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      batchGroupType: "single_session",
      blocked_days: blockedDates,
      customSlots: customSlotsWithBlocked,
    },
  });

  const masterBlocked = resBlocked.payload.master_allocation;
  const masterOnBlockedDays = masterBlocked.filter(r => r.Day.includes("2026-10-02") || r.Day.includes("2026-10-04"));
  assert(masterOnBlockedDays.length === 0, `Master allocation must contain 0 visits on blocked days, got ${masterOnBlockedDays.length}`);

  console.log(`  • Generated ${gridSessions.length} sessions (all on active days 2026-10-01 and 2026-10-03, 0 on blocked days).`);
  console.log("✅ [TEST 2 PASSED] Blocked days are 100% excluded from schedule grid & master allocation!\n");

  // -------------------------------------------------------------------------
  // TEST 3: Mega-Group Date-Range Isolation
  // -------------------------------------------------------------------------
  console.log("[TEST 3] Testing Mega-Group Sub-Batches with Isolated Date Windows...");

  const megaGroupStudents: any[] = [];
  // 20 students in Cohort A (Grade 4)
  for (let i = 1; i <= 20; i++) {
    megaGroupStudents.push({
      "Student ID": `STU-MEGA-A-${String(i).padStart(3, "0")}`,
      Grade: 4,
      "Physical Area": "الدقي",
    });
  }
  // 20 students in Cohort B (Grade 5)
  for (let i = 1; i <= 20; i++) {
    megaGroupStudents.push({
      "Student ID": `STU-MEGA-B-${String(i).padStart(3, "0")}`,
      Grade: 5,
      "Physical Area": "الدقي",
    });
  }

  const megaGroupSlots = [
    // Cohort A Window: 2026-11-01 to 2026-11-03
    "2026-11-01 10:00",
    "2026-11-02 10:00",
    "2026-11-03 10:00",
    // Cohort B Window: 2026-11-10 to 2026-11-12
    "2026-11-10 10:00",
    "2026-11-11 10:00",
    "2026-11-12 10:00",
  ];

  const megaGroupDefs = [
    {
      name: "Cohort A",
      start_date: "2026-11-01",
      end_date: "2026-11-03",
      grades: ["4"],
    },
    {
      name: "Cohort B",
      start_date: "2026-11-10",
      end_date: "2026-11-12",
      grades: ["5"],
    },
  ];

  const resMega = await runAllocation({
    studentFile: makeStudentFile(megaGroupStudents, "students_mega.xlsx"),
    labFile: makeLabFile([{ "Lab ID": "LAB-DOK-MEGA", Area: "الدقي", "Lab Capacity": 25 }], "labs_mega.xlsx"),
    program: "DECI",
    prefix: "Physical-DS",
    preferences: {
      batchGroupType: "single_session",
      customSlots: megaGroupSlots,
      mega_groups: megaGroupDefs,
    },
  });

  const masterMega = resMega.payload.master_allocation;
  assert(masterMega.length === 40, `Must seat all 40 students across the two mega groups, got ${masterMega.length}`);

  // Verify Cohort A students are strictly within 2026-11-01 to 2026-11-03
  const cohortARows = masterMega.filter(r => r.S_ID.startsWith("STU-MEGA-A"));
  assert(cohortARows.length === 20, `Cohort A must have 20 rows, got ${cohortARows.length}`);
  for (const r of cohortARows) {
    const isInsideWindow = r.Day.includes("2026-11-01") || r.Day.includes("2026-11-02") || r.Day.includes("2026-11-03");
    assert(isInsideWindow, `Cohort A student ${r.S_ID} scheduled on ${r.Day} outside window [2026-11-01..2026-11-03]`);
  }

  // Verify Cohort B students are strictly within 2026-11-10 to 2026-11-12
  const cohortBRows = masterMega.filter(r => r.S_ID.startsWith("STU-MEGA-B"));
  assert(cohortBRows.length === 20, `Cohort B must have 20 rows, got ${cohortBRows.length}`);
  for (const r of cohortBRows) {
    const isInsideWindow = r.Day.includes("2026-11-10") || r.Day.includes("2026-11-11") || r.Day.includes("2026-11-12");
    assert(isInsideWindow, `Cohort B student ${r.S_ID} scheduled on ${r.Day} outside window [2026-11-10..2026-11-12]`);
  }

  console.log(`  • Cohort A: 20/20 students scheduled strictly in Window 1 (2026-11-01 to 2026-11-03).`);
  console.log(`  • Cohort B: 20/20 students scheduled strictly in Window 2 (2026-11-10 to 2026-11-12).`);
  console.log("✅ [TEST 3 PASSED] Mega-group date-range isolation strictly enforced with 0 cross-date leakage!\n");

  // -------------------------------------------------------------------------
  // TEST 4: One-Visit-Per-Day Enforcement
  // -------------------------------------------------------------------------
  console.log("[TEST 4] Testing One-Visit-Per-Day Calendar Distinctness Enforcement...");

  const multiSessionDaysSlots = [
    "2026-12-01 10:00",
    "2026-12-01 14:00", // Same day
    "2026-12-02 10:00",
    "2026-12-02 14:00", // Same day
    "2026-12-03 10:00",
  ];

  const resOneVisit = await runAllocation({
    studentFile: makeStudentFile(multiWeekStudents, "students_onevisit.xlsx"),
    labFile: makeLabFile([{ "Lab ID": "LAB-MAADI-01", Area: "المعادي", "Lab Capacity": 25 }], "labs_onevisit.xlsx"),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
      customSlots: multiSessionDaysSlots,
    },
  });

  const masterOneVisit = resOneVisit.payload.master_allocation;
  assert(masterOneVisit.length === 40, `Must have 40 visits (20 students x 2 visits), got ${masterOneVisit.length}`);

  // Verify that for every single student, no two visits ever share the same calendar day
  const studentDayVisits = new Map<string, string[]>();
  for (const r of masterOneVisit) {
    if (!studentDayVisits.has(r.S_ID)) studentDayVisits.set(r.S_ID, []);
    studentDayVisits.get(r.S_ID)!.push(r.Day);
  }

  for (const [sid, days] of studentDayVisits.entries()) {
    assert(days.length === 2, `Student ${sid} must have 2 visits, got ${days.length}`);
    const uniqueDays = new Set(days);
    assert(uniqueDays.size === days.length, `Student ${sid} has duplicate visits on the same calendar day: ${days.join(", ")}`);
  }

  console.log(`  • Verified all 20 multi-session students: 100% scheduled across distinct calendar days (0 same-day collisions).`);
  console.log("✅ [TEST 4 PASSED] One-visit-per-day strictly enforced across all student schedules!\n");

  // -------------------------------------------------------------------------
  // TEST 5: Shortfall & Execution Logs Root Cause Verification on Real Data
  // -------------------------------------------------------------------------
  console.log("[TEST 5] Testing Shortfall & Execution Logs Root Cause Reconciliation on Nationwide Data...");

  // Load benchmark physical labs and students
  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const benchmarkLabs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  const areaCap7: Record<string, number> = {};
  for (const lab of benchmarkLabs) {
    const area = lab.Area || lab.area;
    const cap = Number(lab["Lab Capacity"] || lab.capacity || 20);
    areaCap7[area] = (areaCap7[area] || 0) + cap * 7;
  }
  const benchmarkAreas = Object.keys(areaCap7);
  const totalEgyptCap7 = Object.values(areaCap7).reduce((a, b) => a + b, 0);

  const benchmarkStudents: any[] = [];
  let sId = 1;
  const targetAssigned = 25268;
  const totalStudentCount = 25304;

  for (const area of benchmarkAreas) {
    const share = areaCap7[area] / totalEgyptCap7;
    const areaStudents = Math.min(areaCap7[area], Math.round(targetAssigned * share));
    for (let i = 0; i < areaStudents; i++) {
      const g = 4 + (i % 3);
      benchmarkStudents.push({
        "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
        Grade: `Grade ${g}`,
        "Physical Area": area,
      });
    }
  }

  // Add 36 students in an orphan area without labs
  const orphanCount = totalStudentCount - benchmarkStudents.length;
  for (let i = 0; i < orphanCount; i++) {
    const g = 4 + (i % 3);
    benchmarkStudents.push({
      "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
      Grade: `Grade ${g}`,
      "Physical Area": "OrphanAreaWithoutLabs",
    });
  }

  console.log(`  • Benchmark data loaded: ${benchmarkLabs.length} physical labs, ${benchmarkStudents.length} students across Egypt.`);

  // Identify orphan areas (areas with students in demand dataset but 0 physical labs)
  const areasWithLabs = new Set(benchmarkLabs.map(l => l.Area));
  const orphanStudents = benchmarkStudents.filter(s => !areasWithLabs.has(s["Physical Area"]));
  const orphanAreas = Array.from(new Set(orphanStudents.map(s => s["Physical Area"])));

  console.log(`  • Identified ${orphanAreas.length} orphan area(s) without labs: [${orphanAreas.join(", ")}] (${orphanStudents.length} unseated students).`);
  assert(orphanAreas.length > 0, "Must have at least one orphan area in benchmark dataset to test reconciliation");

  // Execute nationwide allocation
  const benchmarkRun = await runAllocation({
    studentFile: makeStudentFile(benchmarkStudents, "bench_students.xlsx"),
    labFile: null,
    useDbLabs: true,
    labsJson: benchmarkLabs,
    program: "DECI",
    prefix: "Physical-DS-G",
  });

  const { summary, shortfall_math, unassigned_students, shortfall_text } = benchmarkRun.payload;

  console.log(`  • Nationwide Solver Results:`);
  console.log(`    - Total Demand: ${summary.total_students}`);
  console.log(`    - Total Assigned: ${summary.assigned_count}`);
  console.log(`    - Total Unassigned: ${summary.unassigned_count}`);

  // Test Shortfall Diagnostics parser reconciliation
  const parsedAreas = parseShortfallDiagnostics(
    shortfall_text,
    shortfall_math || [],
    unassigned_students || []
  );

  const totalUnassignedSeats = parsedAreas.reduce((sum, a) => sum + a.unseatedStudents, 0);

  console.log(`    - Shortfall Diagnostics Areas Count: ${parsedAreas.length}`);
  console.log(`    - Shortfall Diagnostics Total Unassigned Seats: ${totalUnassignedSeats}`);

  // Critical Assertion: Shortfall Diagnostics Total Unassigned MUST exactly equal Summary Unassigned Count
  assert(
    totalUnassignedSeats === summary.unassigned_count,
    `Shortfall Diagnostics total unassigned (${totalUnassignedSeats}) must match summary unassigned count (${summary.unassigned_count})`
  );

  // Critical Assertion: Every orphan area must be present in diagnostics with 0 capacity and full demand unassigned
  for (const orphanArea of orphanAreas) {
    const areaDiag = parsedAreas.find(a => a.area === orphanArea);
    assert(Boolean(areaDiag), `Orphan area "${orphanArea}" must be included in Shortfall Diagnostics`);
    assert(areaDiag!.labsCount === 0, `Orphan area "${orphanArea}" must have 0 labs assigned`);
    assert(areaDiag!.unseatedStudents > 0, `Orphan area "${orphanArea}" must report unseated students`);
    console.log(`    - Orphan Area "${orphanArea}": Labs=${areaDiag!.labsCount}, Unseated Students=${areaDiag!.unseatedStudents}`);
  }

  // Critical Assertion: Shortfall text and execution logs contain explanation for orphan areas
  assert(Boolean(shortfall_text), "Shortfall explanation text must be generated");
  for (const orphanArea of orphanAreas) {
    assert(
      shortfall_text.includes(orphanArea),
      `Shortfall text explanation must explicitly mention orphan area "${orphanArea}"`
    );
  }

  console.log("✅ [TEST 5 PASSED] Shortfall & Logs root cause 100% verified & reconciled on real nationwide data!\n");

  console.log("=========================================================================");
  console.log("🎉 ALL NEW FEATURES, CONSTRAINTS & ROOT-CAUSE VERIFICATIONS PASSED 100%!");
  console.log("=========================================================================");
}

runNewFeaturesAndInvariantsSuite().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
