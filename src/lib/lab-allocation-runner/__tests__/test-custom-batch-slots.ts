import fs from "fs";
import XLSX from "xlsx";
import { runAllocation } from "../run.js";
import { resolveSlotSchedule } from "../schedule.js";
import { formatTimeSlot } from "../../time-slots.js";
import { buildAreaTimePivot, buildSingleSessionLabPivot, getLabPivotColumns } from "../summaries.js";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

export async function runCustomBatchSlotsTests() {
  console.log("=========================================================================");
  console.log("🧪 TESTING CUSTOM BATCH TIME SLOTS IMPORT & OUTPUT DIFFERENTIALS");
  console.log("=========================================================================");

  const labPath = fs.existsSync("public/sample-files/egypt_labs_benchmark.xlsx")
    ? "public/sample-files/egypt_labs_benchmark.xlsx"
    : "scratch/user_egypt_labs.xlsx";
  const labBuf = fs.readFileSync(labPath);
  const labWb = XLSX.read(labBuf, { type: "buffer" });
  const labs: any[] = XLSX.utils.sheet_to_json(labWb.Sheets[labWb.SheetNames[0]]);

  // Generate test student demand rows
  const studentRows: any[] = [];
  let sId = 1;
  const sampleAreas = ["مدينة نصر", "الدقي", "المعادي", "مصر الجديدة", "حلوان"];
  for (const area of sampleAreas) {
    for (let i = 0; i < 40; i++) {
      const g = 4 + (i % 3);
      studentRows.push({
        "Student ID": `STU-${String(sId++).padStart(5, "0")}`,
        Grade: `Grade ${g}`,
        "Physical Area": area,
      });
    }
  }

  const studentWs = XLSX.utils.json_to_sheet(studentRows);
  const studentWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(studentWb, studentWs, "Students");
  const studentBuf = XLSX.write(studentWb, { type: "buffer", bookType: "xlsx" });

  // -------------------------------------------------------------------------
  // Test 1: Batch A - Standard 7-Slot Schedule (Default / Undefined)
  // -------------------------------------------------------------------------
  console.log("\n[TEST 1] Running Batch A (Standard 7-Slot Schedule)...");
  const resA = await runAllocation({
    studentFile: new File([studentBuf], "students.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    labFile: new File([labBuf], "labs.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      customSlots: undefined,
    },
  });

  const summaryA = resA.payload.summary;
  assert(summaryA.total_sessions_available === labs.length * 7, `Expected ${labs.length * 7} sessions, got ${summaryA.total_sessions_available}`);
  
  // Verify Lab Grid Matrix columns for Batch A
  const pivotRowA = resA.payload.lab_pivot[0];
  assert(pivotRowA !== undefined, "Pivot row A must exist");
  assert("Thu 9 AM" in pivotRowA, "Pivot A must contain Thu 9 AM");
  assert("Thu 12 PM" in pivotRowA, "Pivot A must contain Thu 12 PM");
  assert("Fri 6 PM" in pivotRowA, "Pivot A must contain Fri 6 PM");
  console.log(`✓ Batch A Grid Matrix has standard 7 slots (Sessions: ${summaryA.total_sessions_available})`);

  // -------------------------------------------------------------------------
  // Test 2: Batch B - Custom 4-Slot Schedule (["10:00", "12:30", "16:00", "19:30"])
  // -------------------------------------------------------------------------
  console.log("\n[TEST 2] Running Batch B (Custom 4-Slot Schedule: 10:00 AM, 12:30 PM, 4:00 PM, 7:30 PM)...");
  const customSlotsB = ["10:00", "12:30", "16:00", "19:30"];
  const resB = await runAllocation({
    studentFile: new File([studentBuf], "students.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    labFile: new File([labBuf], "labs.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      customSlots: customSlotsB,
    },
  });

  const summaryB = resB.payload.summary;
  assert(summaryB.total_sessions_available === labs.length * 4, `Expected ${labs.length * 4} sessions, got ${summaryB.total_sessions_available}`);

  // Verify Lab Grid Matrix columns for Batch B
  const pivotRowB = resB.payload.lab_pivot[0];
  assert(pivotRowB !== undefined, "Pivot row B must exist");
  assert("10:00 AM" in pivotRowB, "Pivot B must contain 10:00 AM");
  assert("12:30 PM" in pivotRowB, "Pivot B must contain 12:30 PM");
  assert("4:00 PM" in pivotRowB, "Pivot B must contain 4:00 PM");
  assert("7:30 PM" in pivotRowB, "Pivot B must contain 7:30 PM");
  assert(!("Thu 9 AM" in pivotRowB), "Pivot B must NOT contain default Thu 9 AM");
  console.log(`✓ Batch B Grid Matrix correctly reflects custom 4 slots (Sessions: ${summaryB.total_sessions_available})`);

  // -------------------------------------------------------------------------
  // Test 3: Batch C - Custom Multi-Day Tagged Schedule with a repeated time
  // -------------------------------------------------------------------------
  console.log("\n[TEST 3] Running Batch C (Custom Multi-Date Schedule across Sep 22 & Sep 23)...");
  const customSlotsC = [
    "2026-09-22@10:00",
    "2026-09-22@12:30",
    "2026-09-23@10:00",
  ];
  const resC = await runAllocation({
    studentFile: new File([studentBuf], "students.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    labFile: new File([labBuf], "labs.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    program: "DECI",
    prefix: "Physical-DS-G",
    preferences: {
      overfillRules: [],
      preferredLabRules: [],
      extraLabs: [],
      customSlots: customSlotsC,
      batchGroupType: "multi_session",
      defaultRepeatCount: 2,
    },
  });

  const summaryC = resC.payload.summary;
  assert(summaryC.total_sessions_available === labs.length * 3, `Expected ${labs.length * 3} sessions, got ${summaryC.total_sessions_available}`);

  // Verify Lab Grid Matrix columns for Batch C
  const pivotRowC = resC.payload.lab_pivot[0];
  assert(pivotRowC !== undefined, "Pivot row C must exist");
  const labelC1 = formatTimeSlot(customSlotsC[0]);
  const labelC2 = formatTimeSlot(customSlotsC[1]);
  const labelC3 = formatTimeSlot(customSlotsC[2]);
  assert(labelC1 in pivotRowC, `Pivot C must contain '${labelC1}'`);
  assert(labelC2 in pivotRowC, `Pivot C must contain '${labelC2}'`);
  assert(labelC3 in pivotRowC, `Pivot C must contain '${labelC3}'`);
  assert(!("10:00 AM" in pivotRowC), "Pivot C must NOT contain untagged 10:00 AM");
  assert(labelC1 !== labelC3, "The same time on Sep 22 and Sep 23 must remain separate columns");

  const slotInfoC = resolveSlotSchedule(customSlotsC);
  const slotLabelByNum = new Map(slotInfoC.map((slot) => [slot.num, slot.label]));
  assert(resC.payload.master_allocation.length > 0, "Master Allocation must contain assigned rows");

  for (const masterRow of resC.payload.master_allocation) {
    const slotLabel = slotLabelByNum.get(masterRow.Slot_Num);
    assert(Boolean(slotLabel), `Slot_Num ${masterRow.Slot_Num} must resolve to a configured slot label`);
    const pivotRow = resC.payload.lab_pivot.find((row) =>
      row["Physical Area"] === masterRow["Physical Area"] &&
      Number(row.Grade) === Number(masterRow.Grade) &&
      row.Lab_ID === masterRow.Lab_ID
    );
    assert(Boolean(pivotRow), `Pivot row must exist for ${masterRow.Lab_ID} / grade ${masterRow.Grade}`);
    const cell = String(pivotRow![slotLabel!] ?? "-");
    assert(cell !== "-", `Slot_Num ${masterRow.Slot_Num} must resolve to an occupied pivot cell`);
    const [studentCount, capacity] = cell.split("/").map(Number);
    const expectedCount = resC.payload.master_allocation.filter((row) =>
      row["Physical Area"] === masterRow["Physical Area"] &&
      Number(row.Grade) === Number(masterRow.Grade) &&
      row.Lab_ID === masterRow.Lab_ID &&
      row.Slot_Num === masterRow.Slot_Num
    ).length;
    assert(studentCount === expectedCount, `Pivot occupancy must match Master Allocation for Slot_Num ${masterRow.Slot_Num}`);
    assert(capacity === masterRow.Lab_Capacity, `Pivot capacity must match Master Allocation for Slot_Num ${masterRow.Slot_Num}`);
    assert(Boolean(masterRow.Group_ID), "Occupied cells must resolve to a Group ID");
    assert(Number(masterRow.Visit_Num) >= 1, "Multi-session occupied cells must resolve to a visit label");
  }
  assert(
    resC.payload.lab_pivot.some((row) => slotInfoC.some((slot) => row[slot.label] !== "-")),
    "At least one Lab Grid Matrix cell must be occupied",
  );
  console.log(`✓ Batch C Grid Matrix correctly reflects date-tagged slots (Sessions: ${summaryC.total_sessions_available})`);

  // -------------------------------------------------------------------------
  // Test 4: Output Differential Verification across all 3 batches
  // -------------------------------------------------------------------------
  console.log("\n[TEST 4] Verifying all outputs differ according to batch slot configuration...");
  const metadataColumns = ["Physical Area", "Grade", "Academic_Label", "Track", "Level", "Lab_ID"];
  const slotLabelsA = Object.keys(pivotRowA).filter((k) => !metadataColumns.includes(k));
  const slotLabelsB = Object.keys(pivotRowB).filter((k) => !metadataColumns.includes(k));
  const slotLabelsC = Object.keys(pivotRowC).filter((k) => !metadataColumns.includes(k));

  assert(slotLabelsA.length === 7, `Batch A should have 7 slot columns, got ${slotLabelsA.length}`);
  assert(slotLabelsB.length === 4, `Batch B should have 4 slot columns, got ${slotLabelsB.length}`);
  assert(slotLabelsC.length === 3, `Batch C should have 3 slot columns, got ${slotLabelsC.length}`);

  assert(JSON.stringify(slotLabelsA) !== JSON.stringify(slotLabelsB), "Batch A and Batch B slot headers must differ");
  assert(JSON.stringify(slotLabelsB) !== JSON.stringify(slotLabelsC), "Batch B and Batch C slot headers must differ");
  console.log("✓ Slot headers verified distinct across batches:");
  console.log("  - Batch A headers:", slotLabelsA.join(", "));
  console.log("  - Batch B headers:", slotLabelsB.join(", "));
  console.log("  - Batch C headers:", slotLabelsC.join(", "));

  const unsortedSlots = [
    "2026-10-02@16:00", "2026-10-01@19:30", "2026-10-01@10:00", "2026-10-02@10:00",
    "2026-10-01@16:00", "2026-10-02@12:30", "2026-10-01@12:30", "2026-10-02@19:30",
  ];
  const chronologicalSlots = resolveSlotSchedule(unsortedSlots);
  const expectedLabels = [
    "2026-10-01@10:00", "2026-10-01@12:30", "2026-10-01@16:00", "2026-10-01@19:30",
    "2026-10-02@10:00", "2026-10-02@12:30", "2026-10-02@16:00", "2026-10-02@19:30",
  ].map(formatTimeSlot);
  assert(JSON.stringify(chronologicalSlots.map((slot) => slot.label)) === JSON.stringify(expectedLabels), "Date slots must sort by real date then real time");
  assert(JSON.stringify(chronologicalSlots.map((slot) => slot.num)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]), "Slot_Num must follow chronological order");

  const chronologicalMaster = chronologicalSlots.map((slot) => ({
    "Physical Area": "Cairo", Grade: 203, Lab_ID: "LAB-1", Slot_Num: slot.num,
    Lab_Capacity: 20, S_ID: `S-${slot.num}`, Group_ID: `G${slot.num}`,
  })) as any;
  const chronologicalPivot = buildAreaTimePivot(chronologicalMaster, chronologicalSlots, "DECI")[0];
  const chronologicalColumns = getLabPivotColumns("DECI", chronologicalSlots);
  assert(!chronologicalColumns.includes("Academic_Label"), "Academic_Label must not be a visible Lab Grid column");
  assert(JSON.stringify(chronologicalColumns.slice(4)) === JSON.stringify(expectedLabels), "Grid columns must use canonical chronological slots");
  chronologicalSlots.forEach((slot) => assert(chronologicalPivot[slot.label] === "1/20", `Occupancy must remain under ${slot.label}`));
  const exportRow = Object.fromEntries(chronologicalColumns.map((column) => [column, chronologicalPivot[column]]));
  const exportSheet = XLSX.utils.json_to_sheet([exportRow], { header: chronologicalColumns });
  const exportedHeaders = XLSX.utils.sheet_to_json(exportSheet, { header: 1 })[0] as string[];
  assert(JSON.stringify(exportedHeaders) === JSON.stringify(chronologicalColumns), "Excel must use the same canonical column order");

  const singleSessionRows = buildSingleSessionLabPivot([
    { ...chronologicalMaster[0], Governorate: "Cairo", Grade: 4, Group_ID: "Physical-G1", S_ID: "S-1" },
    { ...chronologicalMaster[0], Governorate: "Cairo", Grade: 4, Group_ID: "Physical-G1", S_ID: "S-2" },
    { ...chronologicalMaster[1], Governorate: "Cairo", Grade: 5, Group_ID: "Physical-G2", S_ID: "S-3" },
  ] as any, chronologicalSlots, "DEMI");
  assert(singleSessionRows.length === 1, "Single-session pivot must create one logical row per Lab ID");
  assert(singleSessionRows[0].cells.get(1)?.studentCount === 2, "Single-session cell must count unique students");
  assert(singleSessionRows[0].cells.get(1)?.academicLabel === "G4", "Single-session cell must retain its academic identity");
  assert(singleSessionRows[0].cells.get(2)?.academicLabel === "G5", "Different slot grades must not duplicate the lab row");
  assert(!singleSessionRows[0].cells.has(3), "Unoccupied canonical slots must remain empty cells");

  const integrityRows = buildSingleSessionLabPivot([
    { ...chronologicalMaster[0], Governorate: "Cairo", Grade: 4, Group_ID: "Physical-G1", S_ID: "S-1" },
    { ...chronologicalMaster[0], Governorate: "Cairo", Grade: 5, Group_ID: "Physical-G2", S_ID: "S-2" },
  ] as any, chronologicalSlots, "DEMI");
  assert(Boolean(integrityRows[0].cells.get(1)?.integrityIssue), "Multiple groups in one lab/slot must surface an integrity issue");

  console.log("\n🎉 ALL CUSTOM BATCH TIME SLOTS TESTS PASSED 100%!");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCustomBatchSlotsTests().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
